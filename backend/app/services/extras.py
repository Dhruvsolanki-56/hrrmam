"""Task attachments (versioned), clarification requests on the brief, and reopen requests for approved work."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import workflow
from ..models import Clarification, Document, Project, ReopenRequest, Task, TaskAttachment, User
from . import common, engine, modules, notify, people
from .common import Forbidden, WorkflowError


# ------------------------------------------------------------------ task attachments
@common.serial
def add_attachment(db: Session, user: User, t: Task, name: str, link: str, note: str) -> Task:
    p = t.project
    common.ensure_open(p)
    if t.state == "locked" or t.state in workflow.TASK_DONE:
        raise WorkflowError("This task is approved. Request a reopen to change its files.")
    if not (user.id in (t.assignee_id, t.assigner_id) or user.can("manage_project") or user.role_key == "super_admin"):
        raise Forbidden("Only the assignee, the person who assigned the task, or a project manager can attach files.")
    link = modules.check_url(link)
    if not link:
        raise WorkflowError("Add a link to the file (SharePoint, Drive, ...).")
    name = (name or t.title).strip()[:200]
    n = 1 + len(t.attachments)
    t.attachments.append(TaskAttachment(name=name, version_no=n, link=link, note=note.strip(), round=t.rework_count, created_by=user.name))
    others = {t.assignee_id, t.assigner_id} - {None, user.id}
    to = ", ".join(sorted({u.name for u in (t.assignee, t.assigner) if u and u.id != user.id}))
    for uid in others:
        notify.notify(db, uid, "note", "File attached to a task", notify.task_line(t, "Open the file") + f" · {user.name} attached {name} (file {n} on this task)", p.id, t.id)
    common.log(p, user, "task", "attachment", f"{t.title}: {name} attached (file {n})", t.stage_key, t.id, to=to)
    db.commit()
    return t


def needs_new_version(t: Task) -> bool:
    """After 'changes requested' a task that already holds files must get a new version before it is resubmitted."""
    return bool(t.attachments) and max(a.round for a in t.attachments) < t.rework_count


# ------------------------------------------------------------------ clarifications (project brief)
def _may_clarify(user: User, p: Project) -> bool:
    if user.can("manage_project") or user.role_key == "super_admin":
        return True
    for k in ("opportunity", "brief"):
        if p.flow.has(k):
            st = p.flow.stage(k)
            if common.role_ok(user, list(st.owner_roles) + list(st.approver_roles)):
                return True
    return False


@common.serial
def create_clarification(db: Session, user: User, p: Project, question: str, responder_id: int | None, due: date | None) -> Clarification:
    common.ensure_open(p)
    if not _may_clarify(user, p):
        raise Forbidden("Only the people who review the brief can ask for clarification.")
    question = common.need_note(question, "Say exactly what is missing.")
    responder = db.get(User, responder_id) if responder_id else None
    if not responder or not responder.active:
        raise WorkflowError("Choose who must respond.")
    c = Clarification(question=question, requested_by_id=user.id, responder_id=responder.id, due_date=due, status="open")
    c.requested_by, c.responder = user, responder
    p.clarifications.append(c)
    common.log(p, user, "clarification", "requested", f"Asked {responder.name}: {question}", "brief" if p.flow.has("brief") else "")
    notify.notify(db, responder.id, "clarification", "Clarification required",
                  f"Project: {p.name} · {user.name} asks: {question}" + (f" · by {common.fmt_date(due)}" if due else ""), p.id)
    db.commit()
    return c


@common.serial
def clarification_action(db: Session, user: User, c: Clarification, action: str, note: str) -> Clarification:
    p = c.project
    common.ensure_open(p)
    note = note.strip()
    key = "brief" if p.flow.has("brief") else ""
    if action == "respond":
        if user.id != c.responder_id and user.role_key != "super_admin":
            raise Forbidden(f"Only {c.responder.name if c.responder else 'the person asked'} can respond.")
        if c.status != "open":
            raise WorkflowError("This clarification is not waiting for a response.")
        c.response, c.status, c.responded_on = common.need_note(note, "Write the response."), "responded", common.now()
        common.log(p, user, "clarification", "responded", f"{c.question[:80]} → {note}", key)
        notify.notify(db, c.requested_by_id, "clarification", "Clarification answered", f"Project: {p.name} · {note}", p.id)
    elif action in ("accept", "reject"):
        if user.id == c.responder_id and user.role_key != "super_admin":
            raise Forbidden("The person who answered cannot accept their own answer.")
        if user.id != c.requested_by_id and not (user.can("approve") or user.can("manage_project")):
            raise Forbidden("Only the person who asked, or an approver, accepts the answer.")
        if c.status != "responded":
            raise WorkflowError("There is no response to decide on yet.")
        c.decided_by, c.decided_on = user, common.now()
        if action == "accept":
            c.status, c.decision_note = "accepted", note
        else:
            c.decision_note = common.need_note(note, "Say what is still missing.")
            c.status, c.rounds = "open", c.rounds + 1
            notify.notify(db, c.responder_id, "clarification", "Clarification: more needed", f"Project: {p.name} · {note}", p.id)
        common.log(p, user, "clarification", "accepted" if action == "accept" else "not_accepted", f"{c.question[:80]}: {note}".strip(": "), key)
    else:
        raise WorkflowError("Unknown action.")
    db.commit()
    return c


def open_clarifications(p: Project) -> int:
    return sum(1 for c in p.clarifications if c.status != "accepted")


# ------------------------------------------------------------------ reopen requests
def _subject(db: Session, p: Project, kind: str, ref: str):
    if kind == "task":
        t = db.get(Task, int(ref)) if ref.isdigit() else None
        if not t or t.project_id != p.id:
            raise WorkflowError("Task not found.")
        if t.state not in ("approved", "locked"):
            raise WorkflowError("Only approved or locked work needs a reopen request.")
        return t, t.title
    if kind == "document":
        d = db.get(Document, int(ref)) if ref.isdigit() else None
        if not d or d.project_id != p.id:
            raise WorkflowError("Document not found.")
        if d.status not in ("approved", "locked"):
            raise WorkflowError("Only approved or locked work needs a reopen request.")
        return d, f"{d.title} (V{max(v.version_no for v in d.versions)})"
    if kind == "stage":
        if not p.flow.has(ref) or p.row(ref).state not in workflow.SATISFIED:
            raise WorkflowError("Only an approved stage can be reopened.")
        return p.row(ref), p.flow.stage(ref).name
    raise WorkflowError("Unknown kind of record.")


@common.serial
def request_reopen(db: Session, user: User, p: Project, kind: str, ref: str, reason: str) -> ReopenRequest:
    common.ensure_open(p)
    ref = str(ref)
    obj, label = _subject(db, p, kind, ref)
    reason = common.need_note(reason, "Say why it has to be reopened.")
    if kind == "task" and user.id not in (obj.assignee_id, obj.assigner_id) and not user.can("manage_project"):
        raise Forbidden("Only the assignee, the assigner or a project manager can ask to reopen a task.")
    if kind == "document" and not modules.can_edit_stage(user, p, obj.stage_key):
        raise Forbidden(f"Your role ({user.role.name}) does not work on this document.")
    if kind == "stage" and not (common.role_ok(user, p.flow.stage(ref).owner_roles) or user.can("manage_project")):
        raise Forbidden("Only the people who work on this stage can ask to reopen it.")
    if any(r.status == "pending" and r.kind == kind and r.ref == ref for r in p.reopen_requests):
        raise WorkflowError("A reopen request for this is already waiting for a decision.")
    r = ReopenRequest(kind=kind, ref=ref, label=label, reason=reason, requested_by_id=user.id)
    r.requested_by = user
    p.reopen_requests.append(r)
    db.flush()
    deciders = people.deciders_for_reopen(db, user.id)
    common.log(p, user, "project", "reopen_requested", f"{label}: {reason}", ref if kind == "stage" else getattr(obj, "stage_key", ""),
               ref=("reopen", r.id), to=people.names(deciders))
    notify.notify_users(db, deciders, "approval", "Reopen requested", f"Project: {p.name} · {user.name} asks to reopen {label} · {reason} · Action: approve or decline",
                        p.id, link=f"tab=overview&focus=reopen-{r.id}")
    db.commit()
    return r


@common.serial
def decide_reopen(db: Session, user: User, r: ReopenRequest, approve: bool, note: str) -> ReopenRequest:
    p = r.project
    common.ensure_open(p)
    common.require(user, "lock_unlock", "decide reopen requests")
    if r.status != "pending":
        raise WorkflowError("This request has already been decided.")
    if user.id == r.requested_by_id and user.role_key != "super_admin":
        raise Forbidden("Someone else has to decide a request you made.")
    note = note.strip()
    if not approve:
        note = common.need_note(note, "Say why it stays closed.")
    r.status, r.decided_by, r.decision_note, r.decided_at = ("approved" if approve else "rejected"), user, note, common.now()
    if approve:
        if r.kind == "task":
            t = db.get(Task, int(r.ref))
            t.state, t.rework_count = "changes_requested", t.rework_count + 1
            notify.notify(db, t.assignee_id, "changes", "Task reopened", notify.task_line(t, "Amend it, add a new version and resubmit"), p.id, t.id)
            common.log(p, user, "task", "reopened", f"{t.title}: reopened for {r.requested_by.name}'s request", t.stage_key, t.id, to=t.assignee.name)
        elif r.kind == "document":
            d = db.get(Document, int(r.ref))
            d.status = "returned"
            common.log(p, user, "artwork" if d.is_artwork else "document", "reopened", f"{d.title}: reopened. {r.reason}", d.stage_key,
                       ref=("document", d.id), to=r.requested_by.name)
        else:
            from .. import schemas as sc
            engine.apply_action(db, user, p, sc.ActionIn(action="return", note=f"Reopen approved: {r.reason}", to_stage=r.ref))
    notify.notify(db, r.requested_by_id, "approval", "Reopen " + ("approved" if approve else "declined"),
                  f"Project: {p.name} · {r.label} · Decided by {user.name}" + (f" · {note}" if note else "") + (" · Action: make the changes" if approve else ""), p.id,
                  link=f"tab=overview&focus=reopen-{r.id}")
    common.log(p, user, "project", "reopen_" + ("approved" if approve else "rejected"), f"{r.label}: {note}".strip(": "), ref=("reopen", r.id), to=r.requested_by.name)
    db.commit()
    return r
