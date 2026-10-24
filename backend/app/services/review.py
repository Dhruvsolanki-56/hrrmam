"""Regulatory review assistant (storyline Phase 2): dossier completeness, limit review against controlled reference
material, and RFI risk. It is rule based and transparent: every finding says why and shows its evidence. It never
certifies compliance: a Regulatory reviewer has to acknowledge or dismiss each finding, and that decision is recorded."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import workflow
from ..models import DossierValue, Project, ReferenceLimit, ReviewDecision, User
from . import common, modules, notify, people
from .common import Forbidden, WorkflowError

DONE = workflow.DOSSIER_DONE


def completeness(p: Project) -> list[dict]:
    expected = [m for m, _ in workflow.SUBMISSION_TYPES.get(p.submission_type, []) if m]
    out = []
    if not p.submission_type:
        return out
    for m, title in workflow.M.items():
        items = [i for i in p.dossier_items if i.module == m]
        if m not in expected:
            out.append({"module": m, "title": title, "status": "not_applicable", "text": "Not applicable for this submission type", "missing": []})
            continue
        todo = [i.title for i in items if i.required and i.status not in DONE]
        if not items:
            out.append({"module": m, "title": title, "status": "missing", "text": "Nothing recorded yet", "missing": []})
        elif todo:
            out.append({"module": m, "title": title, "status": "attention", "missing": todo,
                        "text": f"{len(todo)} item{'s' if len(todo) != 1 else ''} potentially missing"})
        else:
            out.append({"module": m, "title": title, "status": "complete", "text": "Complete", "missing": []})
    loose = [i for i in p.dossier_items if not i.module]
    if loose:
        todo = [i.title for i in loose if i.required and i.status not in DONE]
        out.append({"module": "", "title": "Checklist", "status": "attention" if todo else "complete", "missing": todo,
                    "text": f"{len(todo)} item{'s' if len(todo) != 1 else ''} potentially missing" if todo else "Complete"})
    return out


def limit_findings(db: Session, p: Project) -> list[dict]:
    refs = {r.parameter.lower(): r for r in db.scalars(select(ReferenceLimit).where(ReferenceLimit.active))}
    out = []
    for v in p.dossier_values:
        r = refs.get(v.parameter.lower())
        if not r:
            out.append({"key": f"limit:{v.id}", "level": "info", "module": v.module, "page": v.page, "parameter": v.parameter,
                        "value": f"{v.value:g} {v.unit}".strip(), "reference": "No controlled reference holds this parameter",
                        "reference_date": None, "reason": "There is nothing to compare this value with, so it needs a manual check."})
            continue
        bad = v.value > r.limit_value if r.comparator == "max" else v.value < r.limit_value
        if bad:
            out.append({"key": f"limit:{v.id}", "level": "high", "module": v.module, "page": v.page, "parameter": v.parameter,
                        "value": f"{v.value:g} {v.unit}".strip(),
                        "reference": f"{'≤' if r.comparator == 'max' else '≥'} {r.limit_value:g} {r.unit} ({r.source})",
                        "reference_date": r.reference_date.isoformat() if r.reference_date else None,
                        "reason": f"{v.parameter} is {'above' if r.comparator == 'max' else 'below'} the reference limit. Reviewer attention recommended."})
    return out


def rfi_risk(db: Session, p: Project, limits: list[dict]) -> list[dict]:
    risks = []
    mf = {m.kind: m for m in p.mfr_requests}

    def add(module, section, reasons):
        if reasons:
            risks.append({"key": f"risk:{module}:{section}", "level": "high" if len(reasons) > 1 else "medium", "module": module,
                          "section": section, "reasons": reasons, "result": "A regulatory query is possible"})

    st = mf.get("stability")
    add("M3", "Stability", ([f"Stability data from the manufacturer is {st.status.replace('_', ' ')}, not accepted"] if st and st.status != "accepted" else
                           ["No stability data has been requested from the manufacturer"] if not st and p.submission_type.startswith("Registered") else []))
    m3 = [i for i in p.dossier_items if i.module == "M3" and i.required and i.status not in DONE]
    pend = [k for k in ("coa", "specification", "raw_spec") if k in mf and mf[k].status != "accepted"]
    add("M3", "Quality", ([f"{len(m3)} required Module 3 item(s) are not ready"] if m3 else []) +
        ([f"{workflow.MFR_KINDS[k]} is not accepted yet" for k in pend]))
    art = [d for d in p.documents if d.is_artwork and d.status not in ("approved", "locked")]
    add("M1", "Labelling", [f"{len(art)} artwork item(s) are not approved, so label statements may change"] if art else [])
    open_changes = [i for i in p.dossier_items if i.status == "changes_requested"]
    add("All", "Review comments", [f"{len(open_changes)} dossier item(s) still have review comments open"] if open_changes else [])
    hi = [f for f in limits if f["level"] == "high"]
    add("M3", "Specification limits", [f"{f['parameter']} {f['value']} is outside the reference limit" for f in hi])
    return risks


def review(db: Session, p: Project) -> dict:
    limits = limit_findings(db, p)
    risks = rfi_risk(db, p, limits)
    dec = {d.key: d for d in p.review_decisions}
    for f in limits + risks:
        d = dec.get(f["key"])
        f["decision"] = {"decision": d.decision, "note": d.note, "by": d.decided_by, "at": d.created_at.isoformat()} if d else None
    return {
        "completeness": completeness(p), "limits": limits, "risks": risks,
        "values": [{"id": v.id, "module": v.module, "page": v.page, "parameter": v.parameter, "value": v.value, "unit": v.unit,
                    "created_by": v.created_by} for v in p.dossier_values],
        "disclaimer": "This is an automated second pair of eyes. It never certifies compliance: a Regulatory reviewer decides on every finding.",
    }


def _may(user: User, p: Project) -> bool:
    dos = p.flow.with_feature("dossier")
    return user.role_key == "super_admin" or (dos is not None and modules.can_edit_stage(user, p, dos.key)) or user.can("manage_project")


@common.serial
def add_value(db: Session, user: User, p: Project, data) -> DossierValue:
    common.ensure_open(p)
    if not _may(user, p):
        raise Forbidden("Only the people who work on the dossier can record values from it.")
    if not data.parameter.strip():
        raise WorkflowError("Name the parameter, for example Impurity X.")
    v = DossierValue(parameter=data.parameter.strip(), value=data.value, unit=data.unit.strip(), module=data.module or "",
                     page=data.page.strip(), created_by=user.name)
    p.dossier_values.append(v)
    dos = p.flow.with_feature("dossier")
    common.log(p, user, "dossier", "value", f"{v.parameter} = {v.value:g} {v.unit} recorded from the dossier ({v.module or 'no module'}, {v.page or 'no page'})", dos.key if dos else "")
    db.commit()
    return v


@common.serial
def decide(db: Session, user: User, p: Project, key: str, decision: str, note: str) -> ReviewDecision:
    common.ensure_open(p)
    if user.role_key not in ("regulatory", "super_admin") and not user.can("manage_project"):
        raise Forbidden("A Regulatory reviewer decides on these findings. The assistant never decides for them.")
    lim = limit_findings(db, p)
    found = {f["key"]: f for f in lim + rfi_risk(db, p, lim)}
    if key not in found:
        raise WorkflowError("That finding no longer applies.")
    note = common.need_note(note, "Write what you decided and why.")
    d = ReviewDecision(key=key, decision=decision, note=note, decided_by=user.name)
    p.review_decisions.append(d)
    f = found[key]
    what = f.get("parameter") or " ".join(x for x in (f.get("module"), f.get("section")) if x) or "finding"
    dos = p.flow.with_feature("dossier")
    told = [u for u in [p.project_manager, *(people.stage_responsible(db, p, p.row(dos.key)) if dos else [])] if u and u.id != user.id]
    common.log(p, user, "dossier", "review_" + decision, f"{what}: {note}", dos.key if dos else "", to=people.names(list({u.id: u for u in told}.values())))
    notify.notify_users(db, told, "note", f"Review finding {decision}: {what}", f"Project: {p.name} · {user.name} {decision} it · “{note}”", p.id, exclude=user.id, link="tab=regulatory")
    db.commit()
    return d


# ---- controlled reference material (managed by an administrator)
def reference_out(r: ReferenceLimit) -> dict:
    return {"id": r.id, "parameter": r.parameter, "comparator": r.comparator, "limit_value": r.limit_value, "unit": r.unit,
            "source": r.source, "reference_date": r.reference_date.isoformat() if r.reference_date else None, "active": r.active}


def save_reference(db: Session, user: User, data, rid: int | None = None) -> ReferenceLimit:
    common.require(user, "manage_users", "manage the reference material")
    r = db.get(ReferenceLimit, rid) if rid else ReferenceLimit()
    if rid and not r:
        raise common.NotFound("Reference not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(r, k, v.strip() if isinstance(v, str) else v)
    if not r.parameter:
        raise WorkflowError("Name the parameter.")
    clash = db.scalar(select(ReferenceLimit).where(ReferenceLimit.parameter == r.parameter, ReferenceLimit.id != (r.id or 0)))
    if clash:
        raise WorkflowError("There is already a reference for this parameter. Edit that one instead.")
    if not rid:
        db.add(r)
    db.commit()
    return r


def today() -> date:
    return date.today()
