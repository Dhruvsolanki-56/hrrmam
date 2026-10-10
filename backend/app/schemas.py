"""Request bodies. Responses are built by serialize.py."""
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


UTC = Annotated[datetime, AfterValidator(_utc)]
ProjectType = Literal["Development", "In-Licence"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    product: str = ""
    project_type: ProjectType = "Development"
    category: str = ""
    market: str = "Australia"
    initiator: str = ""
    summary: str = ""
    project_manager_id: int | None = None
    submission_type: str = ""
    target_submission: date | None = None
    target_launch: date | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    product: str | None = None
    project_type: ProjectType | None = None
    category: str | None = None
    market: str | None = None
    initiator: str | None = None
    summary: str | None = None
    project_manager_id: int | None = None
    submission_type: str | None = None
    target_submission: date | None = None
    target_launch: date | None = None
    critical_blocker: str | None = None


class ActionIn(BaseModel):
    action: Literal["submit", "approve", "send_back", "reject", "bypass", "hold", "resume", "reopen", "return", "lock", "unlock"]
    note: str = ""
    stage_key: str | None = None
    to_stage: str | None = None


# ---- tasks
class TaskCreate(BaseModel):
    stage_key: str
    title: str = Field(min_length=2, max_length=200)
    description: str = ""
    assignee_id: int
    due_at: UTC
    required: bool = True


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = None
    due_at: UTC | None = None
    required: bool | None = None


class TaskActionIn(BaseModel):
    action: Literal["accept", "start", "submit", "approve", "request_changes", "lock", "unlock", "request_date",
                    "approve_date", "reject_date", "reassign", "bypass"]
    note: str = ""
    due_at: UTC | None = None
    assignee_id: int | None = None


# ---- modules
class AgreementCreate(BaseModel):
    kind: Literal["supplier", "quality", "pv", "nda", "cda", "poa", "notice"]
    counterparty: str = ""
    owner_id: int | None = None
    due_date: date | None = None
    link: str = ""
    notes: str = ""


class AgreementUpdate(BaseModel):
    status: Literal["not_started", "drafting", "in_review", "changes_requested", "sent_for_signature", "signed"] | None = None
    counterparty: str | None = None
    owner_id: int | None = None
    due_date: date | None = None
    signed_date: date | None = None
    link: str | None = None
    notes: str | None = None


class DossierItemCreate(BaseModel):
    module: str | None = None
    title: str = Field(min_length=2, max_length=200)
    required: bool = True


class DossierItemUpdate(BaseModel):
    status: Literal["missing", "draft", "awaiting_approval", "changes_requested", "ready", "reviewed"] | None = None
    link: str | None = None
    notes: str | None = None
    required: bool | None = None


class SubmissionIn(BaseModel):
    kind: Literal["initial", "rfi_response", "variation"] = "initial"
    reference: str = ""
    platform: str = ""
    submitted_on: date = Field(default_factory=date.today)
    notes: str = ""


class MfrCreate(BaseModel):
    kind: Literal["coa", "msds", "specification", "testing", "stability", "manufacturing", "other"]
    manufacturer: str = ""
    due_date: date | None = None
    required: bool = True
    notes: str = ""
    owner_id: int | None = None


class MfrUpdate(BaseModel):
    status: Literal["requested", "received", "under_review", "changes_requested", "accepted"] | None = None
    manufacturer: str | None = None
    due_date: date | None = None
    received_on: date | None = None
    link: str | None = None
    notes: str | None = None
    required: bool | None = None


class RFICreate(BaseModel):
    authority: str = "TGA"
    reference: str = ""
    summary: str = ""
    received_on: date = Field(default_factory=date.today)
    due_date: date | None = None


class RFIUpdate(BaseModel):
    reference: str | None = None
    summary: str | None = None
    due_date: date | None = None
    response_link: str | None = None


class RFIQuestionCreate(BaseModel):
    question: str = Field(min_length=3)
    assignee_id: int
    due_at: UTC


class RFIQuestionUpdate(BaseModel):
    response: str | None = None
    evidence_link: str | None = None


class RFIActionIn(BaseModel):
    action: Literal["ready", "submit", "close", "reopen"]
    note: str = ""


class DocumentCreate(BaseModel):
    artwork: bool = False
    stage_key: str = ""
    kind: str = "Other"
    title: str = Field(min_length=2, max_length=200)
    link: str = ""
    note: str = ""
    required: bool = True
    owner_id: int | None = None


class VersionIn(BaseModel):
    link: str = ""
    note: str = ""


class DocumentActionIn(BaseModel):
    action: Literal["submit", "approve", "return", "lock", "unlock"]
    note: str = ""


# ---- admin
class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = ""
    role_key: str
    country: Literal["AU", "IN", "Partner"] = "AU"


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = None
    role_key: str | None = None
    country: Literal["AU", "IN", "Partner"] | None = None
    active: bool | None = None


class RoleUpdate(BaseModel):
    permissions: list[str]
    assign_to: list[str]


class SettingsUpdate(BaseModel):
    values: dict[str, str]


class ReadIn(BaseModel):
    ids: list[int] = []
    all: bool = False


class EntryActionIn(BaseModel):
    action: Literal["submit", "approve", "reject"]
    note: str = ""


# ---- workflow designer
class WorkflowCreate(BaseModel):
    name: str = ""
    description: str = ""
    preset: str | None = None
    from_id: int | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    definition: dict | None = None


class FeedbackIn(BaseModel):
    stage_key: str = ""
    body: str = Field(min_length=2)


class FeedbackResolve(BaseModel):
    status: Literal["open", "resolved"]
    resolution: str = ""
