"""Shared helpers: errors, permission checks, audit logging, settings."""
import functools
import threading
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


_LOCK = threading.RLock()


def serial(fn):
    """Run a state-changing action one at a time and from fresh data, so two people acting on the same record at the
    same moment cannot both win (SQLite has no row locks)."""
    @functools.wraps(fn)
    def run(db, *a, **k):
        with _LOCK:
            db.expire_all()
            return fn(db, *a, **k)
    return run


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
        task_id: int | None = None, to_stage: str | None = None, ref: tuple | None = None, to: str = ""):
    """One audit row. `ref` is (kind, id) of the record it is about; `to` says who it was sent to / who must act next."""
    p.events.append(ProjectEvent(area=area, action=action, note=note, stage_key=stage_key or p.stage_key,
                                 actor=user.name if user else "System", actor_id=user.id if user else None, task_id=task_id,
                                 to_stage=to_stage, ref_kind=ref[0] if ref else "", ref_id=ref[1] if ref else None, to_user=to))


def get_setting(db: Session, key: str) -> str:
    s = db.get(Setting, key)
    return s.value if s else workflow.DEFAULT_SETTINGS.get(key, "")


def need_note(note: str, msg: str):
    if not note.strip():
        raise WorkflowError(msg)
    return note.strip()


def fmt_date(d) -> str:
    return d.strftime("%d %b %Y") if d else "no date"
