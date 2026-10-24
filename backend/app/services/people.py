"""Who is responsible, who approves, who must fix: real names instead of "X or Y or Z".

A stage can have a named lead and a named approver (set by a project manager). When nobody is named, the people in the
stage's roles are listed, with the project manager shown separately as oversight rather than mixed in as a co-owner."""
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from ..models import Project, ProjectEvent, User


def holders(db: Session, roles) -> list[User]:
    """Active people in these roles. Looked up once per request (and again after anything is saved)."""
    if not roles:
        return []
    key = tuple(sorted(roles))
    cache = db.info.setdefault("holders", {})
    if key not in cache:
        cache[key] = list(db.scalars(select(User).where(User.active.is_(True), User.role_key.in_(list(key))).order_by(User.id)))
    return list(cache[key])


@event.listens_for(Session, "after_commit")
def _forget_holders(session):
    session.info.pop("holders", None)


def role_name(u: User) -> str:
    return u.role.name.split(" (")[0]


def tag(u: User) -> str:
    return f"{u.name} ({role_name(u)})"


def tags(users) -> list[str]:
    return [tag(u) for u in users]


def names(users) -> str:
    """'Rajiv Kapoor (Director)' or 'Rajiv Kapoor (Director) or Anjali Desai (Regulatory)'."""
    t = tags(users)
    return " or ".join(t) if len(t) <= 2 else f"{t[0]}, {t[1]} or {len(t) - 2} more"


def _user(db: Session, uid: int | None) -> User | None:
    u = db.get(User, uid) if uid else None
    return u if u and u.active else None


# ---------------------------------------------------------------- stages
def stage_responsible(db: Session, p: Project, row) -> list[User]:
    """Who does the work on this stage: the named lead, else the people in the owner roles (without the project manager
    when a specialist exists, because the manager oversees rather than does the work)."""
    lead = _user(db, row.lead_id)
    if lead:
        return [lead]
    people = holders(db, p.flow.stage(row.stage_key).owner_roles)
    return [u for u in people if u.role_key != "project_manager"] or people


def stage_oversight(db: Session, p: Project, row) -> list[User]:
    mine = {u.id for u in stage_responsible(db, p, row)}
    pm = p.project_manager
    return [pm] if pm and pm.active and pm.id not in mine else []


def stage_approvers(db: Session, p: Project, row, exclude_id: int | None = None) -> list[User]:
    """Who approves: the named approver, else everyone in the approver roles, never the person who did the work."""
    named = _user(db, row.approver_id)
    if named and named.id != exclude_id:
        return [named]
    return [u for u in holders(db, p.flow.stage(row.stage_key).approver_roles) if u.id != exclude_id]


# ---------------------------------------------------------------- records inside a stage (agreements, dossier items, documents ...)
def _index(p: Project):
    """Audit rows grouped by the record they are about, rebuilt only when a row was added."""
    ev = p.events
    c = p.__dict__.get("_trail_idx")
    if c and c[0] == len(ev):
        return c[1]
    by_ref, legacy = {}, {}
    for e in ev:
        if e.ref_kind and e.ref_id is not None:
            by_ref.setdefault((e.ref_kind, e.ref_id), []).append(e)
        elif not e.ref_kind:
            legacy.setdefault(e.area, []).append(e)
    p.__dict__["_trail_idx"] = (len(ev), (by_ref, legacy))
    return by_ref, legacy


def trail(p: Project, kind: str, obj_id: int, area: str, title: str) -> list[ProjectEvent]:
    """Every audit row about one record, oldest first. Rows written before records carried a reference are matched by title."""
    by_ref, legacy = _index(p)
    out = list(by_ref.get((kind, obj_id), []))
    if title:
        out += [e for e in legacy.get(area, []) if e.note.startswith(title)]
    return sorted(out, key=lambda e: e.id or 0) if len(out) > 1 and any(e.ref_kind == "" for e in out) else out


def last(evs: list[ProjectEvent], *actions) -> ProjectEvent | None:
    return next((e for e in reversed(evs) if e.action in actions), None)


def submitter(db: Session, evs: list[ProjectEvent]) -> User | None:
    e = last(evs, "submit")
    if not e:
        return None
    u = _user(db, e.actor_id)
    if u:
        return u
    return db.scalar(select(User).where(User.name == e.actor, User.active.is_(True)))


def entry_approvers(db: Session, p: Project, kind: str, exclude_id: int | None = None) -> list[User]:
    roles = p.flow.rules[kind].get("roles", [])
    return [u for u in holders(db, roles) if u.id != exclude_id]


def fixers(db: Session, p: Project, stage_key: str, evs: list[ProjectEvent], owner: User | None = None) -> list[User]:
    """Who must correct something that was sent back: whoever submitted it, else its owner, else the stage's workers."""
    e = last(evs, "submit", "reopened")
    if e and e.action == "reopened":  # whoever asked for it to be reopened is the one who amends it
        u = db.scalar(select(User).where(User.name == e.to_user, User.active.is_(True)))
        if u:
            return [u]
    sub = submitter(db, evs)
    if sub:
        return [sub]
    if owner and owner.active:
        return [owner]
    if stage_key and p.flow.has(stage_key):
        return stage_responsible(db, p, p.row(stage_key))
    return [p.project_manager] if p.project_manager else []


def deciders_for_reopen(db: Session, requester_id: int | None) -> list[User]:
    """Everybody who may unlock records: they are the people who decide a reopen request."""
    return [u for u in db.scalars(select(User).where(User.active.is_(True)).order_by(User.id)) if u.can("lock_unlock") and u.id != requester_id]


def counterparty(db: Session, evs: list[ProjectEvent], user: User) -> list[User]:
    """Whoever last sent this record back (or approved it), so a note from the fixer reaches them."""
    e = last(evs, "return", "reject", "approve")
    if not e or e.actor_id in (None, user.id):
        return []
    u = _user(db, e.actor_id)
    return [u] if u and u.active else []
