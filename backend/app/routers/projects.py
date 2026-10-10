"""Projects, tasks and the workstream modules. Every write returns the full Project 360 so the screen just replaces its state."""
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import export
from .. import schemas as sc
from .. import serialize as S
from ..auth import current_user
from ..database import get_db
from ..models import Agreement, DossierItem, ManufacturerRequest, RFICase, RFIQuestion, User
from ..services import dash, engine, modules, notify, tasks

router = APIRouter(prefix="/api", dependencies=[Depends(current_user)])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _P(db: Session, project_id: int):
    return engine.get_project(db, project_id)


def _out(p):
    return S.project_detail(p)


# ---------------------------------------------------------------- projects
@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [S.project_row(p) for p in engine.list_projects(db)]


@router.get("/export.xlsx")
def export_xlsx(status: str = "", stage: str = "", health: str = "", q: str = "", db: Session = Depends(get_db)):
    rows = [S.project_row(p) for p in engine.list_projects(db)]
    rows = [r for r in rows if (not status or status == "all" or r["status"] == status)
            and (not stage or stage in r["active_stages"]) and (not health or r["health"] == health)
            and q.lower() in f"{r['name']} {r['code'] or ''} {r['category']} {r['product']}".lower()]
    return Response(export.projects_xlsx(rows), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="neo-projects.xlsx"'})


@router.post("/projects", status_code=201)
def create_project(data: sc.ProjectCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(engine.create_project(db, user, data))


@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    return _out(_P(db, project_id))


@router.patch("/projects/{project_id}")
def update_project(project_id: int, data: sc.ProjectUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(engine.update_project(db, user, _P(db, project_id), data))


@router.post("/projects/{project_id}/actions")
def project_action(project_id: int, action: sc.ActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(engine.apply_action(db, user, _P(db, project_id), action))


# ---------------------------------------------------------------- tasks
@router.post("/projects/{project_id}/tasks", status_code=201)
def create_task(project_id: int, data: sc.TaskCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    tasks.create_task(db, user, p, data.stage_key, data.title, data.description, data.assignee_id, data.due_at, data.required)
    return _out(p)


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, data: sc.TaskUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(tasks.update_task(db, user, tasks.get_task(db, task_id), data).project)


@router.post("/tasks/{task_id}/actions")
def task_action(task_id: int, data: sc.TaskActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(tasks.apply_action(db, user, tasks.get_task(db, task_id), data).project)


@router.get("/my-work")
def my_work(user: User = Depends(current_user), db: Session = Depends(get_db)):
    notify.refresh_reminders(db)
    return dash.my_work(db, user)


# ---------------------------------------------------------------- legal
@router.post("/projects/{project_id}/agreements", status_code=201)
def create_agreement(project_id: int, data: sc.AgreementCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    modules.create_agreement(db, user, p, data)
    return _out(p)


@router.post("/agreements/{agreement_id}/actions")
def agreement_action(agreement_id: int, data: sc.EntryActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(Agreement, agreement_id)
    if not a:
        raise modules.common.NotFound("Agreement not found")
    return _out(modules.entry_action(db, user, "agreement", a, data.action, data.note).project)


@router.post("/dossier-items/{item_id}/actions")
def dossier_action(item_id: int, data: sc.EntryActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    it = db.get(DossierItem, item_id)
    if not it:
        raise modules.common.NotFound("Item not found")
    return _out(modules.entry_action(db, user, "dossier_item", it, data.action, data.note).project)


@router.post("/mfr/{mfr_id}/actions")
def mfr_action(mfr_id: int, data: sc.EntryActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(ManufacturerRequest, mfr_id)
    if not m:
        raise modules.common.NotFound("Request not found")
    return _out(modules.entry_action(db, user, "mfr", m, data.action, data.note).project)


@router.patch("/agreements/{agreement_id}")
def update_agreement(agreement_id: int, data: sc.AgreementUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(Agreement, agreement_id)
    if not a:
        raise modules.common.NotFound("Agreement not found")
    return _out(modules.update_agreement(db, user, a, data).project)


# ---------------------------------------------------------------- regulatory
@router.post("/projects/{project_id}/dossier-items", status_code=201)
def create_dossier_item(project_id: int, data: sc.DossierItemCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    modules.create_dossier_item(db, user, p, data)
    return _out(p)


@router.patch("/dossier-items/{item_id}")
def update_dossier_item(item_id: int, data: sc.DossierItemUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    it = db.get(DossierItem, item_id)
    if not it:
        raise modules.common.NotFound("Item not found")
    return _out(modules.update_dossier_item(db, user, it, data).project)


@router.post("/projects/{project_id}/submissions", status_code=201)
def record_submission(project_id: int, data: sc.SubmissionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    modules.record_submission(db, user, p, data)
    return _out(p)


# ---------------------------------------------------------------- manufacturer data
@router.post("/projects/{project_id}/mfr", status_code=201)
def create_mfr(project_id: int, data: sc.MfrCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    modules.create_mfr(db, user, p, data)
    return _out(p)


@router.patch("/mfr/{mfr_id}")
def update_mfr(mfr_id: int, data: sc.MfrUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(ManufacturerRequest, mfr_id)
    if not m:
        raise modules.common.NotFound("Request not found")
    return _out(modules.update_mfr(db, user, m, data).project)


# ---------------------------------------------------------------- RFI
def _rfi(db, rfi_id):
    r = db.get(RFICase, rfi_id)
    if not r:
        raise modules.common.NotFound("RFI case not found")
    return r


@router.post("/projects/{project_id}/rfis", status_code=201)
def create_rfi(project_id: int, data: sc.RFICreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    modules.create_rfi(db, user, p, data)
    return _out(p)


@router.patch("/rfis/{rfi_id}")
def update_rfi(rfi_id: int, data: sc.RFIUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(modules.update_rfi(db, user, _rfi(db, rfi_id), data).project)


@router.post("/rfis/{rfi_id}/questions", status_code=201)
def add_question(rfi_id: int, data: sc.RFIQuestionCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _rfi(db, rfi_id)
    modules.add_rfi_question(db, user, r, data)
    return _out(r.project)


@router.patch("/rfi-questions/{question_id}")
def update_question(question_id: int, data: sc.RFIQuestionUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.get(RFIQuestion, question_id)
    if not q:
        raise modules.common.NotFound("Question not found")
    return _out(modules.update_rfi_question(db, user, q, data).rfi.project)


@router.post("/rfis/{rfi_id}/actions")
def rfi_action(rfi_id: int, data: sc.RFIActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(modules.rfi_action(db, user, _rfi(db, rfi_id), data.action, data.note).project)


# ---------------------------------------------------------------- documents
@router.post("/projects/{project_id}/documents", status_code=201)
def create_document(project_id: int, data: sc.DocumentCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _P(db, project_id)
    modules.create_document(db, user, p, data)
    return _out(p)


@router.post("/documents/{doc_id}/versions", status_code=201)
def add_version(doc_id: int, data: sc.VersionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(modules.add_version(db, user, modules.get_document(db, doc_id), data).project)


@router.post("/documents/{doc_id}/actions")
def document_action(doc_id: int, data: sc.DocumentActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(modules.document_action(db, user, modules.get_document(db, doc_id), data.action, data.note).project)
