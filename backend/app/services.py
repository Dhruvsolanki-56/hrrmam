"""Business rules. Routers stay thin; the DB is only touched through the Session passed in."""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from . import workflow
from .models import ACTIVE_STATES, Project, ProjectEvent, ProjectLink, ProjectStage
from .schemas import ActionIn, LinkIn, ProjectCreate, ProjectUpdate


class WorkflowError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


def list_projects(db: Session) -> list[Project]:
    q = select(Project).options(selectinload(Project.stages)).order_by(Project.updated_at.desc(), Project.id.desc())
    return list(db.scalars(q))


def get_project(db: Session, project_id: int) -> Project | None:
    return db.get(Project, project_id)


# ---------------------------------------------------------------- stage bookkeeping
def _activate(row: ProjectStage):
    """Start a stage: decision-only stages wait for the approver, others for the owner's work."""
    row.state = "awaiting_approval" if workflow.stage(row.stage_key).decision_only else "in_progress"
    row.started_at = _now()
    row.submitted_at = None
    row.decided_at = None


def _init_stages(p: Project):
    for s in workflow.STAGES:
        row = ProjectStage(stage_key=s.key, state="pending")
        if not s.requires:
            _activate(row)
        p.stages.append(row)


def _unlock(p: Project):
    """Activate every pending stage whose prerequisites are all approved."""
    for row in p.stages:
        if row.state != "pending":
            continue
        reqs = workflow.stage(row.stage_key).requires
        if reqs and all((p.row(r) and p.row(r).state == "approved") for r in reqs):
            _activate(row)


def _sync(p: Project):
    """Keep the project-level fields in step with its stages."""
    rows = p.active_rows
    if rows:
        p.stage_key = rows[0].stage_key
    elif all(r.state == "approved" for r in p.stages):
        p.stage_key = workflow.LAST_STAGE
        if p.status == "active":
            p.status = "completed"


def create_project(db: Session, data: ProjectCreate) -> Project:
    p = Project(**data.model_dump(), stage_key=workflow.FIRST_STAGE, status="active")
    _init_stages(p)
    p.events.append(ProjectEvent(stage_key=p.stage_key, action="created", actor=data.initiator,
                                 note="Project created"))
    db.add(p)
    db.commit()
    return p


def backfill_stages(db: Session):
    """Give projects created before per-stage tracking a stage row for every stage."""
    legacy = db.scalars(select(Project).where(~Project.stages.any())).all()
    for p in legacy:
        idx = workflow.STAGE_INDEX.get(p.stage_key, 0)
        for i, s in enumerate(workflow.STAGES):
            row = ProjectStage(stage_key=s.key, state="pending")
            if p.status == "completed" or i < idx:
                row.state = "approved"
            elif i == idx:
                _activate(row)
                if p.status == "clarification":
                    row.state = "clarification"
                row.started_at = p.updated_at
            p.stages.append(row)
        if p.status == "clarification":
            p.status = "active"
    db.commit()


def update_project(db: Session, p: Project, data: ProjectUpdate) -> Project:
    changes = data.model_dump(exclude_unset=True, exclude={"actor"})
    changed = [k.replace("_", " ") for k, v in changes.items() if v is not None and getattr(p, k) != v]
    for k, v in changes.items():
        if v is not None:
            setattr(p, k, v)
    if changed:
        p.events.append(ProjectEvent(stage_key=p.stage_key, action="edit", actor=data.actor.strip(),
                                     note="Updated " + ", ".join(changed)))
    db.commit()
    return p


def add_link(db: Session, p: Project, data: LinkIn) -> Project:
    p.links.append(ProjectLink(title=data.title.strip(), url=data.url))
    db.commit()
    return p


def delete_link(db: Session, p: Project, link_id: int) -> Project:
    link = next((x for x in p.links if x.id == link_id), None)
    if not link:
        raise WorkflowError("Link not found.")
    p.links.remove(link)
    db.commit()
    return p


def _next_code(db: Session, year: int) -> str:
    n = db.scalar(select(func.count()).select_from(Project).where(Project.code.like(f"NH-{year}-%"))) + 1
    return f"NH-{year}-{n:03d}"


def _target_row(p: Project, key: str | None) -> ProjectStage:
    active = p.active_rows
    if key:
        row = p.row(key)
        if not row or row.state not in ACTIVE_STATES:
            raise WorkflowError("That stage is not active right now.")
        return row
    if len(active) == 1:
        return active[0]
    raise WorkflowError("Choose which stage this is for.")


# ---------------------------------------------------------------- actions
def apply_action(db: Session, p: Project, a: ActionIn) -> Project:
    note = a.note.strip()
    act = a.action
    ev_stage = p.stage_key
    to_stage = None

    if p.status in ("rejected", "completed") and act != "reopen":
        raise WorkflowError(f"Project is {p.status}. Reopen it to continue.")

    # ---- project-level actions ----
    if act == "reopen":
        if p.status not in ("rejected", "completed"):
            raise WorkflowError("Only a rejected or completed project can be reopened.")
        if not note:
            raise WorkflowError("Please add a note explaining why it is being reopened.")
        if p.status == "completed":
            last = p.row(workflow.LAST_STAGE)
            _activate(last)
            last.rework_count += 1
        p.status = "active"
    elif act == "resume":
        if p.status != "on_hold":
            raise WorkflowError("Only a project on hold can be resumed.")
        p.status = "active"
    elif act == "hold":
        if p.status != "active":
            raise WorkflowError("This project is already on hold.")
        if not note:
            raise WorkflowError("Please add a note explaining why the project is on hold.")
        p.status = "on_hold"
    elif act == "return":
        if not note:
            raise WorkflowError("Please add a note explaining why it is moving back.")
        target = p.row(a.to_stage) if a.to_stage in workflow.STAGE_INDEX else None
        if not target or target.state != "approved":
            raise WorkflowError("Choose an approved stage to move back to.")
        for key in workflow.descendants(target.stage_key):
            r = p.row(key)
            r.state, r.started_at, r.submitted_at, r.decided_at = "pending", None, None, None
        _activate(target)
        target.rework_count += 1
        to_stage = target.stage_key
        ev_stage = target.stage_key
        p.status = "active"
    elif p.status == "on_hold":
        raise WorkflowError("Resume the project before taking another action.")
    # ---- stage-level actions (the approval cycle) ----
    else:
        row = _target_row(p, a.stage_key)
        st = workflow.stage(row.stage_key)
        ev_stage = row.stage_key

        if act == "submit":
            if st.decision_only:
                raise WorkflowError("This stage is decided directly; there is nothing to submit.")
            if row.state != "in_progress":
                raise WorkflowError("This stage is not waiting for work to be submitted.")
            row.state, row.submitted_at = "awaiting_approval", _now()
        elif act == "approve":
            if row.state != "awaiting_approval":
                raise WorkflowError("Submit the work for approval first.")
            row.state, row.decided_at = "approved", _now()
            if st.key == workflow.CODE_STAGE and not p.code:
                p.code = _next_code(db, p.created_at.year)
            _unlock(p)
        elif act == "send_back":
            if row.state != "awaiting_approval":
                raise WorkflowError("Only work that is awaiting approval can be sent back.")
            if not note:
                raise WorkflowError("Please add a note explaining what needs to change.")
            target = p.row(st.rework_to) if st.rework_to else row
            _activate(target)
            target.state = "in_progress"  # rework always starts as work, even if it was a decision stage
            target.rework_count += 1
            if target is not row:
                row.state, row.started_at, row.submitted_at = "pending", None, None
            to_stage = target.stage_key
        elif act == "reject":
            if row.state != "awaiting_approval":
                raise WorkflowError("Only work that is awaiting approval can be rejected.")
            if not st.can_close:
                raise WorkflowError("The project cannot be rejected at this stage; send it back for rework instead.")
            if not note:
                raise WorkflowError("Please add a note explaining the rejection.")
            p.status = "rejected"
        elif act == "clarify":
            if not st.clarify or row.state != "awaiting_approval":
                raise WorkflowError("Clarification cannot be requested here.")
            if not note:
                raise WorkflowError("Please describe what information is missing.")
            row.state = "clarification"
        elif act == "info":
            if row.state != "clarification":
                raise WorkflowError("Nothing is waiting on more information.")
            row.state = "awaiting_approval"
        else:
            raise WorkflowError("Unknown action.")

    _sync(p)
    p.events.append(ProjectEvent(stage_key=ev_stage, action=act, note=note, actor=a.actor.strip(), to_stage=to_stage))
    db.commit()
    return p
