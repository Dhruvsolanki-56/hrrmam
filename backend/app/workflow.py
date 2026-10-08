"""High-level project flow, distilled from the Project Management Flow Chart (AD001-F01-00).

Each stage names the entity and team responsible. `gate` stages are decision points
(approve / reject / hold); the others are simply completed. `reject_to` sends a rejected
project back to an earlier stage for modification instead of closing it.
"""
from dataclasses import asdict, dataclass

OTC = "Neo Health (OTC) Pty Ltd"
NIL = "Neo India Lifeline Pvt Ltd"


@dataclass(frozen=True)
class Stage:
    key: str
    name: str
    entity: str
    owner: str
    description: str
    gate: bool = False
    reject_to: str | None = None
    reject_label: str = "Reject"
    clarify: bool = False  # reviewer can ask the team for more information


STAGES: list[Stage] = [
    Stage("screening", "Opportunity Screening", OTC, "Project Initiator",
          "Identify the opportunity and screen it against Neo Health (OTC) criteria."),
    Stage("validation", "Commercial Validation", OTC, "Project Team",
          "Validate the commercial case with the Neo Health (OTC) project team."),
    Stage("director_approval", "Director Approval", OTC, "Director, Neo Health (OTC)",
          "Director decides whether the project goes ahead. A project code is generated on approval.", gate=True),
    Stage("brief", "Project Brief", OTC, "Project Initiator + Cross-Functional Team",
          "Draft the project brief and complete internal review before submission to India."),
    Stage("india_review", "India Review", NIL, "Director, Neo India Lifeline",
          "Neo India Lifeline reviews the brief. Rejections return to the brief for modification; missing information can be queried.",
          gate=True, reject_to="brief", reject_label="Return for modification", clarify=True),
    Stage("feasibility", "Feasibility & Risk", NIL, "Cross-Functional Team + Director, Neo India Lifeline",
          "Cost finalisation, FMEA risk analysis and feasibility report, then Director review (approve, hold or reject).",
          gate=True),
    Stage("commercial_approval", "Commercial Approval", f"{NIL} + {OTC}", "Both Directors",
          "Financial review and final commercial approval by both Directors.", gate=True),
    Stage("agreements", "Agreements", f"{OTC} + {NIL}", "Legal / Quality / PV Teams + Director, Neo India Lifeline",
          "Supplier agreement prepared and reviewed by Legal, Quality and PV, then approved by the India Director.",
          gate=True),
    Stage("artwork", "Concept & Artwork", OTC, "Artwork Team",
          "Concept and artwork developed, then approved by the Director. Rejections go back for redevelopment.",
          gate=True, reject_to="artwork", reject_label="Return for redevelopment"),
    Stage("regulatory", "Regulatory", OTC, "Regulatory Head",
          "Dossier preparation, regulatory submission and review; the Regulatory Head approves, holds or rejects.",
          gate=True),
    Stage("manufacturing", "Manufacturing & Samples", "CMO / CDMO", "CMO + Artwork Team",
          "Manufacturer approval, print proofs, shade card and pre-shipment samples."),
    Stage("launch", "Completion & Dispatch", OTC, "Commercial Team",
          "Commercial manufacturing and dispatch; Director closes the project."),
]

STAGE_INDEX = {s.key: i for i, s in enumerate(STAGES)}
FIRST_STAGE = STAGES[0].key
CODE_STAGE = "director_approval"  # project code is generated when this gate is approved


def stage(key: str) -> Stage:
    return STAGES[STAGE_INDEX[key]]


def next_stage(key: str) -> Stage | None:
    i = STAGE_INDEX[key] + 1
    return STAGES[i] if i < len(STAGES) else None


def stages_payload() -> list[dict]:
    return [asdict(s) for s in STAGES]
