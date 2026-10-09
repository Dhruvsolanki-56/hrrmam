from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import services, workflow
from ..database import get_db
from ..export import build_xlsx
from ..schemas import ActionIn, LinkIn, ProjectCreate, ProjectDetail, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/api")


@router.get("/stages")
def stages():
    return workflow.stages_payload()


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return services.list_projects(db)


@router.get("/export.xlsx")
def export_xlsx(status: str = "", stage: str = "", q: str = "", db: Session = Depends(get_db)):
    rows = [p for p in services.list_projects(db)
            if (not status or status == "all" or p.display_status == status)
            and (not stage or stage in p.active_keys)
            and q.lower() in f"{p.name} {p.code or ''} {p.category}".lower()]
    return Response(
        build_xlsx(rows),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="neohealth-projects.xlsx"'},
    )


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


@router.patch("/projects/{project_id}", response_model=ProjectDetail)
def update_project(project_id: int, data: ProjectUpdate, db: Session = Depends(get_db)):
    return services.update_project(db, _get_or_404(db, project_id), data)


@router.post("/projects/{project_id}/actions", response_model=ProjectDetail)
def project_action(project_id: int, action: ActionIn, db: Session = Depends(get_db)):
    p = _get_or_404(db, project_id)
    try:
        return services.apply_action(db, p, action)
    except services.WorkflowError as e:
        raise HTTPException(422, str(e))


@router.post("/projects/{project_id}/links", response_model=ProjectDetail, status_code=201)
def add_link(project_id: int, link: LinkIn, db: Session = Depends(get_db)):
    return services.add_link(db, _get_or_404(db, project_id), link)


@router.delete("/projects/{project_id}/links/{link_id}", response_model=ProjectDetail)
def delete_link(project_id: int, link_id: int, db: Session = Depends(get_db)):
    try:
        return services.delete_link(db, _get_or_404(db, project_id), link_id)
    except services.WorkflowError as e:
        raise HTTPException(404, str(e))
