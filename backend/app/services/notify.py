"""In-app notifications and reminder / escalation rules (configurable in settings)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Notification, Project, Task, User, aware
from . import common


def task_line(t: Task, action: str) -> str:
    due = common.fmt_date(aware(t.due_at)) if t.due_at else "no due date"
    return f"Project: {t.project.name} · Task: {t.title} · Owner: {t.assignee.name} · Due: {due} · Action: {action}"


def notify(db: Session, user_id: int | None, kind: str, title: str, body: str = "", project_id: int | None = None,
           task_id: int | None = None, key: str | None = None):
    if not user_id:
        return
    if key:
        db.flush()
        if db.scalar(select(Notification.id).where(Notification.user_id == user_id, Notification.dedupe_key == key)):
            return
    db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, project_id=project_id, task_id=task_id,
                        dedupe_key=key))


def notify_roles(db: Session, roles, kind: str, title: str, body: str = "", project_id: int | None = None,
                 exclude: int | None = None):
    for u in db.scalars(select(User).where(User.active, User.role_key.in_(list(roles) + ["super_admin"]))):
        if u.id != exclude:
            notify(db, u.id, kind, title, body, project_id)


def refresh_reminders(db: Session):
    """Create due / overdue / escalation notifications. Safe to call often: each one is only created once."""
    marks = sorted({int(x) for x in common.get_setting(db, "reminder_days").split(",") if x.strip().isdigit()})
    esc = int(common.get_setting(db, "escalate_after_days") or 1)
    today = common.now().date()
    q = select(Task).join(Project).where(Task.state.in_(("assigned", "accepted", "in_progress", "changes_requested")),
                                         Task.due_at.is_not(None), Project.status == "active")
    for t in db.scalars(q):
        due = aware(t.due_at).date()
        left = (due - today).days
        if left >= 0:
            m = next((x for x in marks if x >= left), None)
            if m is None:
                continue
            title = "Due today" if left == 0 else f"Due in {left} day{'s' if left != 1 else ''}"
            notify(db, t.assignee_id, "reminder", title, task_line(t, "Complete and submit it"), t.project_id, t.id,
                   key=f"remind:{t.id}:{m}:{due}")
        else:
            late = -left
            notify(db, t.assignee_id, "overdue", f"Overdue by {late} day{'s' if late != 1 else ''}",
                   task_line(t, "Submit it now or request a new date"), t.project_id, t.id, key=f"overdue:{t.id}:{due}")
            if late >= esc:
                for uid in {t.assigner_id, t.project.project_manager_id} - {None, t.assignee_id}:
                    notify(db, uid, "escalation", f"Escalation: overdue by {late} day{'s' if late != 1 else ''}",
                           task_line(t, "Follow up with the owner"), t.project_id, t.id, key=f"escalate:{t.id}:{due}")
    db.commit()
