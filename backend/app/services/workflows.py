"""Workflow versions: draft -> published. Published versions are immutable; projects stay on the version they started on."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import workflow
from ..models import AdminEvent, Project, Role, User, WorkflowDef, WorkflowFeedback, aware
from . import common
from .common import WorkflowError


def load_registry(db: Session):
    """Make every stored version available to projects (called at startup and after a change)."""
    for d in db.scalars(select(WorkflowDef)):
        try:
            workflow.register(d.id, workflow.Flow.from_def(d.definition))
        except Exception:  # a broken draft must never stop the app
            continue


def role_keys(db: Session) -> set[str]:
    return {r.key for r in db.scalars(select(Role))}


def current(db: Session) -> WorkflowDef | None:
    return db.scalar(select(WorkflowDef).where(WorkflowDef.status == "published").order_by(WorkflowDef.version.desc()))


def get_def(db: Session, wid: int) -> WorkflowDef:
    d = db.get(WorkflowDef, wid)
    if not d:
        raise common.NotFound("Workflow not found")
    return d


def iso(v):
    return aware(v).isoformat() if v else None


def _log(db: Session, user: User, action: str, note: str):
    db.add(AdminEvent(actor=user.name, action=action, note=note))


def _validated(db: Session, definition: dict) -> dict:
    errs = workflow.validate_def(definition, role_keys(db))
    if errs:
        raise WorkflowError(" ".join(errs[:6]) + (f" (and {len(errs) - 6} more)" if len(errs) > 6 else ""))
    flow = workflow.Flow.from_def(definition)
    return flow.to_def()  # normalised


def create_draft(db: Session, user: User, name: str, description: str = "", preset: str | None = None, from_id: int | None = None) -> WorkflowDef:
    common.require(user, "manage_workflow", "create workflow drafts")
    if from_id:
        src = get_def(db, from_id)
        definition, based = src.definition, f"{src.name}" + (f" v{src.version}" if src.version else " (draft)")
    elif preset:
        if preset not in workflow.PRESETS:
            raise WorkflowError("Unknown preset.")
        definition, based = workflow.preset_def(preset), "Preset: " + workflow.PRESETS[preset][0]
    else:
        raise WorkflowError("Choose a preset or an existing workflow to start from.")
    d = WorkflowDef(name=name.strip() or workflow.PRESETS.get(preset or "", ("New workflow",))[0], description=description,
                    status="draft", definition=_validated(db, definition), based_on=based, created_by=user.name)
    db.add(d)
    _log(db, user, "workflow_draft", f"Draft '{d.name}' created from {based}")
    db.commit()
    workflow.register(d.id, workflow.Flow.from_def(d.definition))
    return d


def update_draft(db: Session, user: User, d: WorkflowDef, name: str | None, description: str | None, definition: dict | None) -> WorkflowDef:
    common.require(user, "manage_workflow", "edit workflow drafts")
    if d.status != "draft":
        raise WorkflowError("Only a draft can be edited. Published versions never change: copy it into a new draft instead.")
    if name is not None:
        d.name = name.strip() or d.name
    if description is not None:
        d.description = description
    if definition is not None:
        d.definition = _validated(db, definition)
    d.updated_at = common.now()
    db.commit()
    workflow.register(d.id, workflow.Flow.from_def(d.definition))
    return d


def publish(db: Session, user: User, d: WorkflowDef) -> WorkflowDef:
    common.require(user, "manage_workflow", "publish workflows")
    if d.status != "draft":
        raise WorkflowError("Only a draft can be published.")
    d.definition = _validated(db, d.definition)
    for old in db.scalars(select(WorkflowDef).where(WorkflowDef.status == "published")):
        old.status = "archived"
    d.version = (db.scalar(select(func.max(WorkflowDef.version))) or 0) + 1
    d.status, d.published_at = "published", common.now()
    _log(db, user, "workflow_published", f"'{d.name}' published as version {d.version}. New projects use it; existing projects keep their version.")
    db.commit()
    workflow.register(d.id, workflow.Flow.from_def(d.definition))
    return d


def delete_draft(db: Session, user: User, d: WorkflowDef):
    common.require(user, "manage_workflow", "delete workflow drafts")
    if d.status != "draft":
        raise WorkflowError("Only a draft can be deleted.")
    _log(db, user, "workflow_deleted", f"Draft '{d.name}' deleted")
    db.delete(d)
    db.commit()


def add_feedback(db: Session, user: User, d: WorkflowDef, stage_key: str, body: str) -> WorkflowFeedback:
    if not body.strip():
        raise WorkflowError("Write your comment first.")
    flow = workflow.Flow.from_def(d.definition)
    if stage_key and not flow.has(stage_key):
        raise WorkflowError("Unknown stage.")
    f = WorkflowFeedback(workflow_id=d.id, stage_key=stage_key, author=user.name, role=user.role.name, body=body.strip())
    d.feedback.append(f)
    db.commit()
    return f


def resolve_feedback(db: Session, user: User, fid: int, status: str, resolution: str) -> WorkflowFeedback:
    common.require(user, "manage_workflow", "resolve workflow feedback")
    f = db.get(WorkflowFeedback, fid)
    if not f:
        raise common.NotFound("Comment not found")
    if status not in ("open", "resolved"):
        raise WorkflowError("Unknown status.")
    f.status, f.resolution = status, resolution.strip() if status == "resolved" else ""
    db.commit()
    return f


def feedback_out(f: WorkflowFeedback) -> dict:
    return {"id": f.id, "stage_key": f.stage_key, "author": f.author, "role": f.role, "body": f.body, "status": f.status,
            "resolution": f.resolution, "created_at": iso(f.created_at)}


def def_out(db: Session, d: WorkflowDef, full: bool = True) -> dict:
    flow = workflow.Flow.from_def(d.definition)
    out = {"id": d.id, "name": d.name, "description": d.description, "status": d.status, "version": d.version, "based_on": d.based_on,
           "created_by": d.created_by, "created_at": iso(d.created_at), "updated_at": iso(d.updated_at),
           "published_at": iso(d.published_at), "stage_count": len(flow.stages),
           "parallel_layers": sum(1 for layer in flow.layers() if len(layer) > 1),
           "projects": db.scalar(select(func.count()).select_from(Project).where(Project.workflow_id == d.id)),
           "feedback_open": sum(1 for f in d.feedback if f.status == "open"), "feedback_total": len(d.feedback)}
    if full:
        out["flow"] = flow.payload()
        out["feedback"] = [feedback_out(f) for f in d.feedback]
    return out
