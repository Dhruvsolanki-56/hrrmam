"""Workflow versions: list, view, create a draft, edit, publish, comment (feedback)."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas as sc
from ..auth import current_user
from ..database import get_db
from ..models import User, WorkflowDef
from ..services import workflows

router = APIRouter(prefix="/api", dependencies=[Depends(current_user)])


@router.get("/workflows")
def list_workflows(db: Session = Depends(get_db)):
    rows = db.scalars(select(WorkflowDef).order_by(WorkflowDef.id.desc()))
    return [workflows.def_out(db, d, full=False) for d in rows]


@router.get("/workflows/{wid}")
def get_workflow(wid: int, db: Session = Depends(get_db)):
    return workflows.def_out(db, workflows.get_def(db, wid))


@router.post("/workflows", status_code=201)
def create_workflow(data: sc.WorkflowCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = workflows.create_draft(db, user, data.name, data.description, data.preset, data.from_id)
    return workflows.def_out(db, d)


@router.put("/workflows/{wid}")
def update_workflow(wid: int, data: sc.WorkflowUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = workflows.update_draft(db, user, workflows.get_def(db, wid), data.name, data.description, data.definition)
    return workflows.def_out(db, d)


@router.post("/workflows/{wid}/publish")
def publish_workflow(wid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return workflows.def_out(db, workflows.publish(db, user, workflows.get_def(db, wid)))


@router.delete("/workflows/{wid}")
def delete_workflow(wid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    workflows.delete_draft(db, user, workflows.get_def(db, wid))
    return {"ok": True}


@router.post("/workflows/{wid}/feedback", status_code=201)
def add_feedback(wid: int, data: sc.FeedbackIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = workflows.get_def(db, wid)
    workflows.add_feedback(db, user, d, data.stage_key, data.body)
    return workflows.def_out(db, d)


@router.patch("/workflow-feedback/{fid}")
def resolve_feedback(fid: int, data: sc.FeedbackResolve, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = workflows.resolve_feedback(db, user, fid, data.status, data.resolution)
    return workflows.def_out(db, workflows.get_def(db, f.workflow_id))
