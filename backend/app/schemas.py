from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ProjectType = Literal["Development", "In-Licence"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    project_type: ProjectType = "Development"
    category: str = ""
    initiator: str = ""
    summary: str = ""


class ActionIn(BaseModel):
    action: Literal["advance", "approve", "reject", "hold", "clarify", "resume"]
    note: str = ""
    actor: str = ""


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    stage_key: str
    action: str
    note: str
    actor: str
    created_at: datetime


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str | None
    name: str
    project_type: str
    category: str
    initiator: str
    summary: str
    stage_key: str
    status: str
    created_at: datetime
    updated_at: datetime


class ProjectDetail(ProjectOut):
    events: list[EventOut]
