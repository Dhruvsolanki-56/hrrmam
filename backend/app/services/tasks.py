"""The task, deadline and rework engine.

assigned -> accepted -> in_progress -> submitted -> approved -> locked
                                          |-> changes_requested -> resubmitted -> (approved ...)
Due dates are negotiated: the assignee proposes a new date with a reason, the assigner approves or rejects.
Every transition is logged; nothing is overwritten silently.
"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import workflow
from ..models import DateRequest, Project, Task, User, aware
from . import common, notify
from .common import Forbidden, WorkflowError


def get_task(db: Session, task_id: int) -> Task:
    t = db.get(Task, task_id)
    if not t:
        raise common.NotFound("Task not found")
    return t


def _fmt(dt: datetime | None) -> str:
    return aware(dt).strftime("%d %b %Y %H:%M") if dt else "none"


def create_task(db: Session, user: User, p: Project, stage_key: str, title: str, description: str, assignee_id: int,
                due_at: datetime, required: bool = True) -> Task:
    common.require(user, "assign", "assign tasks")
    common.ensure_open(p)
    if stage_key not in workflow.STAGE_INDEX:
        raise WorkflowError("Unknown stage.")
    row = p.row(stage_key)
    if row.state in workflow.SATISFIED and not user.can("edit_approved"):
        raise WorkflowError("That stage is already approved. Only roles that can edit approved records may add work to it.")
    assignee = db.get(User, assignee_id)
    if not assignee or not assignee.active:
        raise WorkflowError("Choose an active person to assign this to.")
    if not user.can_assign_to(assignee.role_key):
        raise Forbidden(f"Your role ({user.role.name}) is not allowed to assign work to {assignee.role.name}.")
    t = Task(project_id=p.id, stage_key=stage_key, title=title.strip(), description=description.strip(),
             assignee_id=assignee.id, assigner_id=user.id, due_at=due_at, required=required, state="assigned")
    t.project, t.assignee, t.assigner = p, assignee, user
    db.add(t)
    db.flush()
    common.log(p, user, "task", "assigned", f"{t.title} → {assignee.name}, due {_fmt(due_at)}", stage_key, t.id)
    notify.notify(db, assignee.id, "assigned", "New task assigned", notify.task_line(t, "Accept it or request a different date"),
                  p.id, t.id)
    db.commit()
    return t


def _can_decide(user: User, t: Task, perm: str) -> bool:
    if user.id == t.assignee_id and user.role_key != "super_admin":
        return False  # no self-approval
    if user.id == t.assigner_id:
        return True
    return user.can(perm) and common.role_ok(user, workflow.stage(t.stage_key).approver_roles)


def _only_assignee(user: User, t: Task, verb: str):
    if user.id != t.assignee_id and user.role_key != "super_admin":
        raise Forbidden(f"Only the assignee ({t.assignee.name}) can {verb} this task.")


def apply_action(db: Session, user: User, t: Task, a) -> Task:
    p = t.project
    act, note = a.action, a.note.strip()
    common.ensure_open(p)
    state = t.state
    detail = note

    if state == "locked" and act != "unlock":
        raise WorkflowError("This task is locked. Unlock it first (needs permission).")

    if act == "accept":
        _only_assignee(user, t, "accept")
        if state != "assigned":
            raise WorkflowError("Only a newly assigned task can be accepted.")
        t.state = "accepted"
    elif act == "start":
        _only_assignee(user, t, "start")
        if state != "accepted":
            raise WorkflowError("Accept the task before starting it.")
        t.state = "in_progress"
    elif act == "submit":
        _only_assignee(user, t, "submit")
        if state in ("accepted", "in_progress"):
            t.state = "submitted"
        elif state == "changes_requested":
            t.state = "resubmitted"
        elif state == "assigned":
            raise WorkflowError("Accept the task first.")
        else:
            raise WorkflowError("This task cannot be submitted right now.")
        for uid in {t.assigner_id, p.project_manager_id} - {None, user.id}:
            notify.notify(db, uid, "approval", "Task submitted for approval", notify.task_line(t, "Approve it or request changes"), p.id, t.id)
    elif act in ("approve", "request_changes"):
        if state not in workflow.TASK_AWAITING:
            raise WorkflowError("Only submitted work can be approved or sent back.")
        if not _can_decide(user, t, "approve" if act == "approve" else "request_changes"):
            raise Forbidden("You cannot decide this task: it must be the person who assigned it, or a role that approves this stage "
                            "(and never the assignee).")
        if act == "approve":
            t.state = "approved"
            notify.notify(db, t.assignee_id, "approval", "Task approved", notify.task_line(t, "None, it is approved"), p.id, t.id)
        else:
            detail = common.need_note(note, "Please say what needs to change.")
            t.state = "changes_requested"
            t.rework_count += 1
            notify.notify(db, t.assignee_id, "changes", "Changes requested", notify.task_line(t, "Make the changes and resubmit") + f" · {detail}", p.id, t.id)
    elif act == "lock":
        common.require(user, "lock_unlock", "lock records")
        if state != "approved":
            raise WorkflowError("Only an approved task can be locked.")
        t.state = "locked"
    elif act == "unlock":
        common.require(user, "lock_unlock", "unlock records")
        if state != "locked":
            raise WorkflowError("This task is not locked.")
        detail = common.need_note(note, "Please add a note explaining why it is being unlocked.")
        t.state = "approved"
    elif act == "request_date":
        _only_assignee(user, t, "request a date change for")
        if state not in ("assigned", "accepted", "in_progress", "changes_requested"):
            raise WorkflowError("A date change can only be requested while the work is still open.")
        if t.pending_request:
            raise WorkflowError("A date change request is already waiting for a decision.")
        if not a.due_at:
            raise WorkflowError("Propose a new due date.")
        detail = common.need_note(note, "Please give a reason for the new date.")
        req = DateRequest(task_id=t.id, proposed_due=a.due_at, previous_due=t.due_at, reason=detail, requested_by_id=user.id)
        req.requested_by = user
        t.date_requests.append(req)
        detail = f"Proposed {_fmt(a.due_at)} (was {_fmt(t.due_at)}). {detail}"
        for uid in {t.assigner_id, p.project_manager_id} - {None, user.id}:
            notify.notify(db, uid, "date_request", "Due-date change requested", notify.task_line(t, f"Decide on the new date {_fmt(a.due_at)}"), p.id, t.id)
    elif act in ("approve_date", "reject_date"):
        req = t.pending_request
        if not req:
            raise WorkflowError("There is no date change request to decide.")
        if not (user.id == t.assigner_id or user.can("change_dates")):
            raise Forbidden("Only the person who assigned the task, or a role that can change dates, decides on dates.")
        if act == "approve_date":
            req.status, t.due_at = "approved", req.proposed_due
            detail = f"New due date {_fmt(req.proposed_due)}. {note}".strip()
        else:
            req.status = "rejected"
            detail = f"Kept {_fmt(t.due_at)}. " + common.need_note(note, "Please say why the date cannot change.")
        req.decided_by, req.decision_note, req.decided_at = user, note, common.now()
        notify.notify(db, t.assignee_id, "date_decision", "Due date " + ("changed" if act == "approve_date" else "kept"),
                      notify.task_line(t, "Work to the " + ("new" if act == "approve_date" else "original") + " date"), p.id, t.id)
    elif act == "reassign":
        common.require(user, "reassign", "reassign tasks")
        if state in workflow.TASK_DONE:
            raise WorkflowError("Approved work cannot be reassigned.")
        new = db.get(User, a.assignee_id) if a.assignee_id else None
        if not new or not new.active:
            raise WorkflowError("Choose an active person.")
        if not user.can_assign_to(new.role_key):
            raise Forbidden(f"Your role ({user.role.name}) is not allowed to assign work to {new.role.name}.")
        detail = f"{t.assignee.name} → {new.name}. {note}".strip()
        t.assignee_id, t.assignee, t.state = new.id, new, "assigned"
        notify.notify(db, new.id, "assigned", "Task reassigned to you", notify.task_line(t, "Accept it or request a different date"), p.id, t.id)
    elif act == "bypass":
        common.require(user, "bypass_optional")
        if t.required:
            raise WorkflowError("This task is required. Make it optional first, or complete it.")
        if state in workflow.TASK_DONE:
            raise WorkflowError("This task is already finished.")
        detail = common.need_note(note, "Please add a note explaining why this is not needed.")
        t.state, t.bypassed = "approved", True
    else:
        raise WorkflowError("Unknown action.")

    common.log(p, user, "task", act, f"{t.title}: {detail}" if detail else t.title, t.stage_key, t.id)
    db.commit()
    return t


def update_task(db: Session, user: User, t: Task, data) -> Task:
    p = t.project
    common.ensure_open(p)
    if t.state == "locked":
        raise WorkflowError("This task is locked. Unlock it first.")
    if not (user.id == t.assigner_id or user.can("manage_project")):
        raise Forbidden("Only the person who assigned a task, or a project manager, can edit it.")
    if t.state in workflow.TASK_DONE and not user.can("edit_approved"):
        raise Forbidden(f"Your role ({user.role.name}) cannot edit approved records.")
    ch = data.model_dump(exclude_unset=True)
    diffs = []
    for k, v in ch.items():
        if v is None or getattr(t, k) == v:
            continue
        if k == "due_at":
            if not (user.id == t.assigner_id or user.can("change_dates")):
                raise Forbidden("Changing a due date needs permission to change dates.")
            diffs.append(f"Due: {_fmt(t.due_at)} → {_fmt(v)}")
        else:
            diffs.append(f"{k.title()}: {getattr(t, k)} → {v}")
        setattr(t, k, v)
    if diffs:
        common.log(p, user, "task", "edit", f"{t.title}: " + "; ".join(diffs), t.stage_key, t.id)
    db.commit()
    return t


def my_tasks(db: Session, user_id: int) -> list[Task]:
    return list(db.scalars(select(Task).join(Project).where(Task.assignee_id == user_id, Project.status != "rejected")
                           .order_by(Task.due_at)))
