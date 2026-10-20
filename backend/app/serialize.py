"""Turns ORM rows into the JSON the frontend uses (one shape per thing, no per-endpoint duplication)."""
from datetime import date, datetime

from sqlalchemy import select

from . import workflow
from .models import Agreement, DateRequest, Document, ManufacturerRequest, Project, RFICase, Task, User, aware
from .services import engine, modules


def iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return aware(v).isoformat()
    return v.isoformat() if isinstance(v, date) else v


def user_brief(u: User | None):
    return {"id": u.id, "name": u.name, "role_key": u.role_key, "role": u.role.name, "country": u.country} if u else None


def user_full(u: User):
    return {**user_brief(u), "email": u.email, "active": u.active, "permissions": ["*"] if u.role_key == "super_admin" else list(u.role.permissions or []),
            "assign_to": list(u.role.assign_to or [])}


def _worst(p: Project):
    rows = p.active_rows
    return max(rows, key=lambda r: r.days_in_stage - r.sla_days, default=None)


def project_row(p: Project) -> dict:
    h, reasons = engine.health(p)
    w = _worst(p)
    tasks = p.tasks
    flow = p.flow
    cur = flow.stage(p.stage_key)
    return {
        "stage": {"key": cur.key, "name": cur.name, "phase": cur.phase, "entity": cur.entity, "group": cur.group or "Stages"},
        "stage_order": [x.key for x in flow.stages], "stage_names": {x.key: x.name for x in flow.stages},
        "workflow_id": p.workflow_id,
        "id": p.id, "code": p.code, "name": p.name, "product": p.product, "project_type": p.project_type,
        "category": p.category, "market": p.market, "initiator": p.initiator, "summary": p.summary,
        "potential_client": p.potential_client, "opportunity_value": p.opportunity_value, "formulation": p.formulation,
        "commercial_expectations": p.commercial_expectations, "manufacturer_info": p.manufacturer_info,
        "regulatory_route": p.regulatory_route, "stakeholders": p.stakeholders,
        "project_manager": user_brief(p.project_manager), "submission_type": p.submission_type,
        "target_submission": iso(p.target_submission), "target_launch": iso(p.target_launch),
        "critical_blocker": p.critical_blocker, "status": p.status, "stage_key": p.stage_key,
        "active_stages": p.active_keys, "stage_states": p.stage_states,
        "awaiting_approval": [r.stage_key for r in p.active_rows if r.state == "awaiting_approval"],
        "health": h, "health_reasons": reasons,
        "days_in_stage": w.days_in_stage if w else 0, "sla_days": w.sla_days if w else cur.sla_days,
        "overdue": p.status == "active" and any(r.overdue for r in p.active_rows),
        "open_tasks": sum(1 for t in tasks if t.open), "overdue_tasks": sum(1 for t in tasks if t.overdue),
        "created_at": iso(p.created_at), "updated_at": iso(p.updated_at),
    }


def task_out(t: Task, with_project: bool = False) -> dict:
    req = t.pending_request
    d = {
        "id": t.id, "project_id": t.project_id, "stage_key": t.stage_key, "title": t.title, "description": t.description,
        "assignee": user_brief(t.assignee), "assigner": user_brief(t.assigner), "due_at": iso(t.due_at), "state": t.state,
        "required": t.required, "bypassed": t.bypassed, "rework_count": t.rework_count, "overdue": t.overdue, "open": t.open,
        "pending_request": date_request_out(req) if req else None,
        "date_requests": [date_request_out(r) for r in t.date_requests],
        "attachments": [{"id": a.id, "name": a.name, "version_no": a.version_no, "link": a.link, "note": a.note,
                         "created_by": a.created_by, "created_at": iso(a.created_at)} for a in t.attachments],
        "created_at": iso(t.created_at), "updated_at": iso(t.updated_at),
    }
    evs = [e for e in t.project.events if e.task_id == t.id and e.area == "task"]
    sub = next((e for e in reversed(evs) if e.action == "submit"), None)
    chg = next((e for e in reversed(evs) if e.action == "request_changes"), None)
    plain = lambda e: {**_ev(e), "note": (e.note or "").removeprefix(f"{t.title}: ").removeprefix(t.title)}
    d["submitted"] = plain(sub) if sub and t.state in ("submitted", "resubmitted") else None
    d["last_changes"] = plain(chg) if chg and t.state == "changes_requested" else None
    if with_project:
        d["project_name"], d["project_code"] = t.project.name, t.project.code
    return d


def clarification_out(c) -> dict:
    return {"id": c.id, "question": c.question, "requested_by": user_brief(c.requested_by), "responder": user_brief(c.responder),
            "due_date": iso(c.due_date), "status": c.status, "response": c.response, "responded_on": iso(c.responded_on),
            "decision_note": c.decision_note, "decided_by": user_brief(c.decided_by), "decided_on": iso(c.decided_on),
            "rounds": c.rounds, "created_at": iso(c.created_at),
            "overdue": bool(c.due_date and c.status != "accepted" and c.due_date < date.today())}


def reopen_out(r) -> dict:
    return {"id": r.id, "kind": r.kind, "ref": r.ref, "label": r.label, "reason": r.reason, "status": r.status,
            "requested_by": user_brief(r.requested_by), "decided_by": user_brief(r.decided_by),
            "decision_note": r.decision_note, "created_at": iso(r.created_at), "decided_at": iso(r.decided_at)}


def date_request_out(r: DateRequest) -> dict:
    return {"id": r.id, "task_id": r.task_id, "proposed_due": iso(r.proposed_due), "previous_due": iso(r.previous_due),
            "reason": r.reason, "status": r.status, "requested_by": user_brief(r.requested_by),
            "decided_by": user_brief(r.decided_by), "decision_note": r.decision_note, "created_at": iso(r.created_at),
            "decided_at": iso(r.decided_at)}


def agreement_out(a: Agreement, with_project: bool = False) -> dict:
    age = None if a.status == "signed" else (datetime.now(aware(a.created_at).tzinfo) - aware(a.created_at)).days
    d = {"id": a.id, "project_id": a.project_id, "kind": a.kind, "label": workflow.AGREEMENT_KINDS[a.kind],
         "counterparty": a.counterparty, "status": a.status, "owner": user_brief(a.owner), "due_date": iso(a.due_date),
         "signed_date": iso(a.signed_date), "link": a.link, "notes": a.notes, "core": a.core, "age_days": age,
         "started_on": iso(aware(a.created_at).date()), "closed": a.status == "signed",
         "closed_in_days": (a.signed_date - aware(a.created_at).date()).days if a.status == "signed" and a.signed_date else None,
         "overdue": bool(a.due_date and a.status != "signed" and a.due_date < date.today())}
    if with_project:
        d["project_name"], d["project_code"] = a.project.name, a.project.code
    return d


def mfr_out(m: ManufacturerRequest, with_project: bool = False) -> dict:
    d = {"id": m.id, "project_id": m.project_id, "kind": m.kind, "label": workflow.MFR_KINDS[m.kind],
         "manufacturer": m.manufacturer, "needed_for": m.needed_for, "status": m.status, "required": m.required, "requested_on": iso(m.requested_on),
         "due_date": iso(m.due_date), "received_on": iso(m.received_on), "link": m.link, "notes": m.notes,
         "owner": user_brief(m.owner), "overdue": bool(m.due_date and m.status in ("requested",) and m.due_date < date.today())}
    if with_project:
        d["project_name"], d["project_code"] = m.project.name, m.project.code
    return d


def rfi_out(r: RFICase, with_project: bool = False) -> dict:
    d = {"id": r.id, "project_id": r.project_id, "authority": r.authority, "reference": r.reference, "summary": r.summary,
         "received_on": iso(r.received_on), "due_date": iso(r.due_date), "status": r.status, "response_link": r.response_link,
         "closure_note": r.closure_note, "closed_on": iso(r.closed_on),
         "overdue": bool(r.due_date and r.status != "closed" and r.due_date < date.today()),
         "questions": [{"id": q.id, "number": q.number, "question": q.question, "response": q.response,
                        "evidence_link": q.evidence_link, "task": task_out(q.task) if q.task else None} for q in r.questions]}
    if with_project:
        d["project_name"], d["project_code"] = r.project.name, r.project.code
    return d


def document_out(d: Document, with_project: bool = False) -> dict:
    cur = d.versions[-1] if d.versions else None
    labels = {"draft": "Draft", "in_review": "In review", "approved": "Approved", "returned": "Returned for changes", "locked": "Locked"}
    if d.is_artwork:
        labels.update({s["status"]: s["label"] for s in d.steps})
    out = {"id": d.id, "project_id": d.project_id, "stage_key": d.stage_key, "kind": d.kind, "title": d.title, "status": d.status,
           "required": d.required, "owner": user_brief(d.owner), "flow": d.flow, "flow_labels": labels, "is_artwork": d.is_artwork,
           "review_roles": modules.review_roles(d) if d.status in d.flow[1:-1] else [],
           "current_version": cur.version_no if cur else 0, "link": cur.link if cur else "", "updated_at": iso(d.updated_at),
           "versions": [{"id": v.id, "version_no": v.version_no, "link": v.link, "note": v.note, "created_by": v.created_by,
                         "created_at": iso(v.created_at)} for v in d.versions]}
    if with_project:
        out["project_name"], out["project_code"] = d.project.name, d.project.code
    return out


def event_out(e, with_project: bool = False) -> dict:
    d = {"id": e.id, "project_id": e.project_id, "area": e.area, "action": e.action, "note": e.note, "actor": e.actor,
         "stage_key": e.stage_key, "task_id": e.task_id, "to_stage": e.to_stage, "created_at": iso(e.created_at)}
    if with_project:
        d["project_name"], d["project_code"] = e.project.name, e.project.code
    flow = e.project.flow
    d["stage_name"] = flow.stage(e.stage_key).name if e.stage_key and flow.has(e.stage_key) else ""
    return d


def _holders(db, roles) -> list[str]:
    """Names of the active people in these roles, e.g. 'Rajiv Kapoor, Director'. Shown so nobody has to guess who has a request."""
    if not roles:
        return []
    us = db.scalars(select(User).where(User.active.is_(True), User.role_key.in_(list(roles))).order_by(User.id)).all()
    return [f"{u.name} ({u.role.name.split(' (')[0]})" for u in us]


def _ev(e) -> dict:
    return {"by": e.actor, "at": iso(e.created_at), "note": e.note or ""}


def handoff(p: Project, r, db) -> dict:
    """Everything the stage card needs to say who has the request, why, and what happened last, without opening the history."""
    st = p.flow.stage(r.stage_key)
    evs = [e for e in p.events if e.stage_key == r.stage_key and e.area == "stage"]
    last = lambda *acts: next((e for e in reversed(evs) if e.action in acts), None)
    sub, back, ok = last("submit"), last("send_back"), last("approve", "bypass")
    out = {"submitted": None, "sent_back": None, "decided": None, "with": None, "owners": [], "approvers": []}
    if r.state in ("in_progress", "awaiting_approval"):
        out["owners"], out["approvers"] = _holders(db, st.owner_roles), _holders(db, st.approver_roles)
    if r.state == "awaiting_approval":
        out["with"] = {"action": "approve", "label": st.approver, "people": _holders(db, st.approver_roles)}
        out["submitted"] = _ev(sub) if sub else None
    elif r.state == "in_progress":
        out["with"] = {"action": "work", "label": st.owner, "people": _holders(db, st.owner_roles)}
    if back and r.state in ("in_progress", "awaiting_approval"):
        out["sent_back"] = {**_ev(back), "resolved": bool(sub and sub.id > back.id)}
    if ok and r.state in ("approved", "bypassed", "locked"):
        out["decided"] = {**_ev(ok), "action": ok.action}
    return out


def stage_rows(p: Project) -> list[dict]:
    from sqlalchemy.orm import object_session
    db = object_session(p)
    out = []
    for r in p.stages:
        active = r.state in ("in_progress", "awaiting_approval")
        tasks = [t for t in p.tasks if t.stage_key == r.stage_key]
        out.append({"key": r.stage_key, "state": r.state, "locked": r.locked, "rework_count": r.rework_count,
                    "started_at": iso(r.started_at), "decided_at": iso(r.decided_at), "days_in_stage": r.days_in_stage,
                    "sla_days": r.sla_days, "overdue": r.overdue,
                    "tasks_total": len(tasks), "tasks_done": sum(1 for t in tasks if t.state in workflow.TASK_DONE),
                    "blockers": engine.blockers(p, r.stage_key) if active else [],
                    "warnings": engine.warnings(p, r.stage_key) if active else [],
                    "handoff": handoff(p, r, db)})
    return out


def project_detail(p: Project) -> dict:
    from sqlalchemy.orm import object_session
    from .models import WorkflowDef
    wf = object_session(p).get(WorkflowDef, p.workflow_id)
    return {
        **project_row(p),
        "flow": p.flow.payload(),
        "workflow": {"id": wf.id, "name": wf.name, "version": wf.version} if wf else None,
        "stages": stage_rows(p),
        "tasks": [task_out(t) for t in p.tasks],
        "agreements": [agreement_out(a) for a in p.agreements],
        "dossier_items": [{"id": i.id, "module": i.module, "title": i.title, "status": i.status, "required": i.required,
                           "link": i.link, "notes": i.notes} for i in p.dossier_items],
        "submissions": [{"id": s.id, "kind": s.kind, "reference": s.reference, "platform": s.platform,
                         "submitted_on": iso(s.submitted_on), "submitted_by": s.submitted_by, "notes": s.notes, "status": s.status,
                         "acknowledgement_ref": s.acknowledgement_ref, "acknowledged_on": iso(s.acknowledged_on)} for s in p.submissions],
        "mfr_requests": [mfr_out(m) for m in p.mfr_requests],
        "rfis": [rfi_out(r) for r in p.rfis],
        "documents": [document_out(d) for d in p.documents],
        "events": [event_out(e) for e in p.events],
        "clarifications": [clarification_out(c) for c in p.clarifications],
        "reopen_requests": [reopen_out(r) for r in p.reopen_requests],
    }
