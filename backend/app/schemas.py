from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

ProjectType = Literal["Development", "In-Licence"]


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


UTC = Annotated[datetime, AfterValidator(_utc)]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    project_type: ProjectType = "Development"
    category: str = ""
    initiator: str = ""
    summary: str = ""


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    project_type: ProjectType | None = None
    category: str | None = None
    initiator: str | None = None
    summary: str | None = None
    actor: str = ""


class ActionIn(BaseModel):
    action: Literal["submit", "approve", "send_back", "reject", "clarify", "info", "hold", "resume", "reopen", "return"]
    note: str = ""
    actor: str = ""
    stage_key: str | None = None  # which stage the action is for (needed when stages run in parallel)
    to_stage: str | None = None   # only for "return"


class LinkIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    url: str = Field(max_length=1000)

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        v = v.strip()
        p = urlparse(v)
        if p.scheme not in ("http", "https") or not p.netloc:
            raise ValueError("Enter a full link starting with http:// or https://")
        return v


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    url: str
    created_at: UTC


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    stage_key: str
    action: str
    note: str
    actor: str
    to_stage: str | None
    created_at: UTC


class StageStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    key: str = Field(validation_alias="stage_key")
    state: str
    rework_count: int
    started_at: UTC | None
    days_in_stage: int
    sla_days: int
    overdue: bool


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: int
    code: str | None
    name: str
    project_type: str
    category: str
    initiator: str
    summary: str
    stage_key: str
    status: str = Field(validation_alias="display_status")
    created_at: UTC
    updated_at: UTC
    active_stages: list[str] = Field(validation_alias="active_keys")
    stage_states: dict[str, str]
    stage_entered_at: UTC
    days_in_stage: int
    sla_days: int
    overdue: bool


class ProjectDetail(ProjectOut):
    events: list[EventOut]
    links: list[LinkOut]
    stages: list[StageStateOut]
