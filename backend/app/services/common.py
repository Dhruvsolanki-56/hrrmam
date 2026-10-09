"""Shared helpers: errors, permission checks, audit logging, settings."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .. import workflow
from ..models import Project, ProjectEvent, Setting, User


class WorkflowError(Exception):
    """A business rule stopped the action (HTTP 422)."""


class Forbidden(Exception):
    """The signed-in user is not allowed to do this (HTTP 403)."""


class NotFound(Exception):
    """HTTP 404."""


def now() -> datetime:
    return datetime.now(timezone.utc)


def require(user: User, perm: str, what: str = ""):
    if not user.can(perm):
        raise Forbidden(f"Your role ({user.role.name}) cannot {what or workflow.PERMISSIONS[perm].lower()}.")


def role_ok(user: User, roles) -> bool:
    return user.role_key == "super_admin" or user.role_key in roles


def ensure_open(p: Project):
    if p.status in ("rejected", "completed"):
        raise WorkflowError(f"This project is {p.status}. It must be reopened before anything else changes.")
    if p.status == "on_hold":
        raise WorkflowError("This project is on hold. Resume it first.")


def log(p: Project, user: User | None, area: str, action: str, note: str = "", stage_key: str = "",
        task_id: int | None = None, to_stage: str | None = None):
    p.events.append(ProjectEvent(area=area, action=action, note=note, stage_key=stage_key or p.stage_key,
                                 actor=user.name if user else "System", task_id=task_id, to_stage=to_stage))


def get_setting(db: Session, key: str) -> str:
    s = db.get(Setting, key)
    return s.value if s else workflow.DEFAULT_SETTINGS.get(key, "")


def need_note(note: str, msg: str):
    if not note.strip():
        raise WorkflowError(msg)
    return note.strip()


def fmt_date(d) -> str:
    return d.strftime("%d %b %Y") if d else "no date"
