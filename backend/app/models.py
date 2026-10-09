"""Plain tables. Stages live in workflow.py (config), not the DB, to keep things simple."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import workflow
from .database import Base

# Events that put the project into a (new) stage; the latest one starts the "time in stage" clock.
STAGE_ENTRY_ACTIONS = {"created", "advance", "approve", "reject", "return", "reopen"}


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
    stage_key: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | on_hold | clarification | rejected | completed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    events: Mapped[list["ProjectEvent"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectEvent.id"
    )
    links: Mapped[list["ProjectLink"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectLink.id"
    )

    @property
    def stage_entered_at(self) -> datetime:
        for e in reversed(self.events):
            if e.action in STAGE_ENTRY_ACTIONS:
                return aware(e.created_at)
        return aware(self.created_at)

    @property
    def sla_days(self) -> int:
        return workflow.stage(self.stage_key).sla_days

    @property
    def days_in_stage(self) -> int:
        return max(0, (_now() - self.stage_entered_at).days)

    @property
    def overdue(self) -> bool:
        return self.status in ("active", "clarification") and self.days_in_stage > self.sla_days


class ProjectEvent(Base):
    __tablename__ = "project_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    stage_key: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(20))  # created | advance | approve | reject | hold | clarify | resume | edit | reopen | return
    note: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(120), default="")
    to_stage: Mapped[str | None] = mapped_column(String(40), nullable=True)  # set when a project is moved back
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
