"""Process configuration for the Neo platform (see "NEO Simple System Flow & Build Requirements").

One Project 360 record moves through 12 phases. Phases 3 and 4 are five *workstreams* that run in
parallel with independent status (Commercial, Legal, Regulatory, Artwork, Manufacturer data); the
"Dossier Ready" milestone needs all of them approved/locked (or bypassed when optional).

Every stage uses the same approval cycle:  work -> submit -> approve | send back (repeatable) | reject.
A stage becomes active once everything in `requires` is approved, so stages that share the same
prerequisites run in parallel. Change this file to change the process; nothing else hard-codes it.
"""
from dataclasses import asdict, dataclass

AU = "Neo Health – Australia"
IN = "Neo India"
MP = "Manufacturing Partner"
JOINT = "Australia + India"


@dataclass(frozen=True)
class Stage:
    key: str
    name: str
    phase: int            # 1..12, as numbered in the flow document
    entity: str
    owner: str            # who does the work (display)
    approver: str         # who approves (display)
    owner_roles: tuple    # roles allowed to submit the work
    approver_roles: tuple  # roles allowed to approve / send back / reject
    description: str
    requires: tuple = ()
    workstream: bool = False   # one of the five parallel workstreams in Project 360
    optional: bool = False     # may be bypassed (e.g. artwork not needed for this submission type)
    can_close: bool = False    # approver may reject the whole project here
    sla_days: int = 14


STAGES: list[Stage] = [
    Stage("opportunity", "Opportunity", 1, AU, "Commercial / Project team", "Director or Commercial lead",
          ("commercial", "project_manager"), ("director", "commercial"),
          "Opportunity identified and screened by Neo Health Australia.", can_close=True, sla_days=7),
    Stage("brief", "Project Brief", 2, JOINT, "Project Manager", "Director or Commercial lead",
          ("project_manager", "commercial"), ("director", "commercial"),
          "Brief created and reviewed. The project code is issued when the brief is approved.",
          requires=("opportunity",), sla_days=14),
    # ---- phase 3 + 4: five workstreams, all start when the brief is approved ----
    Stage("commercial", "Feasibility & Commercial", 3, AU, "Commercial team", "Director or Commercial lead",
          ("commercial", "project_manager"), ("director", "commercial"),
          "Feasibility and FMEA, cost and financial review, risk adjustment and commercial approval.",
          requires=("brief",), workstream=True, can_close=True, sla_days=21),
    Stage("legal", "Legal / Agreements", 4, IN, "Legal team", "Legal lead or Director",
          ("legal", "project_manager"), ("legal", "director"),
          "Supplier, Quality and PV agreements run in parallel, plus NDA / CDA / POA / notices.",
          requires=("brief",), workstream=True, sla_days=30),
    Stage("regulatory", "Regulatory / Dossier", 4, IN, "Regulatory team", "RA reviewer or Director",
          ("regulatory", "project_manager"), ("regulatory", "director"),
          "Submission type, dossier structure and checklist, RA review.",
          requires=("brief",), workstream=True, sla_days=45),
    Stage("artwork", "Artwork / Packaging", 4, IN, "Artwork team", "Regulatory review, then Director",
          ("artwork", "project_manager"), ("regulatory", "director"),
          "Carton, label, leaflet / insert, shade card and revisions.",
          requires=("brief",), workstream=True, optional=True, sla_days=30),
    Stage("manufacturer", "Manufacturer / Technical data", 4, MP, "Technical coordinator", "RA reviewer or Technical lead",
          ("technical", "project_manager"), ("regulatory", "technical"),
          "COA, MSDS, specification, testing, stability and manufacturing data from the manufacturer.",
          requires=("brief",), workstream=True, optional=True, sla_days=30),
    # ---- milestone: every workstream approved/locked (or bypassed) ----
    Stage("dossier_ready", "Dossier Ready", 5, IN, "Regulatory team", "RA reviewer or Director",
          ("regulatory", "project_manager"), ("regulatory", "director"),
          "Milestone lock. Complete only when the dossier, required artwork, required manufacturer data and "
          "legal / commercial conditions are all approved.",
          requires=("commercial", "legal", "regulatory", "artwork", "manufacturer"), sla_days=7),
    Stage("submission", "Regulatory Submission", 6, IN, "Regulatory team", "RA reviewer",
          ("regulatory",), ("regulatory", "director"),
          "RA review, then the external submission is recorded (platform configurable).",
          requires=("dossier_ready",), sla_days=14),
    Stage("rfi", "RFI / Changes", 7, IN, "Regulatory team", "RA reviewer",
          ("regulatory",), ("regulatory", "director"),
          "Authority questions are assigned, evidence and responses tracked. Closes when no RFI is open.",
          requires=("submission",), sla_days=60),
    Stage("approval", "Regulatory Approval", 8, IN, "Regulatory team", "RA reviewer or Director",
          ("regulatory", "project_manager"), ("regulatory", "director"),
          "Regulatory approval / market authorisation received.",
          requires=("rfi",), can_close=True, sla_days=90),
    Stage("readiness", "Commercial Readiness", 9, JOINT, "Commercial + Artwork", "Director or Commercial lead",
          ("commercial", "artwork", "project_manager"), ("director", "commercial"),
          "Final readiness: print proof, packaging and launch plan.",
          requires=("approval",), sla_days=30),
    Stage("manufacturing", "Manufacturing", 10, MP, "Technical coordinator", "Technical lead or Director",
          ("technical", "project_manager"), ("technical", "director"),
          "Commercial manufacturing with quality oversight.",
          requires=("readiness",), sla_days=60),
    Stage("dispatch", "Samples / Dispatch", 11, JOINT, "Technical coordinator", "Technical lead or Director",
          ("technical", "project_manager"), ("technical", "director"),
          "Pre-shipment sample review and dispatch.",
          requires=("manufacturing",), sla_days=21),
    Stage("completion", "Project Completion", 12, AU, "Project Manager", "Director",
          ("project_manager",), ("director",),
          "Final closure. The full project history is retained and the record is locked.",
          requires=("dispatch",), sla_days=7),
]

STAGE_INDEX = {s.key: i for i, s in enumerate(STAGES)}
FIRST_STAGE = STAGES[0].key
LAST_STAGE = STAGES[-1].key
CODE_STAGE = "brief"  # the project code is issued when this stage is approved
WORKSTREAMS = [s.key for s in STAGES if s.workstream]
SATISFIED = ("approved", "bypassed")


def stage(key: str) -> Stage:
    return STAGES[STAGE_INDEX[key]]


def descendants(key: str) -> set[str]:
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
        d["owner_roles"] = list(s.owner_roles)
        d["approver_roles"] = list(s.approver_roles)
        d["parallel_with"] = parallel_with(s)
        out.append(d)
    return out


# ------------------------------------------------------------------ roles & permissions
PERMISSIONS = {
    "manage_project": "Create and edit projects, hold / resume, move back, record submissions",
    "assign": "Assign tasks to others (within the allowed roles)",
    "reassign": "Reassign tasks that someone else owns",
    "approve": "Approve work, stages, documents and agreements",
    "request_changes": "Send work back / request changes, reject a project",
    "change_dates": "Approve or reject due-date change requests, change due dates",
    "bypass_optional": "Bypass optional work (optional tasks and workstreams)",
    "lock_unlock": "Lock and unlock approved records, reopen a closed project",
    "edit_approved": "Edit records that are already approved",
    "manage_users": "Manage users, roles, permissions and settings",
}
ALL = list(PERMISSIONS)

# key -> (name, default permissions, who they may assign work to: ["*"] or role keys)
DEFAULT_ROLES = {
    "super_admin": ("Super Admin", ALL, ["*"]),
    "director": ("Director", ["manage_project", "assign", "reassign", "approve", "request_changes", "change_dates",
                              "bypass_optional", "lock_unlock"], ["*"]),
    "project_manager": ("Project Manager", ["manage_project", "assign", "reassign", "change_dates"], ["*"]),
    "commercial": ("Commercial", ["assign", "approve", "request_changes"], ["commercial", "project_manager", "artwork"]),
    "legal": ("Legal", ["assign", "approve", "request_changes"], ["legal", "project_manager"]),
    "regulatory": ("Regulatory (RA)", ["assign", "approve", "request_changes", "change_dates"],
                   ["regulatory", "artwork", "technical", "legal", "commercial"]),
    "artwork": ("Artwork", [], []),
    "technical": ("Technical / Manufacturer data", ["assign", "approve", "request_changes"], ["technical"]),
}

# ------------------------------------------------------------------ tasks
TASK_STATES = ["assigned", "accepted", "in_progress", "submitted", "changes_requested", "resubmitted", "approved", "locked"]
TASK_OPEN = ("assigned", "accepted", "in_progress", "submitted", "changes_requested", "resubmitted")
TASK_DONE = ("approved", "locked")
TASK_AWAITING = ("submitted", "resubmitted")

# ------------------------------------------------------------------ modules
CORE_AGREEMENTS = ["supplier", "quality", "pv"]
AGREEMENT_KINDS = {"supplier": "Supplier Agreement", "quality": "Quality Agreement", "pv": "PV Agreement",
                   "nda": "NDA", "cda": "CDA", "poa": "POA", "notice": "Notice"}
AGREEMENT_STATUS = ["not_started", "drafting", "in_review", "sent_for_signature", "signed"]

M = {"M1": "Administrative information", "M2": "Summaries / overviews", "M3": "Quality", "M4": "Nonclinical", "M5": "Clinical / bioequivalence"}
# submission type -> checklist (module or None, title). M1-M5 only where the type requires them.
SUBMISSION_TYPES = {
    "Registered medicine – full dossier (AUST R)": [(m, t) for m, t in M.items()],
    "Registered medicine – abridged / generic (AUST R)": [(m, M[m]) for m in ("M1", "M2", "M3", "M5")],
    "Variation to a registered medicine": [("M1", M["M1"]), ("M3", M["M3"])],
    "Listed medicine (AUST L)": [(None, "Product details and permitted ingredients"), (None, "Label compliance check"),
                                 (None, "Evidence of efficacy held on file")],
}
DOSSIER_STATUS = ["missing", "draft", "ready", "reviewed"]
DOSSIER_DONE = ("ready", "reviewed")

ARTWORK_KINDS = {"carton": "Carton", "label": "Label", "leaflet": "Leaflet / insert", "print_proof": "Print proof", "shade_card": "Shade card"}
ARTWORK_FLOW = ["draft", "regulatory_review", "director_approval", "approved"]
DOC_FLOW = ["draft", "in_review", "approved"]
DOC_KINDS = ["Brief", "Feasibility / FMEA", "Agreement", "Dossier", "Specification", "Report", "Correspondence", "Other"]

MFR_KINDS = {"coa": "COA", "msds": "MSDS", "specification": "Specification", "testing": "Testing data",
             "stability": "Stability data", "manufacturing": "Manufacturing data", "other": "Other"}
MFR_STATUS = ["requested", "received", "under_review", "accepted", "rejected"]
MFR_DONE = ("accepted",)

RFI_STATUS = ["open", "response_ready", "submitted", "closed"]
HEALTH = ("green", "amber", "red")

DEFAULT_SETTINGS = {
    "reminder_days": "7,3,1,0",             # reminders before the due date (0 = due today)
    "escalate_after_days": "1",             # overdue this many days -> escalate to the assigner and project manager
    "submission_platform": "TGA external submission platform (to be confirmed)",
    "manufacturer_access": "Internal entry by Neo technical team (to be confirmed: account / secure upload / internal entry)",
}
