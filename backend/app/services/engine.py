"""Project lifecycle: creation, edits (with a field-by-field audit), the stage approval cycle,
parallel workstreams, milestone / lock rules and the Project 360 health rating.
Nothing here names a stage: the process comes from the project's workflow version (`p.flow`)."""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import workflow
from ..models import Project, ProjectStage, User, aware
from . import common, modules, notify, workflows
from .common import Forbidden, WorkflowError

SAT = workflow.SATISFIED


def list_projects(db: Session) -> list[Project]:
    q = (select(Project).options(selectinload(Project.stages), selectinload(Project.tasks))
         .order_by(Project.updated_at.desc(), Project.id.desc()))
    return list(db.scalars(q))


def get_project(db: Session, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p:
        raise common.NotFound("Project not found")
    return p


# ---------------------------------------------------------------- stage bookkeeping
def _activate(row: ProjectStage):
    row.state = "in_progress"
    row.started_at = common.now()
    row.submitted_at = row.decided_at = None
    row.locked = False
    p = row.project
    feats = p.flow.stage(row.stage_key).features
    if "agreements" in feats:
        modules.ensure_core_agreements(p)
    if "dossier" in feats:
        modules.ensure_dossier(p)


def _unlock(p: Project):
    """Start every pending stage whose prerequisites are all approved (or bypassed)."""
    for row in p.stages:
        if row.state != "pending":
            continue
        reqs = p.flow.stage(row.stage_key).requires
        if reqs and all(p.row(r) and p.row(r).state in SAT for r in reqs):
            _activate(row)


def _sync(p: Project):
    rows = p.active_rows
    if rows:
        p.stage_key = rows[0].stage_key
    elif p.stages and all(r.state in SAT for r in p.stages):
        p.stage_key = p.flow.terminals[-1].key


def _next_code(db: Session, year: int) -> str:
    n = db.scalar(select(func.count()).select_from(Project).where(Project.code.like(f"NH-{year}-%"))) + 1
    return f"NH-{year}-{n:03d}"


# ---------------------------------------------------------------- health (Project 360)
def health(p: Project) -> tuple[str, list[str]]:
    if p.closed:
        return "closed", []
    red, amber = [], []
    today = date.today()
    if p.critical_blocker:
        red.append("Critical blocker: " + p.critical_blocker)
    late = [t for t in p.tasks if t.overdue]
    if len(late) >= 2:
        red.append(f"{len(late)} tasks overdue")
    elif late:
        amber.append("1 task overdue")
    soon = [t for t in p.tasks if t.open and t.due_at and not t.overdue and (aware(t.due_at).date() - today).days <= 3]
    if soon:
        amber.append(f"{len(soon)} task(s) due within 3 days")
    sub = p.feature_row("submission")
    if p.target_submission and p.target_submission < today and not (sub and sub.state in SAT):
        red.append("Target submission date has passed")
    if p.target_launch and p.target_launch < today:
        red.append("Target launch date has passed")
    over = [r for r in p.active_rows if r.overdue]
    if over:
        amber.append(f"{len(over)} stage(s) over target time")
    if any(t.state == "changes_requested" for t in p.tasks):
        amber.append("Changes requested on a task")
    if p.status == "on_hold":
        amber.append("On hold")
    return ("red" if red else "amber" if amber else "green"), red + amber


# ---------------------------------------------------------------- create / edit
def create_project(db: Session, user: User, data) -> Project:
    common.require(user, "manage_project", "create projects")
    if data.submission_type and data.submission_type not in workflow.SUBMISSION_TYPES:
        raise WorkflowError("Unknown submission type.")
    wf = workflows.current(db)
    if not wf:
        raise WorkflowError("There is no published workflow yet. Publish one first (Workflow page).")
    flow = workflow.get(wf.id)
    fields = data.model_dump()
    if not fields.get("project_manager_id") and user.role_key == "project_manager":
        fields["project_manager_id"] = user.id
    p = Project(**fields, workflow_id=wf.id, stage_key=flow.starts[0].key, status="active")
    for s in flow.stages:
        p.stages.append(ProjectStage(stage_key=s.key, state="pending"))
    db.add(p)
    for s in flow.starts:
        _activate(p.row(s.key))
    common.log(p, user, "project", "created", f"Project created on workflow '{wf.name}' v{wf.version}")
    db.commit()
    return p


EDITABLE = {"name": "Name", "product": "Product", "project_type": "Type", "category": "Category", "market": "Market",
            "initiator": "Initiator", "summary": "Summary", "project_manager_id": "Project manager",
            "submission_type": "Submission type", "target_submission": "Target submission",
            "target_launch": "Target launch", "critical_blocker": "Critical blocker"}


def update_project(db: Session, user: User, p: Project, data) -> Project:
    changes = data.model_dump(exclude_unset=True)
    # the Regulatory team may set the submission type; everything else needs project management rights
    dossier = p.flow.with_feature("dossier")
    if not (set(changes) <= {"submission_type"} and dossier and modules.can_edit_stage(user, p, dossier.key)):
        common.require(user, "manage_project", "edit projects")
    if p.closed:
        raise WorkflowError(f"This project is {p.status}. Reopen it to edit.")
    if changes.get("submission_type") and changes["submission_type"] not in workflow.SUBMISSION_TYPES:
        raise WorkflowError("Unknown submission type.")
    nullable = ("project_manager_id", "target_submission", "target_launch")
    diffs = []
    for k, v in changes.items():
        if v is None and k not in nullable:
            continue
        old = getattr(p, k)
        if old == v:
            continue
        if k == "project_manager_id":
            u = db.get(User, v) if v else None
            if v and not u:
                raise WorkflowError("Unknown project manager.")
            diffs.append(f"{EDITABLE[k]}: {p.project_manager.name if p.project_manager else 'none'} → {u.name if u else 'none'}")
        else:
            diffs.append(f"{EDITABLE[k]}: {old or '–'} → {v or '–'}")
        setattr(p, k, v)
    if diffs:
        common.log(p, user, "project", "edit", "; ".join(diffs))
        if "submission_type" in changes:
            modules.ensure_dossier(p)
    db.commit()
    db.refresh(p)
    return p


# ---------------------------------------------------------------- guards: what must be true before a stage is submitted / approved
def blockers(p: Project, key: str) -> list[str]:
    st = p.flow.stage(key)
    feats = st.features
    out = []
    open_tasks = [t for t in p.tasks if t.stage_key == key and t.required and not t.bypassed and t.state not in workflow.TASK_DONE]
    if open_tasks:
        out.append(f"{len(open_tasks)} required task(s) are not approved yet")
    docs = [d for d in p.documents if d.stage_key == key and d.required and d.status not in ("approved", "locked")]
    if docs:
        out.append(f"{len(docs)} required document(s) are not approved yet")
    if "agreements" in feats:
        for a in p.agreements:
            if a.core and a.status != "signed":
                out.append(f"{workflow.AGREEMENT_KINDS[a.kind]} is not signed yet")
    if "dossier" in feats:
        if not p.submission_type:
            out.append("Choose the submission type first")
        todo = [i for i in p.dossier_items if i.required and i.status not in workflow.DOSSIER_DONE]
        if todo:
            out.append(f"{len(todo)} required dossier item(s) are not ready")
    if "mfr" in feats:
        todo = [m for m in p.mfr_requests if m.required and m.status not in workflow.MFR_DONE]
        if todo:
            out.append(f"{len(todo)} required manufacturer data item(s) are not accepted yet")
    if "submission" in feats and not p.submissions:
        out.append("Record the external submission first")
    if "rfi" in feats:
        n = [r for r in p.rfis if r.status != "closed"]
        if n:
            out.append(f"{len(n)} RFI case(s) are still open")
    return out


# ---------------------------------------------------------------- actions
def _target_row(p: Project, key: str | None) -> ProjectStage:
    if key:
        row = p.row(key) if p.flow.has(key) else None
        if not row or row.state not in ("in_progress", "awaiting_approval"):
            raise WorkflowError("That stage is not active right now.")
        return row
    active = p.active_rows
    if len(active) == 1:
        return active[0]
    raise WorkflowError("Choose which stage this is for.")


def apply_action(db: Session, user: User, p: Project, a) -> Project:
    note = a.note.strip()
    act = a.action
    flow = p.flow
    ev_stage, to_stage = p.stage_key, None

    # ---- project level ----
    if act == "reopen":
        common.require(user, "lock_unlock", "reopen a closed project")
        if not p.closed:
            raise WorkflowError("Only a rejected or completed project can be reopened.")
        common.need_note(note, "Please add a note explaining why it is being reopened.")
        if p.status == "completed":
            for r in p.stages:
                r.locked = False
            for t in flow.terminals:
                last = p.row(t.key)
                _activate(last)
                last.rework_count += 1
        p.status = "active"
    elif act in ("hold", "resume", "return"):
        common.require(user, "manage_project", "hold, resume or move back a project")
        if p.closed:
            raise WorkflowError(f"This project is {p.status}.")
        if act == "resume":
            if p.status != "on_hold":
                raise WorkflowError("Only a project on hold can be resumed.")
            p.status = "active"
        elif act == "hold":
            if p.status != "active":
                raise WorkflowError("This project is already on hold.")
            common.need_note(note, "Please add a note explaining why the project is on hold.")
            p.status = "on_hold"
        else:  # return
            common.ensure_open(p)
            common.need_note(note, "Please add a note explaining why it is moving back.")
            target = p.row(a.to_stage) if a.to_stage and flow.has(a.to_stage) else None
            if not target or target.state not in SAT:
                raise WorkflowError("Choose an approved stage to move back to.")
            for key in flow.descendants(target.stage_key) | {target.stage_key}:
                if p.row(key).locked:
                    raise WorkflowError(f"{flow.stage(key).name} is locked. Unlock it first.")
            for key in flow.descendants(target.stage_key):
                r = p.row(key)
                r.state, r.started_at, r.submitted_at, r.decided_at = "pending", None, None, None
            _activate(target)
            target.rework_count += 1
            to_stage = ev_stage = target.stage_key
    # ---- stage level (the approval cycle) ----
    else:
        common.ensure_open(p)
        if act in ("lock", "unlock"):
            common.require(user, "lock_unlock", "lock or unlock records")
            row = p.row(a.stage_key) if a.stage_key and flow.has(a.stage_key) else None
            if not row:
                raise WorkflowError("Choose a stage.")
            if act == "lock":
                if row.state not in SAT:
                    raise WorkflowError("Only an approved stage can be locked.")
                row.locked = True
            else:
                common.need_note(note, "Please add a note explaining why it is being unlocked.")
                row.locked = False
            ev_stage = row.stage_key
        else:
            row = _target_row(p, a.stage_key)
            st = flow.stage(row.stage_key)
            ev_stage = row.stage_key
            if act == "submit":
                if not (common.role_ok(user, st.owner_roles) or user.can("manage_project")):
                    raise Forbidden(f"Work on {st.name} is submitted by: {st.owner}.")
                if row.state != "in_progress":
                    raise WorkflowError("This stage is not waiting for work to be submitted.")
                b = blockers(p, row.stage_key)
                if b:
                    raise WorkflowError("Cannot submit yet: " + "; ".join(b) + ".")
                row.state, row.submitted_at = "awaiting_approval", common.now()
                notify.notify_roles(db, st.approver_roles, "approval", f"Approval needed: {st.name}",
                                    f"Project: {p.name} · Stage: {st.name} · Submitted by {user.name} · Action: approve or send back",
                                    p.id, exclude=user.id)
            elif act in ("approve", "send_back", "reject"):
                common.require(user, "approve" if act == "approve" else "request_changes")
                if not common.role_ok(user, st.approver_roles):
                    raise Forbidden(f"{st.name} is decided by: {st.approver}.")
                if row.state != "awaiting_approval":
                    raise WorkflowError("Submit the work for approval first." if act == "approve"
                                        else "Only work that is awaiting approval can be decided.")
                if act == "approve":
                    b = blockers(p, row.stage_key)
                    if b:
                        raise WorkflowError("Cannot approve yet: " + "; ".join(b) + ".")
                    row.state, row.decided_at = "approved", common.now()
                    if "issue_code" in st.features and not p.code:
                        p.code = _next_code(db, p.created_at.year)
                    _unlock(p)
                    if all(r.state in SAT for r in p.stages):
                        p.status = "completed"
                        for r in p.stages:
                            r.locked = True
                elif act == "send_back":
                    common.need_note(note, "Please add a note explaining what needs to change.")
                    row.state, row.submitted_at = "in_progress", None
                    row.started_at = common.now()
                    row.rework_count += 1
                    notify.notify(db, p.project_manager_id, "changes", f"Sent back: {st.name}",
                                  f"Project: {p.name} · Stage: {st.name} · Sent back by {user.name} · {note}", p.id)
                else:
                    if not st.can_close:
                        raise WorkflowError("The project cannot be rejected at this stage; send it back for rework instead.")
                    common.need_note(note, "Please add a note explaining the rejection.")
                    p.status = "rejected"
                    notify.notify(db, p.project_manager_id, "changes", f"Project rejected: {p.name}",
                                  f"Rejected at {st.name} by {user.name} · {note}", p.id)
            elif act == "bypass":
                common.require(user, "bypass_optional")
                if not st.optional:
                    raise WorkflowError(f"{st.name} is required and cannot be bypassed.")
                common.need_note(note, "Please add a note explaining why this work is not needed.")
                row.state, row.decided_at = "bypassed", common.now()
                _unlock(p)
                if all(r.state in SAT for r in p.stages):
                    p.status = "completed"
            else:
                raise WorkflowError("Unknown action.")

    _sync(p)
    common.log(p, user, "stage", act, note, ev_stage, to_stage=to_stage)
    db.commit()
    return p
