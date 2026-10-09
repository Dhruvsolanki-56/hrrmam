"""High-level project flow, distilled from the Project Management Flow Chart (AD001-F01-00).

Every stage goes through the same approval cycle:

    work (owner)  ->  submit  ->  awaiting approval (approver)  ->  approve  -> done
                                        |-> send back for rework  -> work (cycle repeats)
                                        |-> reject project (only where `can_close`)

`decision_only` stages have no work step: the approver decides straight away (e.g. Director Approval).
A stage becomes active once all of its `requires` are approved, so stages that share the same
prerequisites run in parallel (Agreements, Artwork and Regulatory after Commercial Approval), and a stage
that requires several others (Manufacturing) waits for all of them.
"""
from dataclasses import asdict, dataclass

OTC = "Neo Health (OTC) Pty Ltd"
NIL = "Neo India Lifeline Pvt Ltd"


@dataclass(frozen=True)
class Stage:
    key: str
    name: str
    entity: str
    owner: str            # does the work
    approver: str         # approves or sends it back
    description: str
    requires: tuple = ()  # stage keys that must be approved first
    decision_only: bool = False
    rework_to: str | None = None  # decision-only stages send work back to this earlier stage
    can_close: bool = False       # approver may reject the whole project here
    clarify: bool = False         # approver may ask for more information
    sla_days: int = 14            # target time in this stage; beyond it the project is flagged overdue


STAGES: list[Stage] = [
    Stage("screening", "Opportunity Screening", OTC, "Project Initiator", "Project Team, Neo Health (OTC)",
          "Identify the opportunity and screen it against Neo Health (OTC) criteria.", sla_days=7),
    Stage("validation", "Commercial Validation", OTC, "Project Team", "Commercial Lead, Neo Health (OTC)",
          "Validate the commercial case with the Neo Health (OTC) project team.",
          requires=("screening",), sla_days=14),
    Stage("director_approval", "Director Approval", OTC, "Director, Neo Health (OTC)", "Director, Neo Health (OTC)",
          "The Director decides whether the project goes ahead. A project code is issued on approval.",
          requires=("validation",), decision_only=True, rework_to="validation", can_close=True, sla_days=5),
    Stage("brief", "Project Brief", OTC, "Project Initiator + Cross-Functional Team", "Cross-Functional Team (internal review)",
          "Draft the project brief; the internal review approves it or returns it for modification.",
          requires=("director_approval",), sla_days=14),
    Stage("india_review", "India Review", NIL, "Director, Neo India Lifeline", "Director, Neo India Lifeline",
          "Neo India Lifeline reviews the brief. It can be sent back for modification or queried for missing information.",
          requires=("brief",), decision_only=True, rework_to="brief", clarify=True, sla_days=7),
    Stage("feasibility", "Feasibility & Risk", NIL, "Cross-Functional Team", "Director, Neo India Lifeline",
          "Cost finalisation, FMEA risk analysis and the feasibility report, then Director review.",
          requires=("india_review",), can_close=True, sla_days=21),
    Stage("commercial_approval", "Commercial Approval", f"{NIL} + {OTC}", "Both Directors", "Both Directors",
          "Financial review and final commercial approval. Once approved, three phases start in parallel.",
          requires=("feasibility",), decision_only=True, rework_to="feasibility", can_close=True, sla_days=7),
    # ---- run in parallel after Commercial Approval ----
    Stage("agreements", "Agreements", f"{OTC} + {NIL}", "Legal / Quality / PV Teams", "Director, Neo India Lifeline",
          "Supplier agreement prepared and reviewed by Legal, Quality and PV, then approved by the India Director.",
          requires=("commercial_approval",), can_close=True, sla_days=21),
    Stage("artwork", "Concept & Artwork", OTC, "Artwork Team", "Director, Neo Health (OTC)",
          "Concept and artwork developed, then approved by the Director. Rejections go back for redevelopment.",
          requires=("commercial_approval",), sla_days=21),
    Stage("regulatory", "Regulatory", OTC, "Regulatory Team", "Regulatory Head",
          "Dossier preparation and submission; the Regulatory Head approves it or sends it back.",
          requires=("commercial_approval",), can_close=True, sla_days=45),
    # ---- joins the three parallel phases ----
    Stage("manufacturing", "Manufacturing & Samples", "CMO / CDMO", "CMO + Artwork Team", "Director, Neo India Lifeline",
          "Manufacturer approval, print proofs, shade card and pre-shipment samples. Starts when Agreements, Artwork and Regulatory are all approved.",
          requires=("agreements", "artwork", "regulatory"), sla_days=60),
    Stage("launch", "Completion & Dispatch", OTC, "Commercial Team", "Director, Neo Health (OTC)",
          "Commercial manufacturing and dispatch; the Director closes the project.",
          requires=("manufacturing",), sla_days=30),
]

STAGE_INDEX = {s.key: i for i, s in enumerate(STAGES)}
FIRST_STAGE = STAGES[0].key
LAST_STAGE = STAGES[-1].key
CODE_STAGE = "director_approval"  # project code is generated when this stage is approved


def stage(key: str) -> Stage:
    return STAGES[STAGE_INDEX[key]]


def descendants(key: str) -> set[str]:
    """Every stage that (transitively) depends on `key`."""
    out: set[str] = set()
    frontier = {key}
    while frontier:
        frontier = {s.key for s in STAGES if set(s.requires) & frontier} - out
        out |= frontier
    return out


def parallel_with(s: Stage) -> list[str]:
    return [o.key for o in STAGES if o.key != s.key and s.requires and o.requires == s.requires]


def stages_payload() -> list[dict]:
    out = []
    for s in STAGES:
        d = asdict(s)
        d["requires"] = list(s.requires)
        d["parallel_with"] = parallel_with(s)
        out.append(d)
    return out
