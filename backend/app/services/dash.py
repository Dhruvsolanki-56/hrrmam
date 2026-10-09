"""Read-only views: My Work, Director / Regulatory / Artwork portals, audit."""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import serialize as S
from .. import workflow
from ..models import (Agreement, DateRequest, Document, ManufacturerRequest, Project, ProjectEvent, RFICase, Task, User, aware)
from . import engine
from .tasks import _can_decide

ENTITY_FILTER = {"AU": {workflow.AU, workflow.JOINT}, "IN": {workflow.IN, workflow.JOINT, workflow.MP}}


def _live(db: Session) -> list[Project]:
    return [p for p in engine.list_projects(db) if not p.closed]


def _stage_item(p: Project, key: str) -> dict:
    st = workflow.stage(key)
    row = p.row(key)
    return {"project_id": p.id, "project_name": p.name, "project_code": p.code, "stage_key": key, "stage_name": st.name,
            "approver": st.approver, "days_waiting": (row.days_in_stage if row else 0)}


# ---------------------------------------------------------------- my work
def my_work(db: Session, user: User) -> dict:
    today = date.today()
    week = today + timedelta(days=7)
    mine = [t for t in db.scalars(select(Task).where(Task.assignee_id == user.id)) if not t.project.closed]
    openish = ("assigned", "accepted", "in_progress", "changes_requested")

    def due(t):
        return aware(t.due_at).date() if t.due_at else None

    assigned_by_me = [t for t in db.scalars(select(Task).where(Task.assigner_id == user.id, Task.assignee_id != user.id))
                      if t.open and not t.project.closed]
    buckets = {
        "due_today": [t for t in mine if t.state in openish and due(t) == today],
        "due_this_week": [t for t in mine if t.state in openish and due(t) and today < due(t) <= week],
        "overdue": [t for t in mine if t.overdue],
        "waiting_for_someone": [t for t in mine if t.pending_request] + [t for t in assigned_by_me if t not in mine],
        "returned_for_changes": [t for t in mine if t.state == "changes_requested"],
        "submitted_for_approval": [t for t in mine if t.state in workflow.TASK_AWAITING],
        "upcoming": [t for t in mine if t.state in openish and (due(t) is None or due(t) > week)],
        "completed": sorted([t for t in mine if t.state in workflow.TASK_DONE], key=lambda t: t.updated_at, reverse=True)[:20],
    }
    # things waiting on *my* decision
    decide = []
    for t in db.scalars(select(Task).where(Task.state.in_(workflow.TASK_AWAITING))):
        if not t.project.closed and _can_decide(user, t, "approve"):
            decide.append({"type": "task", "task": S.task_out(t, True)})
    for r in db.scalars(select(DateRequest).where(DateRequest.status == "pending")):
        t = r.task
        if not t.project.closed and (user.id == t.assigner_id or user.can("change_dates")):
            decide.append({"type": "date_request", "task": S.task_out(t, True), "request": S.date_request_out(r)})
    for p in _live(db):
        for row in p.active_rows:
            st = workflow.stage(row.stage_key)
            if row.state == "awaiting_approval" and user.can("approve") and (user.role_key == "super_admin" or user.role_key in st.approver_roles):
                decide.append({"type": "stage", **_stage_item(p, row.stage_key)})
    return {"buckets": {k: [S.task_out(t, True) for t in v] for k, v in buckets.items()},
            "counts": {k: len(v) for k, v in buckets.items()}, "needs_decision": decide}


# ---------------------------------------------------------------- director portal
def director(db: Session, entity: str = "") -> dict:
    projects = engine.list_projects(db)
    allowed = ENTITY_FILTER.get(entity)
    if allowed:
        projects = [p for p in projects if p.closed or any(workflow.stage(k).entity in allowed for k in p.active_keys)]
    live = [p for p in projects if not p.closed]
    rows = [S.project_row(p) for p in projects]
    ids = {p.id for p in live}
    by_health = {h: sum(1 for r in rows if r["health"] == h) for h in ("green", "amber", "red", "closed")}
    risk_order = {"red": 0, "amber": 1}
    at_risk = sorted([r for r in rows if r["health"] in risk_order], key=lambda r: (risk_order[r["health"]], -r["overdue_tasks"]))
    delayed = [r for r in rows if r["status"] == "active" and (r["overdue"] or r["overdue_tasks"]
               or any("date has passed" in x for x in r["health_reasons"]))]
    approvals = [_stage_item(p, k) for p in live if p.status == "active" for k in p.active_keys if p.stage_states[k] == "awaiting_approval"]
    task_approvals = [S.task_out(t, True) for t in db.scalars(select(Task).where(Task.state.in_(workflow.TASK_AWAITING))) if t.project_id in ids]
    doc_approvals = [S.document_out(d, True) for d in db.scalars(select(Document).where(Document.status == "director_approval")) if d.project_id in ids]
    unsigned = [S.agreement_out(a, True) for a in db.scalars(select(Agreement).where(Agreement.status != "signed"))
                if a.project_id in ids]
    unsigned.sort(key=lambda a: -(a["age_days"] or 0))
    date_reqs = [{**S.date_request_out(r), "task": S.task_out(r.task, True)} for r in db.scalars(select(DateRequest).where(DateRequest.status == "pending"))
                 if r.task.project_id in ids]
    rfis = sorted([S.rfi_out(r, True) for r in db.scalars(select(RFICase).where(RFICase.status != "closed")) if r.project_id in ids],
                  key=lambda r: r["due_date"] or "9999")
    per_stage = {s.key: sum(1 for p in live if s.key in p.active_keys) for s in workflow.STAGES}
    events = db.scalars(select(ProjectEvent).order_by(ProjectEvent.id.desc()).limit(12))
    return {"counts": {"total": len(projects), "live": len(live), **by_health}, "projects": rows, "at_risk": at_risk,
            "delayed": delayed, "pending_approvals": approvals, "task_approvals": task_approvals, "doc_approvals": doc_approvals,
            "unsigned_agreements": unsigned, "date_requests": date_reqs, "rfi_deadlines": rfis, "per_stage": per_stage,
            "recent": [S.event_out(e, True) for e in events]}


# ---------------------------------------------------------------- regulatory portal
def regulatory(db: Session, user: User) -> dict:
    live = [p for p in _live(db)]
    ids = {p.id for p in live}
    my_tasks = [S.task_out(t, True) for t in db.scalars(select(Task).where(Task.assignee_id == user.id)) if t.open and t.project_id in ids]
    dossiers = []
    for p in live:
        if p.row("regulatory").state == "pending" and not p.dossier_items:
            continue
        items = p.dossier_items
        done = sum(1 for i in items if i.status in workflow.DOSSIER_DONE)
        dossiers.append({"project_id": p.id, "project_name": p.name, "project_code": p.code, "submission_type": p.submission_type,
                         "total": len(items), "done": done, "stage_state": p.row("regulatory").state,
                         "modules": [{"module": i.module, "title": i.title, "status": i.status} for i in items if i.module],
                         "target_submission": S.iso(p.target_submission)})
    missing = [S.mfr_out(m, True) for m in db.scalars(select(ManufacturerRequest))
               if m.project_id in ids and m.required and m.status not in workflow.MFR_DONE]
    queue = []
    for p in live:
        for row in p.active_rows:
            st = workflow.stage(row.stage_key)
            if row.state == "awaiting_approval" and "regulatory" in st.approver_roles:
                queue.append({"type": "stage", **_stage_item(p, row.stage_key)})
    for d in db.scalars(select(Document).where(Document.status == "regulatory_review")):
        if d.project_id in ids:
            queue.append({"type": "artwork", "document": S.document_out(d, True)})
    for m in missing:
        if m["status"] in ("received", "under_review"):
            queue.append({"type": "manufacturer", "request": m})
    rfis = sorted([S.rfi_out(r, True) for r in db.scalars(select(RFICase).where(RFICase.status != "closed")) if r.project_id in ids],
                  key=lambda r: r["due_date"] or "9999")
    deadlines = sorted([{"project_id": p.id, "project_name": p.name, "project_code": p.code, "target_submission": S.iso(p.target_submission),
                         "stage_key": p.stage_key} for p in live if p.target_submission and p.row("submission").state not in workflow.SATISFIED],
                       key=lambda x: x["target_submission"])
    return {"my_tasks": my_tasks, "dossiers": dossiers, "missing_manufacturer_data": missing, "ra_review_queue": queue,
            "rfi_cases": rfis, "submission_deadlines": deadlines}


# ---------------------------------------------------------------- artwork portal
def artwork(db: Session, user: User) -> dict:
    live_ids = {p.id for p in _live(db)}
    docs = [d for d in db.scalars(select(Document).where(Document.stage_key == "artwork")) if d.project_id in live_ids]
    out = lambda ds: [S.document_out(d, True) for d in ds]  # noqa: E731
    my_tasks = [S.task_out(t, True) for t in db.scalars(select(Task).where(Task.assignee_id == user.id, Task.stage_key == "artwork"))
                if t.open and t.project_id in live_ids]
    return {
        "my_tasks": my_tasks,
        "new_development": out([d for d in docs if d.status == "draft" and len(d.versions) == 1]),
        "returned_for_changes": out([d for d in docs if d.status == "returned"]),
        "awaiting_regulatory_review": out([d for d in docs if d.status == "regulatory_review"]),
        "awaiting_director_approval": out([d for d in docs if d.status == "director_approval"]),
        "print_proof_shade_card": out([d for d in docs if d.kind in ("Print proof", "Shade card") and d.status != "locked"]),
    }


# ---------------------------------------------------------------- audit & registers
def audit(db: Session, project_id: int | None, area: str, q: str, limit: int) -> list[dict]:
    stmt = select(ProjectEvent).order_by(ProjectEvent.id.desc())
    if project_id:
        stmt = stmt.where(ProjectEvent.project_id == project_id)
    if area:
        stmt = stmt.where(ProjectEvent.area == area)
    out = []
    for e in db.scalars(stmt):
        if q and q.lower() not in f"{e.note} {e.actor} {e.action} {e.project.name}".lower():
            continue
        out.append(S.event_out(e, True))
        if len(out) >= limit:
            break
    return out


def legal_register(db: Session, status: str = "", q: str = "") -> list[dict]:
    rows = [S.agreement_out(a, True) for a in db.scalars(select(Agreement).order_by(Agreement.id))
            if not a.project.closed or a.status == "signed"]
    if status:
        rows = [r for r in rows if r["status"] == status]
    if q:
        rows = [r for r in rows if q.lower() in f"{r['project_name']} {r['label']} {r['counterparty']}".lower()]
    return rows
