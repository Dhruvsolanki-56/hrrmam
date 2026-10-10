"""Plain tables. The process itself (stages, roles, flows) lives in workflow.py."""
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import workflow
from .database import Base

ACTIVE_STATES = ("in_progress", "awaiting_approval")


def _now():
    return datetime.now(timezone.utc)


def aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; everything is stored as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ts():
    return mapped_column(DateTime(timezone=True), default=_now)


# ------------------------------------------------------------------ people
class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class Role(Base):
    __tablename__ = "roles"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    assign_to: Mapped[list] = mapped_column(JSON, default=list)  # role keys this role may assign work to, or ["*"]


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200), default="")
    role_key: Mapped[str] = mapped_column(ForeignKey("roles.key"))
    country: Mapped[str] = mapped_column(String(20), default="AU")  # AU | IN | Partner
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = _ts()

    role: Mapped[Role] = relationship(lazy="joined")

    def can(self, perm: str) -> bool:
        return self.role_key == "super_admin" or perm in (self.role.permissions or [])

    def can_assign_to(self, role_key: str) -> bool:
        if self.role_key == "super_admin":
            return True
        scope = self.role.assign_to or []
        return "*" in scope or role_key in scope


# ------------------------------------------------------------------ project 360
class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    product: Mapped[str] = mapped_column(String(200), default="")
    project_type: Mapped[str] = mapped_column(String(32), default="Development")  # Development | In-Licence
    category: Mapped[str] = mapped_column(String(80), default="")
    market: Mapped[str] = mapped_column(String(80), default="Australia")
    initiator: Mapped[str] = mapped_column(String(120), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    project_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    submission_type: Mapped[str] = mapped_column(String(120), default="")
    target_submission: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_launch: Mapped[date | None] = mapped_column(Date, nullable=True)
    critical_blocker: Mapped[str] = mapped_column(Text, default="")
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_defs.id"))  # the workflow version this project runs on
    stage_key: Mapped[str] = mapped_column(String(40))  # primary active stage (earliest in the flow); kept in sync
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | on_hold | rejected | completed
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project_manager: Mapped[User | None] = relationship(foreign_keys=[project_manager_id], lazy="joined")
    stages: Mapped[list["ProjectStage"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="ProjectStage.id")
    events: Mapped[list["ProjectEvent"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="ProjectEvent.id")
    tasks: Mapped[list["Task"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="Task.id")
    agreements: Mapped[list["Agreement"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="Agreement.id")
    dossier_items: Mapped[list["DossierItem"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="DossierItem.id")
    submissions: Mapped[list["Submission"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="Submission.id")
    mfr_requests: Mapped[list["ManufacturerRequest"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="ManufacturerRequest.id")
    rfis: Mapped[list["RFICase"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="RFICase.id")
    documents: Mapped[list["Document"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="Document.id")

    @property
    def flow(self) -> "workflow.Flow":
        return workflow.get(self.workflow_id)

    def row(self, key: str) -> "ProjectStage | None":
        return next((r for r in self.stages if r.stage_key == key), None)

    def feature_row(self, feature: str) -> "ProjectStage | None":
        s = self.flow.with_feature(feature)
        return self.row(s.key) if s else None

    @property
    def stage_states(self) -> dict[str, str]:
        return {r.stage_key: r.state for r in self.stages}

    @property
    def active_rows(self) -> list["ProjectStage"]:
        rows = [r for r in self.stages if r.state in ACTIVE_STATES]
        return sorted(rows, key=lambda r: self.flow.index[r.stage_key])

    @property
    def active_keys(self) -> list[str]:
        return [r.stage_key for r in self.active_rows]

    @property
    def closed(self) -> bool:
        return self.status in ("rejected", "completed")


class ProjectStage(Base):
    """Progress of one stage / workstream. pending -> in_progress -> awaiting_approval -> approved (or bypassed)."""
    __tablename__ = "project_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40))
    state: Mapped[str] = mapped_column(String(20), default="pending")  # pending | in_progress | awaiting_approval | approved | bypassed
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    rework_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="stages")

    @property
    def sla_days(self) -> int:
        return self.project.flow.stage(self.stage_key).sla_days

    @property
    def days_in_stage(self) -> int:
        if self.state not in ACTIVE_STATES or not self.started_at:
            return 0
        return max(0, (_now() - aware(self.started_at)).days)

    @property
    def overdue(self) -> bool:
        return self.project.status == "active" and self.state in ACTIVE_STATES and self.days_in_stage > self.sla_days


class ProjectEvent(Base):
    """The audit trail: nothing is overwritten silently, every change leaves a row."""
    __tablename__ = "project_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40), default="")
    area: Mapped[str] = mapped_column(String(20), default="stage")  # stage | task | legal | dossier | artwork | manufacturer | rfi | document | project | admin
    action: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(120), default="")
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    to_stage: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = _ts()

    project: Mapped[Project] = relationship(back_populates="events")


# ------------------------------------------------------------------ tasks
class Task(Base):
    """assigned -> accepted -> in_progress -> submitted -> (changes_requested -> resubmitted) -> approved -> locked"""
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40))  # workstream / phase the task belongs to
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assigner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[str] = mapped_column(String(24), default="assigned")
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    bypassed: Mapped[bool] = mapped_column(Boolean, default=False)
    rework_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="tasks")
    assignee: Mapped[User] = relationship(foreign_keys=[assignee_id], lazy="joined")
    assigner: Mapped[User | None] = relationship(foreign_keys=[assigner_id], lazy="joined")
    date_requests: Mapped[list["DateRequest"]] = relationship(back_populates="task", cascade="all, delete-orphan", order_by="DateRequest.id")

    @property
    def open(self) -> bool:
        return self.state in workflow.TASK_OPEN

    @property
    def overdue(self) -> bool:
        return self.open and self.due_at is not None and aware(self.due_at) < _now()

    @property
    def pending_request(self) -> "DateRequest | None":
        return next((r for r in self.date_requests if r.status == "pending"), None)


class DateRequest(Base):
    """Due-date negotiation: assignee proposes a new date, the assigner approves or rejects."""
    __tablename__ = "date_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    proposed_due: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    previous_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    requested_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | approved | rejected
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped[Task] = relationship(back_populates="date_requests")
    requested_by: Mapped[User] = relationship(foreign_keys=[requested_by_id], lazy="joined")
    decided_by: Mapped[User | None] = relationship(foreign_keys=[decided_by_id], lazy="joined")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(24))  # reminder | overdue | escalation | assigned | approval | changes | date_request | date_decision
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    dedupe_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _ts()


# ------------------------------------------------------------------ legal
class Agreement(Base):
    __tablename__ = "agreements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # supplier | quality | pv | nda | cda | poa | notice
    counterparty: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(24), default="not_started")
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    link: Mapped[str] = mapped_column(String(1000), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    core: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="agreements")
    owner: Mapped[User | None] = relationship(lazy="joined")


# ------------------------------------------------------------------ regulatory
class DossierItem(Base):
    __tablename__ = "dossier_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    module: Mapped[str | None] = mapped_column(String(4), nullable=True)  # M1..M5 only where the submission type needs it
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(12), default="missing")  # missing | draft | ready | reviewed
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    link: Mapped[str] = mapped_column(String(1000), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    project: Mapped[Project] = relationship(back_populates="dossier_items")


class Submission(Base):
    """External submission history (platform kept configurable until confirmed)."""
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="initial")  # initial | rfi_response | variation
    reference: Mapped[str] = mapped_column(String(120), default="")
    platform: Mapped[str] = mapped_column(String(200), default="")
    submitted_on: Mapped[date] = mapped_column(Date)
    submitted_by: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()

    project: Mapped[Project] = relationship(back_populates="submissions")


class ManufacturerRequest(Base):
    __tablename__ = "mfr_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    manufacturer: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(16), default="requested")
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    requested_on: Mapped[date] = mapped_column(Date, default=date.today)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    link: Mapped[str] = mapped_column(String(1000), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    project: Mapped[Project] = relationship(back_populates="mfr_requests")
    owner: Mapped[User | None] = relationship(lazy="joined")


class RFICase(Base):
    __tablename__ = "rfi_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    authority: Mapped[str] = mapped_column(String(80), default="TGA")
    reference: Mapped[str] = mapped_column(String(120), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    received_on: Mapped[date] = mapped_column(Date, default=date.today)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | response_ready | submitted | closed
    response_link: Mapped[str] = mapped_column(String(1000), default="")
    closure_note: Mapped[str] = mapped_column(Text, default="")
    closed_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    project: Mapped[Project] = relationship(back_populates="rfis")
    questions: Mapped[list["RFIQuestion"]] = relationship(back_populates="rfi", cascade="all, delete-orphan", order_by="RFIQuestion.id")


class RFIQuestion(Base):
    __tablename__ = "rfi_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rfi_id: Mapped[int] = mapped_column(ForeignKey("rfi_cases.id"), index=True)
    number: Mapped[int] = mapped_column(Integer, default=1)
    question: Mapped[str] = mapped_column(Text)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)  # the assigned task
    response: Mapped[str] = mapped_column(Text, default="")
    evidence_link: Mapped[str] = mapped_column(String(1000), default="")

    rfi: Mapped[RFICase] = relationship(back_populates="questions")
    task: Mapped[Task | None] = relationship(lazy="joined")


# ------------------------------------------------------------------ documents & versions (also holds artwork)
class Document(Base):
    """A project document with V1/V2/V3 versions and a review -> approve -> lock cycle.
    Artwork (stage_key == 'artwork') uses the longer flow: draft -> regulatory review -> director approval -> approved."""
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40), default="")  # workstream the document belongs to
    kind: Mapped[str] = mapped_column(String(40), default="Other")
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="draft")  # draft | in_review | <artwork step> | returned | approved | locked
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    is_artwork: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="documents")
    owner: Mapped[User | None] = relationship(lazy="joined")
    versions: Mapped[list["DocumentVersion"]] = relationship(back_populates="document", cascade="all, delete-orphan", order_by="DocumentVersion.version_no")

    @property
    def steps(self) -> list[dict]:
        """Artwork review steps from the workflow's rules (status key, label, roles)."""
        return self.project.flow.rules["artwork"]["steps"]

    @property
    def flow(self) -> list[str]:
        if self.is_artwork:
            return ["draft"] + [x["status"] for x in self.steps] + ["approved"]
        return ["draft", "in_review", "approved"] if self.project.flow.rules["document"].get("approval", True) else ["draft", "approved"]


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    link: Mapped[str] = mapped_column(String(1000), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = _ts()

    document: Mapped[Document] = relationship(back_populates="versions")


class AdminEvent(Base):
    """Audit trail for users, roles, permissions and settings (not tied to a project)."""
    __tablename__ = "admin_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str] = mapped_column(String(120), default="")
    action: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()


# ------------------------------------------------------------------ the configurable workflow
class WorkflowDef(Base):
    """A versioned workflow definition. Published versions are immutable: projects keep running on the version they started on."""
    __tablename__ = "workflow_defs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft | published | archived
    version: Mapped[int] = mapped_column(Integer, default=0)  # assigned when published
    definition: Mapped[dict] = mapped_column(JSON, default=dict)  # {"stages": [...], "rules": {...}}
    based_on: Mapped[str] = mapped_column(String(160), default="")
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    feedback: Mapped[list["WorkflowFeedback"]] = relationship(back_populates="workflow", cascade="all, delete-orphan", order_by="WorkflowFeedback.id")


class WorkflowFeedback(Base):
    """Comments on a workflow draft (for example from the client), optionally about one stage."""
    __tablename__ = "workflow_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_defs.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40), default="")
    author: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(80), default="")
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | resolved
    resolution: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()

    workflow: Mapped[WorkflowDef] = relationship(back_populates="feedback")
