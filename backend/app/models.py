"""Plain tables. Stages live in workflow.py (config); per-project stage progress is in project_stages."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import workflow
from .database import Base

ACTIVE_STATES = ("in_progress", "awaiting_approval", "clarification")


def _now():
    return datetime.now(timezone.utc)


def aware(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; everything is stored as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    project_type: Mapped[str] = mapped_column(String(32), default="Development")  # Development | In-Licence
    category: Mapped[str] = mapped_column(String(80), default="")
    initiator: Mapped[str] = mapped_column(String(120), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    stage_key: Mapped[str] = mapped_column(String(40))  # primary active stage (lowest in the flow); kept in sync
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | on_hold | rejected | completed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    events: Mapped[list["ProjectEvent"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectEvent.id"
    )
    links: Mapped[list["ProjectLink"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectLink.id"
    )
    stages: Mapped[list["ProjectStage"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectStage.id"
    )

    # ---- derived state ----
    def row(self, key: str) -> "ProjectStage | None":
        return next((r for r in self.stages if r.stage_key == key), None)

    @property
    def stage_states(self) -> dict[str, str]:
        return {r.stage_key: r.state for r in self.stages}

    @property
    def active_rows(self) -> list["ProjectStage"]:
        rows = [r for r in self.stages if r.state in ACTIVE_STATES]
        return sorted(rows, key=lambda r: workflow.STAGE_INDEX[r.stage_key])

    @property
    def active_keys(self) -> list[str]:
        return [r.stage_key for r in self.active_rows]

    @property
    def display_status(self) -> str:
        """A project waiting on a clarification shows as such (the pause is per stage, not per project)."""
        if self.status == "active" and any(r.state == "clarification" for r in self.stages):
            return "clarification"
        return self.status

    @property
    def _worst(self) -> "ProjectStage | None":
        rows = self.active_rows
        return max(rows, key=lambda r: r.days_in_stage - r.sla_days, default=None) if rows else None

    @property
    def stage_entered_at(self) -> datetime:
        w = self._worst
        return aware(w.started_at) if w and w.started_at else aware(self.created_at)

    @property
    def days_in_stage(self) -> int:
        w = self._worst
        return w.days_in_stage if w else 0

    @property
    def sla_days(self) -> int:
        w = self._worst
        return w.sla_days if w else workflow.stage(self.stage_key).sla_days

    @property
    def overdue(self) -> bool:
        return self.status == "active" and any(r.overdue for r in self.active_rows)


class ProjectStage(Base):
    """Progress of one stage of one project. pending -> in_progress -> awaiting_approval -> approved."""
    __tablename__ = "project_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40))
    state: Mapped[str] = mapped_column(String(20), default="pending")  # pending | in_progress | awaiting_approval | clarification | approved
    rework_count: Mapped[int] = mapped_column(Integer, default=0)  # times it was sent back
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="stages")

    @property
    def sla_days(self) -> int:
        return workflow.stage(self.stage_key).sla_days

    @property
    def days_in_stage(self) -> int:
        if self.state not in ACTIVE_STATES or not self.started_at:
            return 0
        return max(0, (_now() - aware(self.started_at)).days)

    @property
    def overdue(self) -> bool:
        return self.project.status == "active" and self.state in ACTIVE_STATES and self.days_in_stage > self.sla_days


class ProjectEvent(Base):
    __tablename__ = "project_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40))  # the stage the action was taken on
    action: Mapped[str] = mapped_column(String(20))  # created | submit | approve | send_back | reject | hold | resume | clarify | info | edit | reopen | return
    note: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(120), default="")
    to_stage: Mapped[str | None] = mapped_column(String(40), nullable=True)  # set when work is sent back / moved back
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    project: Mapped[Project] = relationship(back_populates="events")


class ProjectLink(Base):
    """A link to a document that lives elsewhere (SharePoint, Drive, ...). No files are stored."""
    __tablename__ = "project_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    project: Mapped[Project] = relationship(back_populates="links")
