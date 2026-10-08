"""Business rules. Routers stay thin; the DB is only touched through the Session passed in."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import workflow
from .models import Project, ProjectEvent
from .schemas import ActionIn, ProjectCreate


class WorkflowError(Exception):
    pass


def list_projects(db: Session) -> list[Project]:
    return list(db.scalars(select(Project).order_by(Project.updated_at.desc(), Project.id.desc())))


def get_project(db: Session, project_id: int) -> Project | None:
    return db.get(Project, project_id)


def create_project(db: Session, data: ProjectCreate) -> Project:
    p = Project(**data.model_dump(), stage_key=workflow.FIRST_STAGE, status="active")
    p.events.append(ProjectEvent(stage_key=p.stage_key, action="created", actor=data.initiator,
                                 note="Project created"))
    db.add(p)
    db.commit()
    return p


def _next_code(db: Session, year: int) -> str:
    n = db.scalar(select(func.count()).select_from(Project).where(Project.code.like(f"NH-{year}-%"))) + 1
    return f"NH-{year}-{n:03d}"


def apply_action(db: Session, p: Project, a: ActionIn) -> Project:
    st = workflow.stage(p.stage_key)
    note = a.note.strip()

    if p.status in ("rejected", "completed"):
        raise WorkflowError(f"Project is {p.status} and can no longer be changed.")

    if a.action == "resume":
        if p.status not in ("on_hold", "clarification"):
            raise WorkflowError("Only a project on hold or awaiting clarification can be resumed.")
        p.status = "active"
    elif p.status in ("on_hold", "clarification"):
        raise WorkflowError("Resume the project before taking another action.")
    elif a.action == "clarify":
        if not st.clarify:
            raise WorkflowError("Clarification can only be requested at India Review.")
        if not note:
            raise WorkflowError("Please describe what information is missing.")
        p.status = "clarification"
    elif a.action == "hold":
        if not note:
            raise WorkflowError("Please add a note explaining why the project is on hold.")
        p.status = "on_hold"
    elif a.action == "reject":
        if not st.gate:
            raise WorkflowError("This stage has no approval decision to reject.")
        if not note:
            raise WorkflowError("Please add a note explaining the rejection.")
        if st.reject_to:
            p.stage_key = st.reject_to  # returned for modification
        else:
            p.status = "rejected"
    elif a.action in ("advance", "approve"):
        if a.action == "approve" and not st.gate:
            raise WorkflowError("This stage is not an approval gate; use complete.")
        if a.action == "advance" and st.gate:
            raise WorkflowError("This stage needs an approval decision.")
        if p.stage_key == workflow.CODE_STAGE and not p.code:
            p.code = _next_code(db, p.created_at.year)
        nxt = workflow.next_stage(p.stage_key)
        if nxt:
            p.stage_key = nxt.key
        else:
            p.status = "completed"
    else:
        raise WorkflowError("Unknown action.")

    p.events.append(ProjectEvent(stage_key=st.key, action=a.action, note=note, actor=a.actor.strip()))
    db.commit()
    return p
