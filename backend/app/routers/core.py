"""Public lookups, identity, admin (users / roles / permissions / settings), notifications, portals, audit, registers."""
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import export, workflow
from .. import schemas as sc
from .. import serialize as S
from ..auth import current_user
from ..database import get_db
from ..models import AdminEvent, Notification, Role, Setting, User
from ..services import common, dash, notify, workflows
from ..services.common import Forbidden, WorkflowError

public = APIRouter(prefix="/api")
router = APIRouter(prefix="/api", dependencies=[Depends(current_user)])


# ---------------------------------------------------------------- public
@public.get("/stages")
def stages(db: Session = Depends(get_db)):
    wf = workflows.current(db)
    return workflow.get(wf.id).payload()["stages"] if wf else []


@public.get("/config")
def config(db: Session = Depends(get_db)):
    return {
        "permissions": workflow.PERMISSIONS,
        "roles": [{"key": r.key, "name": r.name} for r in db.scalars(select(Role))],
        "submission_types": {k: [{"module": m, "title": t} for m, t in v] for k, v in workflow.SUBMISSION_TYPES.items()},
        "agreement_kinds": workflow.AGREEMENT_KINDS, "core_agreements": workflow.CORE_AGREEMENTS, "agreement_status": workflow.AGREEMENT_STATUS,
        "mfr_kinds": workflow.MFR_KINDS, "mfr_status": workflow.MFR_STATUS, "artwork_kinds": workflow.ARTWORK_KINDS,
        "doc_kinds": workflow.DOC_KINDS, "dossier_status": workflow.DOSSIER_STATUS, "task_states": workflow.TASK_STATES,
        "settings": {k: common.get_setting(db, k) for k in workflow.DEFAULT_SETTINGS},
        "features": workflow.FEATURES, "entities": workflow.ENTITIES, "rule_labels": workflow.RULE_LABELS,
        "presets": [{"key": k, "name": v[0], "description": v[1]} for k, v in workflow.PRESETS.items()],
    }


@public.get("/login-users")
def login_users(db: Session = Depends(get_db)):
    return [S.user_brief(u) for u in db.scalars(select(User).where(User.active).order_by(User.id))]


# ---------------------------------------------------------------- identity & admin
def _admin_log(db: Session, user: User, action: str, note: str):
    db.add(AdminEvent(actor=user.name, action=action, note=note))


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, ~Notification.read))
    return {**S.user_full(user), "unread": unread}


@router.get("/users")
def users(all: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(User).order_by(User.id)
    if all:
        common.require(user, "manage_users")
    else:
        q = q.where(User.active)
    return [S.user_full(u) for u in db.scalars(q)]


@router.post("/users", status_code=201)
def create_user(data: sc.UserCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    common.require(user, "manage_users")
    if not db.get(Role, data.role_key):
        raise WorkflowError("Unknown role.")
    u = User(name=data.name.strip(), email=data.email.strip(), role_key=data.role_key, country=data.country)
    db.add(u)
    _admin_log(db, user, "user_created", f"{u.name} added as {data.role_key}")
    db.commit()
    db.refresh(u)
    return S.user_full(u)


@router.patch("/users/{user_id}")
def update_user(user_id: int, data: sc.UserUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    common.require(user, "manage_users")
    u = db.get(User, user_id)
    if not u:
        raise common.NotFound("User not found")
    ch = data.model_dump(exclude_unset=True)
    if "role_key" in ch and not db.get(Role, ch["role_key"]):
        raise WorkflowError("Unknown role.")
    admins = db.scalar(select(func.count()).select_from(User).where(User.role_key == "super_admin", User.active))
    losing_admin = u.role_key == "super_admin" and u.active and (ch.get("active") is False or ch.get("role_key", "super_admin") != "super_admin")
    if losing_admin and admins <= 1:
        raise WorkflowError("There must always be at least one active Super Admin.")
    diffs = [f"{k}: {getattr(u, k)} → {v}" for k, v in ch.items() if v is not None and getattr(u, k) != v]
    for k, v in ch.items():
        if v is not None:
            setattr(u, k, v)
    if diffs:
        _admin_log(db, user, "user_updated", f"{u.name}: " + "; ".join(diffs))
    db.commit()
    db.refresh(u)
    return S.user_full(u)


@router.get("/roles")
def roles(db: Session = Depends(get_db)):
    return [{"key": r.key, "name": r.name, "permissions": workflow.ALL if r.key == "super_admin" else list(r.permissions or []),
             "assign_to": ["*"] if r.key == "super_admin" else list(r.assign_to or []),
             "users": db.scalar(select(func.count()).select_from(User).where(User.role_key == r.key, User.active))}
            for r in db.scalars(select(Role).order_by(Role.key))]


@router.put("/roles/{role_key}")
def update_role(role_key: str, data: sc.RoleUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    common.require(user, "manage_users", "change roles and permissions")
    r = db.get(Role, role_key)
    if not r:
        raise common.NotFound("Role not found")
    if role_key == "super_admin":
        raise WorkflowError("The Super Admin role always has every permission.")
    bad = [p for p in data.permissions if p not in workflow.PERMISSIONS]
    keys = {x.key for x in db.scalars(select(Role))}
    bad_assign = [a for a in data.assign_to if a != "*" and a not in keys]
    if bad or bad_assign:
        raise WorkflowError("Unknown permission or role: " + ", ".join(bad + bad_assign))
    before, after = set(r.permissions or []), set(data.permissions)
    notes = []
    if before != after:
        notes.append("permissions " + ", ".join([f"+{x}" for x in sorted(after - before)] + [f"-{x}" for x in sorted(before - after)]))
    if set(r.assign_to or []) != set(data.assign_to):
        notes.append(f"can assign to: {', '.join(data.assign_to) or 'nobody'}")
    r.permissions, r.assign_to = data.permissions, data.assign_to
    if notes:
        _admin_log(db, user, "role_updated", f"{r.name}: " + "; ".join(notes))
    db.commit()
    return {"key": r.key, "permissions": r.permissions, "assign_to": r.assign_to}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return {k: common.get_setting(db, k) for k in workflow.DEFAULT_SETTINGS}


@router.put("/settings")
def put_settings(data: sc.SettingsUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    common.require(user, "manage_users", "change settings")
    for k, v in data.values.items():
        if k not in workflow.DEFAULT_SETTINGS:
            raise WorkflowError(f"Unknown setting: {k}")
        if k == "reminder_days" and not all(x.strip().isdigit() for x in v.split(",") if x.strip()):
            raise WorkflowError("Reminder days must be whole numbers separated by commas, e.g. 7,3,1,0.")
        if k == "escalate_after_days" and not v.strip().isdigit():
            raise WorkflowError("Escalation days must be a whole number.")
        s = db.get(Setting, k) or Setting(key=k)
        if s.value != v:
            _admin_log(db, user, "setting_changed", f"{k}: {s.value or common.get_setting(db, k)} → {v}")
        s.value = v
        db.add(s)
    db.commit()
    return {k: common.get_setting(db, k) for k in workflow.DEFAULT_SETTINGS}


@router.get("/admin-log")
def admin_log(user: User = Depends(current_user), db: Session = Depends(get_db)):
    common.require(user, "manage_users")
    return [{"id": e.id, "actor": e.actor, "action": e.action, "note": e.note, "created_at": S.iso(e.created_at)}
            for e in db.scalars(select(AdminEvent).order_by(AdminEvent.id.desc()).limit(100))]


# ---------------------------------------------------------------- notifications
@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    notify.refresh_reminders(db)
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(60))
    return [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "project_id": n.project_id, "task_id": n.task_id,
             "read": n.read, "created_at": S.iso(n.created_at)} for n in rows]


@router.post("/notifications/read")
def mark_read(data: sc.ReadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Notification).where(Notification.user_id == user.id, ~Notification.read)
    if not data.all:
        q = q.where(Notification.id.in_(data.ids))
    for n in db.scalars(q):
        n.read = True
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- portals, audit, registers
@router.get("/dashboard/director")
def director(entity: str = "", db: Session = Depends(get_db)):
    return dash.director(db, entity)


@router.get("/dashboard/regulatory")
def regulatory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return dash.regulatory(db, user)


@router.get("/dashboard/artwork")
def artwork(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return dash.artwork(db, user)


@router.get("/audit")
def audit(project_id: int | None = None, area: str = "", q: str = "", limit: int = 200, db: Session = Depends(get_db)):
    return dash.audit(db, project_id, area, q, min(limit, 1000))


@router.get("/legal-register")
def legal_register(status: str = "", q: str = "", db: Session = Depends(get_db)):
    return dash.legal_register(db, status, q)


@router.get("/legal-register.xlsx")
def legal_register_xlsx(status: str = "", q: str = "", db: Session = Depends(get_db)):
    return Response(export.legal_xlsx(dash.legal_register(db, status, q)),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="neo-legal-register.xlsx"'})
