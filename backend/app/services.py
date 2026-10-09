"""Business rules. Routers stay thin; the DB is only touched through the Session passed in."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from . import workflow
from .models import Project, ProjectEvent, ProjectLink
from .schemas import ActionIn, LinkIn, ProjectCreate, ProjectUpdate


class WorkflowError(Exception):
    pass


def list_projects(db: Session) -> list[Project]:
    q = select(Project).options(selectinload(Project.events)).order_by(Project.updated_at.desc(), Project.id.desc())
    return list(db.scalars(q))


def get_project(db: Session, project_id: int) -> Project | None:
    return db.get(Project, project_id)


def create_project(db: Session, data: ProjectCreate) -> Project:
    p = Project(**data.model_dump(), stage_key=workflow.FIRST_STAGE, status="active")
    p.events.append(ProjectEvent(stage_key=p.stage_key, action="created", actor=data.initiator,
                                 note="Project created"))
    db.add(p)
    db.commit()
    return p


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


def apply_action(db: Session, p: Project, a: ActionIn) -> Project:
    st = workflow.stage(p.stage_key)
    note = a.note.strip()
    to_stage = None

    if p.status in ("rejected", "completed") and a.action != "reopen":
        raise WorkflowError(f"Project is {p.status}. Reopen it to continue.")

    if a.action == "reopen":
        if p.status not in ("rejected", "completed"):
            raise WorkflowError("Only a rejected or completed project can be reopened.")
        if not note:
            raise WorkflowError("Please add a note explaining why it is being reopened.")
        p.status = "active"
    elif a.action == "return":
        if not note:
            raise WorkflowError("Please add a note explaining why it is moving back.")
        if a.to_stage not in workflow.STAGE_INDEX:
            raise WorkflowError("Choose the stage to move back to.")
        if workflow.STAGE_INDEX[a.to_stage] >= workflow.STAGE_INDEX[p.stage_key]:
            raise WorkflowError("A project can only move back to an earlier stage.")
        to_stage = a.to_stage
        p.stage_key = a.to_stage
        p.status = "active"
    elif a.action == "resume":
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

    p.events.append(ProjectEvent(stage_key=st.key, action=a.action, note=note, actor=a.actor.strip(), to_stage=to_stage))
    db.commit()
    return p
