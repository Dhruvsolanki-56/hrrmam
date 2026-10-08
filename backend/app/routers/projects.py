from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import services, workflow
from ..database import get_db
from ..schemas import ActionIn, ProjectCreate, ProjectDetail, ProjectOut

router = APIRouter(prefix="/api")


@router.get("/stages")
def stages():
    return workflow.stages_payload()


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return services.list_projects(db)


@router.post("/projects", response_model=ProjectDetail, status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    return services.create_project(db, data)


def _get_or_404(db: Session, project_id: int):
    p = services.get_project(db, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, project_id)


@router.post("/projects/{project_id}/actions", response_model=ProjectDetail)
def project_action(project_id: int, action: ActionIn, db: Session = Depends(get_db)):
    p = _get_or_404(db, project_id)
    try:
        return services.apply_action(db, p, action)
    except services.WorkflowError as e:
        raise HTTPException(422, str(e))
