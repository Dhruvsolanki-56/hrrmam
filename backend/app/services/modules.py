"""Workstream modules: Legal register, dossier checklist + submissions, manufacturer data, RFI cases,
documents with versions (which also carries the artwork review flow). Every change is audited.

Approval cycle for every kind of entry (configurable per workflow in `rules`):
    work -> submit -> approve | request changes (note) -> work again -> submit ...
Where a rule says approval is not required, submitting goes straight to the approved state."""
from datetime import date
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from .. import workflow
from ..models import (Agreement, Document, DocumentVersion, DossierItem, ManufacturerRequest, Project, RFICase,
                      RFIQuestion, Submission, User)
from . import common, notify, tasks
from .common import Forbidden, WorkflowError


# ---------------------------------------------------------------- shared checks
def check_url(url: str) -> str:
    url = (url or "").strip()
    if url and urlparse(url).scheme not in ("http", "https"):
        raise WorkflowError("Links must start with http:// or https://")
    return url


def stage_for(p: Project, feature: str) -> workflow.Stage:
    st = p.flow.with_feature(feature)
    if not st:
        raise WorkflowError(f"This project's workflow has no stage for '{feature}'.")
    return st


def can_edit_stage(user: User, p: Project, key: str) -> bool:
    if not key or not p.flow.has(key):
        return user.can("manage_project") or user.can("approve")
    st = p.flow.stage(key)
    return common.role_ok(user, st.owner_roles) or common.role_ok(user, st.approver_roles) or user.can("manage_project")


def check_edit(user: User, p: Project, key: str, what: str):
    """Open project, a role that works on this stage, and approved/locked stages stay protected."""
    common.ensure_open(p)
    if not can_edit_stage(user, p, key):
        raise Forbidden(f"Your role ({user.role.name}) does not work on {what}.")
    row = p.row(key) if p.flow.has(key) else None
    if row and row.locked:
        raise WorkflowError(f"{p.flow.stage(key).name} is locked. Unlock it before changing it.")
    if row and row.state in workflow.SATISFIED and not user.can("edit_approved"):
        raise Forbidden(f"{p.flow.stage(key).name} is already approved. Only roles that can edit approved records may change it.")


def _diff(obj, changes: dict, labels: dict | None = None) -> list[str]:
    out = []
    for k, v in changes.items():
        if getattr(obj, k) != v:
            out.append(f"{(labels or {}).get(k, k.replace('_', ' ').title())}: {getattr(obj, k) or '–'} → {v or '–'}")
            setattr(obj, k, v)
    return out


# ---------------------------------------------------------------- the generic approval cycle for module entries
# kind -> where it sits, its working states, the "under review" state and the approved state
ENTRY = {
    "agreement": dict(feature="agreements", area="legal", work=("not_started", "drafting", "changes_requested"),
                      review="in_review", approved="sent_for_signature", also_approved=()),
    "dossier_item": dict(feature="dossier", area="dossier", work=("missing", "draft", "changes_requested"),
                         review="awaiting_approval", approved="reviewed", also_approved=("ready",)),
    "mfr": dict(feature="mfr", area="manufacturer", work=("requested", "received", "changes_requested"),
                review="under_review", approved="accepted", also_approved=()),
}


def _title(kind: str, obj) -> str:
    if kind == "agreement":
        return workflow.AGREEMENT_KINDS[obj.kind]
    if kind == "mfr":
        return workflow.MFR_KINDS[obj.kind]
    return f"{obj.module + ' ' if obj.module else ''}{obj.title}"


def _rule(p: Project, kind: str) -> dict:
    return p.flow.rules[kind]


def _guard_status(p: Project, kind: str, obj, new: str):
    """A status picked from the list must not skip the approval cycle."""
    cfg, rule = ENTRY[kind], _rule(p, kind)
    if new == obj.status:
        return
    if new == "changes_requested":
        raise WorkflowError("Changes are requested by the approver, using 'Request changes'.")
    if rule.get("approval", True):
        if new == cfg["review"]:
            raise WorkflowError("Use 'Submit for approval' so an approver can decide.")
        if new == cfg["approved"] or new in cfg["also_approved"]:
            raise WorkflowError("This needs approval: submit it for approval and an approver decides.")


def entry_action(db: Session, user: User, kind: str, obj, action: str, note: str):
    p = obj.project
    cfg, rule = ENTRY[kind], _rule(p, kind)
    st = stage_for(p, cfg["feature"])
    note = note.strip()
    if action == "submit":
        check_edit(user, p, st.key, _title(kind, obj))
        if obj.status not in cfg["work"]:
            raise WorkflowError("This entry is not waiting for work to be submitted.")
        if rule.get("approval", True):
            obj.status = cfg["review"]
            notify.notify_roles(db, rule.get("roles", []), "approval", f"Approval needed: {_title(kind, obj)}",
                                f"Project: {p.name} · {_title(kind, obj)} · Submitted by {user.name} · Action: approve or request changes",
                                p.id, exclude=user.id)
        else:
            obj.status = cfg["approved"]
    elif action in ("approve", "reject"):
        common.require(user, "approve" if action == "approve" else "request_changes")
        if not common.role_ok(user, rule.get("roles", [])):
            raise Forbidden("This approval is done by: " + ", ".join(r.replace("_", " ") for r in rule.get("roles", [])) + ".")
        common.ensure_open(p)
        if obj.status != cfg["review"]:
            raise WorkflowError("This entry has not been submitted for approval.")
        if action == "approve":
            obj.status = cfg["approved"]
            if kind == "mfr":
                obj.received_on = obj.received_on or date.today()
        else:
            common.need_note(note, "Please say what needs to change.")
            obj.status = "changes_requested"
    else:
        raise WorkflowError("Unknown action.")
    common.log(p, user, cfg["area"], action, f"{_title(kind, obj)}: {note}".strip(": "), st.key)
    db.commit()
    return obj


# ---------------------------------------------------------------- legal / agreements
def ensure_core_agreements(p: Project):
    have = {a.kind for a in p.agreements if a.core}
    for kind in workflow.CORE_AGREEMENTS:
        if kind not in have:
            p.agreements.append(Agreement(kind=kind, core=True, status="not_started"))


def create_agreement(db: Session, user: User, p: Project, data) -> Agreement:
    st = stage_for(p, "agreements")
    check_edit(user, p, st.key, st.name)
    a = Agreement(kind=data.kind, counterparty=data.counterparty, owner_id=data.owner_id, due_date=data.due_date,
                  link=check_url(data.link), notes=data.notes, core=data.kind in workflow.CORE_AGREEMENTS, status="not_started")
    p.agreements.append(a)
    common.log(p, user, "legal", "created", f"{workflow.AGREEMENT_KINDS[data.kind]} added" + (f" ({data.counterparty})" if data.counterparty else ""), st.key)
    db.commit()
    return a


def update_agreement(db: Session, user: User, a: Agreement, data) -> Agreement:
    p = a.project
    st = stage_for(p, "agreements")
    check_edit(user, p, st.key, st.name)
    ch = data.model_dump(exclude_unset=True)
    if "link" in ch:
        ch["link"] = check_url(ch["link"])
    if "status" in ch and ch["status"] != a.status:
        new = ch["status"]
        if new == "signed":
            if _rule(p, "agreement").get("approval", True) and a.status != "sent_for_signature":
                raise WorkflowError("An agreement must be approved (sent for signature) before it can be marked as signed.")
            ch.setdefault("signed_date", date.today())
        else:
            if a.status == "signed":
                common.require(user, "lock_unlock", "reopen a signed agreement")
                ch["signed_date"] = None
            _guard_status(p, "agreement", a, new)
    d = _diff(a, ch)
    if d:
        common.log(p, user, "legal", "update", f"{workflow.AGREEMENT_KINDS[a.kind]}: " + "; ".join(d), st.key)
    db.commit()
    return a


# ---------------------------------------------------------------- regulatory: dossier checklist & submissions
def ensure_dossier(p: Project):
    if not p.submission_type or p.dossier_items:
        return
    for module, title in workflow.SUBMISSION_TYPES.get(p.submission_type, []):
        p.dossier_items.append(DossierItem(module=module, title=title, status="missing"))


def create_dossier_item(db: Session, user: User, p: Project, data) -> DossierItem:
    st = stage_for(p, "dossier")
    check_edit(user, p, st.key, st.name)
    if data.module:
        allowed = {m for m, _ in workflow.SUBMISSION_TYPES.get(p.submission_type, []) if m}
        if data.module not in allowed:
            raise WorkflowError("M1–M5 modules are only used where the submission type requires them.")
    it = DossierItem(module=data.module or None, title=data.title.strip(), required=data.required, status="missing")
    p.dossier_items.append(it)
    common.log(p, user, "dossier", "created", f"Checklist item added: {it.title}", st.key)
    db.commit()
    return it


def update_dossier_item(db: Session, user: User, it: DossierItem, data) -> DossierItem:
    p = it.project
    st = stage_for(p, "dossier")
    check_edit(user, p, st.key, st.name)
    ch = data.model_dump(exclude_unset=True)
    if "link" in ch:
        ch["link"] = check_url(ch["link"])
    if "status" in ch:
        _guard_status(p, "dossier_item", it, ch["status"])
    d = _diff(it, {k: v for k, v in ch.items() if v is not None})
    if d:
        common.log(p, user, "dossier", "update", f"{_title('dossier_item', it)}: " + "; ".join(d), st.key)
    db.commit()
    return it


def record_submission(db: Session, user: User, p: Project, data) -> Submission:
    common.ensure_open(p)
    st = stage_for(p, "submission")
    if not (common.role_ok(user, st.owner_roles) or user.can("manage_project")):
        raise Forbidden("Only the Regulatory team can record an external submission.")
    if p.row(st.key).state == "pending":
        raise WorkflowError(f"The {st.name} stage has not started yet: the stage before it must be approved first.")
    s = Submission(kind=data.kind, reference=data.reference.strip(), submitted_on=data.submitted_on, notes=data.notes,
                   platform=data.platform.strip() or common.get_setting(db, "submission_platform"), submitted_by=user.name)
    p.submissions.append(s)
    common.log(p, user, "dossier", "submission", f"{s.kind.replace('_', ' ').title()} submission recorded: {s.reference or 'no reference'} via {s.platform}", st.key)
    db.commit()
    return s


# ---------------------------------------------------------------- manufacturer data
def create_mfr(db: Session, user: User, p: Project, data) -> ManufacturerRequest:
    st = stage_for(p, "mfr")
    check_edit(user, p, st.key, st.name)
    m = ManufacturerRequest(kind=data.kind, manufacturer=data.manufacturer, due_date=data.due_date, required=data.required,
                            notes=data.notes, owner_id=data.owner_id or user.id)
    p.mfr_requests.append(m)
    common.log(p, user, "manufacturer", "requested", f"{workflow.MFR_KINDS[data.kind]} requested from {data.manufacturer or 'the manufacturer'}", st.key)
    db.commit()
    return m


def update_mfr(db: Session, user: User, m: ManufacturerRequest, data) -> ManufacturerRequest:
    p = m.project
    st = stage_for(p, "mfr")
    check_edit(user, p, st.key, st.name)
    ch = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None or k in ("due_date", "owner_id")}
    if "link" in ch:
        ch["link"] = check_url(ch["link"])
    new = ch.get("status")
    if new:
        _guard_status(p, "mfr", m, new)
        if new == "received" and m.status == "requested":
            ch.setdefault("received_on", date.today())
    d = _diff(m, ch)
    if d:
        common.log(p, user, "manufacturer", "update", f"{workflow.MFR_KINDS[m.kind]}: " + "; ".join(d), st.key)
    db.commit()
    return m


# ---------------------------------------------------------------- RFI management
def create_rfi(db: Session, user: User, p: Project, data) -> RFICase:
    common.ensure_open(p)
    rfi_st, sub_st = stage_for(p, "rfi"), stage_for(p, "submission")
    if not (common.role_ok(user, rfi_st.owner_roles) or user.can("manage_project")):
        raise Forbidden("Only the Regulatory team can open an RFI case.")
    if p.row(sub_st.key).state not in workflow.SATISFIED:
        raise WorkflowError(f"RFIs follow a recorded submission: approve {sub_st.name} first.")
    if p.row(rfi_st.key).state in workflow.SATISFIED:
        raise WorkflowError(f"{rfi_st.name} is already approved. Move the project back to that stage to open a new RFI.")
    r = RFICase(authority=data.authority, reference=data.reference.strip(), summary=data.summary, received_on=data.received_on,
                due_date=data.due_date)
    p.rfis.append(r)
    common.log(p, user, "rfi", "opened", f"RFI from {r.authority} opened: {r.reference or r.summary[:60]}", rfi_st.key)
    db.commit()
    return r


def update_rfi(db: Session, user: User, r: RFICase, data) -> RFICase:
    p = r.project
    st = stage_for(p, "rfi")
    check_edit(user, p, st.key, st.name)
    ch = data.model_dump(exclude_unset=True)
    if "response_link" in ch:
        ch["response_link"] = check_url(ch["response_link"])
    d = _diff(r, {k: v for k, v in ch.items() if v is not None or k == "due_date"})
    if d:
        common.log(p, user, "rfi", "update", f"{r.reference or 'RFI'}: " + "; ".join(d), st.key)
    db.commit()
    return r


def add_rfi_question(db: Session, user: User, r: RFICase, data) -> RFIQuestion:
    p = r.project
    st = stage_for(p, "rfi")
    check_edit(user, p, st.key, st.name)
    if r.status == "closed":
        raise WorkflowError("This RFI case is closed.")
    n = len(r.questions) + 1
    t = tasks.create_task(db, user, p, st.key, f"RFI {r.reference or r.id} · Q{n}: {data.question.strip()[:90]}",
                          data.question.strip(), data.assignee_id, data.due_at)
    q = RFIQuestion(number=n, question=data.question.strip(), task_id=t.id)
    r.questions.append(q)
    common.log(p, user, "rfi", "question", f"Q{n} assigned to {t.assignee.name}: {q.question[:120]}", st.key, t.id)
    db.commit()
    return q


def update_rfi_question(db: Session, user: User, q: RFIQuestion, data) -> RFIQuestion:
    r = q.rfi
    p = r.project
    st = stage_for(p, "rfi")
    common.ensure_open(p)
    t = q.task
    if not (t and user.id == t.assignee_id) and not can_edit_stage(user, p, st.key):
        raise Forbidden("Only the person assigned to this question or the Regulatory team can answer it.")
    if r.status == "closed":
        raise WorkflowError("This RFI case is closed.")
    ch = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "evidence_link" in ch:
        ch["evidence_link"] = check_url(ch["evidence_link"])
    d = _diff(q, ch, {"response": "Response", "evidence_link": "Evidence"})
    if d:
        common.log(p, user, "rfi", "response", f"Q{q.number}: " + "; ".join(d), st.key, q.task_id)
    db.commit()
    return q


def rfi_action(db: Session, user: User, r: RFICase, action: str, note: str) -> RFICase:
    p = r.project
    st = stage_for(p, "rfi")
    check_edit(user, p, st.key, st.name)
    note = note.strip()
    close_roles = p.flow.rules["rfi_close"].get("roles", [])
    if action == "ready":
        if r.status != "open":
            raise WorkflowError("Only an open case can be marked ready.")
        if not r.questions:
            raise WorkflowError("Add the authority's questions first.")
        pending = [q for q in r.questions if not q.task or q.task.state not in workflow.TASK_DONE]
        if pending:
            raise WorkflowError(f"{len(pending)} question task(s) are not approved yet.")
        if not r.response_link:
            raise WorkflowError("Add the response package link first.")
        r.status = "response_ready"
    elif action == "submit":
        if r.status != "response_ready":
            raise WorkflowError("Mark the response package ready first.")
        r.status = "submitted"
        p.submissions.append(Submission(kind="rfi_response", reference=r.reference, submitted_on=date.today(), submitted_by=user.name,
                                        platform=common.get_setting(db, "submission_platform"), notes="Response to " + (r.reference or "RFI")))
    elif action in ("close", "reopen"):
        common.require(user, "approve", "close or reopen an RFI case")
        if not common.role_ok(user, close_roles):
            raise Forbidden("Closing an RFI case is done by: " + ", ".join(x.replace("_", " ") for x in close_roles) + ".")
        if action == "close":
            if r.status != "submitted":
                raise WorkflowError("Submit the response before closing the case.")
            r.status, r.closed_on, r.closure_note = "closed", date.today(), common.need_note(note, "Please add a closing note.")
        else:
            if r.status != "closed":
                raise WorkflowError("Only a closed case can be reopened.")
            common.need_note(note, "Please say why it is being reopened.")
            r.status, r.closed_on = "open", None
    else:
        raise WorkflowError("Unknown action.")
    common.log(p, user, "rfi", action, f"{r.reference or 'RFI'}: {note}".strip(": "), st.key)
    db.commit()
    return r


# ---------------------------------------------------------------- documents, versions, artwork review
def create_document(db: Session, user: User, p: Project, data) -> Document:
    if data.artwork:
        key = stage_for(p, "artwork").key
    else:
        key = data.stage_key if data.stage_key and p.flow.has(data.stage_key) else ""
    check_edit(user, p, key, "this workstream's documents")
    d = Document(stage_key=key, kind=data.kind.strip() or "Other", title=data.title.strip(), required=data.required,
                 owner_id=data.owner_id or user.id, status="draft", is_artwork=bool(data.artwork))
    d.versions.append(DocumentVersion(version_no=1, link=check_url(data.link), note=data.note, created_by=user.name))
    p.documents.append(d)
    common.log(p, user, "artwork" if d.is_artwork else "document", "created", f"{d.title} (V1) created", key)
    db.commit()
    return d


def get_document(db: Session, doc_id: int) -> Document:
    d = db.get(Document, doc_id)
    if not d:
        raise common.NotFound("Document not found")
    return d


def add_version(db: Session, user: User, d: Document, data) -> Document:
    p = d.project
    check_edit(user, p, d.stage_key, "this document")
    if d.status == "locked":
        raise WorkflowError("This document is locked. Unlock it first.")
    if d.status in d.flow[1:-1]:
        raise WorkflowError("This document is under review. Return it for changes before uploading a new version.")
    if d.status == "approved":
        common.require(user, "edit_approved", "edit approved records")
        common.need_note(data.note, "Please say why an approved document needs a new version.")
    n = max(v.version_no for v in d.versions) + 1
    d.versions.append(DocumentVersion(version_no=n, link=check_url(data.link), note=data.note.strip(), created_by=user.name))
    d.status = "draft"
    common.log(p, user, "artwork" if d.is_artwork else "document", "version", f"{d.title}: V{n} added. {data.note.strip()}".strip(), d.stage_key)
    db.commit()
    return d


def review_roles(d: Document) -> list[str]:
    """Who decides the current review step."""
    if d.is_artwork:
        i = d.flow.index(d.status) - 1 if d.status in d.flow[1:-1] else 0
        return list(d.steps[i]["roles"])
    if d.stage_key and d.project.flow.has(d.stage_key):
        return list(d.project.flow.stage(d.stage_key).approver_roles)
    return ["director", "project_manager"]


def document_action(db: Session, user: User, d: Document, action: str, note: str) -> Document:
    p = d.project
    common.ensure_open(p)
    note = note.strip()
    flow = d.flow
    reviewing = d.status in flow[1:-1]
    if action == "submit":
        check_edit(user, p, d.stage_key, "this document")
        if d.status not in ("draft", "returned"):
            raise WorkflowError("Only a draft or returned document can be submitted for review.")
        d.status = flow[1]
    elif action in ("approve", "return"):
        common.require(user, "approve" if action == "approve" else "request_changes")
        if not reviewing:
            raise WorkflowError("This document is not waiting for review.")
        roles = review_roles(d)
        if not common.role_ok(user, roles):
            raise Forbidden("This review step is done by: " + ", ".join(r.replace("_", " ") for r in roles) + ".")
        if action == "approve":
            d.status = flow[flow.index(d.status) + 1]
        else:
            common.need_note(note, "Please say what needs to change.")
            d.status = "returned"
    elif action == "lock":
        common.require(user, "lock_unlock", "lock records")
        if d.status != "approved":
            raise WorkflowError("Only an approved document can be locked.")
        d.status = "locked"
    elif action == "unlock":
        common.require(user, "lock_unlock", "unlock records")
        if d.status != "locked":
            raise WorkflowError("This document is not locked.")
        common.need_note(note, "Please add a note explaining why it is being unlocked.")
        d.status = "approved"
    else:
        raise WorkflowError("Unknown action.")
    cur = max(v.version_no for v in d.versions)
    common.log(p, user, "artwork" if d.is_artwork else "document", action, f"{d.title} (V{cur}): {note}".strip(": "), d.stage_key)
    db.commit()
    return d
