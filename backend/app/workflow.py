"""The process model. The *process itself* (stages, what depends on what, who approves, which entries need approval)
is data: a `Flow` built from a workflow definition stored in the database (versioned: draft -> published).
This file holds the vocabulary, the validation, and the built-in presets used to start a new draft.

Every stage uses the same approval cycle:  work -> submit -> approve | send back (repeatable) | reject project.
A stage becomes active when everything in `requires` is approved (or bypassed), so stages that share the same
prerequisites run in parallel, and a stage that requires several others is a join / milestone.
"""
import re
from dataclasses import asdict, dataclass, field, replace

AU = "Neo Health – Australia"
IN = "Neo India"
MP = "Manufacturing Partner"
JOINT = "Australia + India"
ENTITIES = [AU, IN, MP, JOINT]

# Optional behaviours a stage can switch on. Each may be used by at most one stage in a workflow.
FEATURES = {
    "agreements": "Legal register: Supplier, Quality and PV agreements (must be signed before the stage is submitted)",
    "dossier": "Dossier checklist and submission type (required items must be ready)",
    "mfr": "Manufacturer / technical data requests (required items must be accepted)",
    "artwork": "Artwork and packaging review flow (items must be approved)",
    "submission": "External submission (one must be recorded before the stage is submitted)",
    "rfi": "RFI cases (all must be closed before the stage is submitted)",
    "issue_code": "Issues the project code when the stage is approved",
}
FEATURE_TAB = {"agreements": "legal", "dossier": "regulatory", "submission": "regulatory", "rfi": "rfi", "artwork": "artwork", "mfr": "manufacturer"}


@dataclass(frozen=True)
class Stage:
    key: str
    name: str
    phase: int
    entity: str
    owner: str             # who does the work (display text)
    approver: str          # who approves (display text)
    owner_roles: tuple     # roles allowed to submit the work
    approver_roles: tuple  # roles allowed to approve / send back / reject
    description: str = ""
    requires: tuple = ()   # keys of stages that must be approved first
    group: str = ""        # column on the pipeline board
    workstream: bool = False   # shown as a workstream card in Project 360
    milestone: bool = False    # a lock / join point (e.g. Dossier Ready)
    optional: bool = False     # may be bypassed with a reason
    can_close: bool = False    # the approver may reject the whole project here
    sla_days: int = 14
    features: tuple = ()

    @staticmethod
    def from_dict(d: dict) -> "Stage":
        d = dict(d)
        for k in ("requires", "owner_roles", "approver_roles", "features"):
            d[k] = tuple(d.get(k) or ())
        known = {f for f in Stage.__dataclass_fields__}
        return Stage(**{k: v for k, v in d.items() if k in known})


# ------------------------------------------------------------------ entry approval rules
DEFAULT_RULES = {
    # who approves work on each kind of entry, and whether approval is needed at all
    "task": {"approval": True},
    "document": {"approval": True},
    "artwork": {"steps": [{"status": "regulatory_review", "label": "Regulatory review", "roles": ["regulatory"]},
                          {"status": "director_approval", "label": "Director approval", "roles": ["director"]}]},
    "agreement": {"approval": True, "roles": ["legal", "director"]},
    "dossier_item": {"approval": True, "roles": ["regulatory", "director"]},
    "mfr": {"approval": True, "roles": ["regulatory", "technical"]},
    "rfi_close": {"roles": ["regulatory", "director"]},
}
RULE_LABELS = {
    "task": "Tasks", "document": "Documents", "artwork": "Artwork & packaging", "agreement": "Agreements (review before signature)",
    "dossier_item": "Dossier checklist items", "mfr": "Manufacturer data", "rfi_close": "Closing an RFI case",
}


class Flow:
    """A workflow definition ready to use."""

    def __init__(self, stages: list[Stage], rules: dict | None = None):
        self.stages = list(stages)
        self.index = {s.key: i for i, s in enumerate(self.stages)}
        merged = {k: dict(v) for k, v in DEFAULT_RULES.items()}
        for k, v in (rules or {}).items():
            if k in merged and isinstance(v, dict):
                merged[k].update(v)
        self.rules = merged

    # ---- lookups
    def stage(self, key: str) -> Stage:
        return self.stages[self.index[key]]

    def has(self, key) -> bool:
        return key in self.index

    def with_feature(self, feature: str) -> Stage | None:
        return next((s for s in self.stages if feature in s.features), None)

    @property
    def features(self) -> dict:
        return {f: s.key for s in self.stages for f in s.features}

    @property
    def milestone(self) -> Stage | None:
        return next((s for s in self.stages if s.milestone), None)

    @property
    def starts(self) -> list[Stage]:
        return [s for s in self.stages if not s.requires]

    @property
    def terminals(self) -> list[Stage]:
        needed = {r for s in self.stages for r in s.requires}
        return [s for s in self.stages if s.key not in needed]

    @property
    def groups(self) -> list[str]:
        out = []
        for s in self.stages:
            g = s.group or "Stages"
            if g not in out:
                out.append(g)
        return out

    def descendants(self, key: str) -> set[str]:
        out: set[str] = set()
        frontier = {key}
        while frontier:
            frontier = {s.key for s in self.stages if set(s.requires) & frontier} - out
            out |= frontier
        return out

    def parallel_with(self, s: Stage) -> list[str]:
        return [o.key for o in self.stages if o.key != s.key and s.requires and o.requires == s.requires]

    def layers(self) -> list[list[str]]:
        """Stages grouped by how many steps they are from a start: everything in one layer can run at the same time."""
        depth: dict[str, int] = {}
        for s in self.stages:  # stages are validated to be listed after their prerequisites? not required: iterate to a fixpoint
            depth[s.key] = 0
        for _ in range(len(self.stages)):
            for s in self.stages:
                depth[s.key] = max([depth[r] + 1 for r in s.requires if r in depth] or [0])
        out: list[list[str]] = []
        for s in self.stages:
            while len(out) <= depth[s.key]:
                out.append([])
            out[depth[s.key]].append(s.key)
        return out

    # ---- (de)serialisation
    def stage_payload(self, s: Stage) -> dict:
        d = asdict(s)
        for k in ("requires", "owner_roles", "approver_roles", "features"):
            d[k] = list(d[k])
        d["parallel_with"] = self.parallel_with(s)
        d["tab"] = next((FEATURE_TAB[f] for f in s.features if f in FEATURE_TAB), "tasks")
        return d

    def payload(self) -> dict:
        return {"stages": [self.stage_payload(s) for s in self.stages], "rules": self.rules, "features": self.features,
                "groups": self.groups, "layers": self.layers()}

    def to_def(self) -> dict:
        return {"stages": [{**asdict(s), **{k: list(getattr(s, k)) for k in ("requires", "owner_roles", "approver_roles", "features")}}
                           for s in self.stages], "rules": self.rules}

    @classmethod
    def from_def(cls, d: dict) -> "Flow":
        return cls([Stage.from_dict(x) for x in d.get("stages", [])], d.get("rules"))


# ------------------------------------------------------------------ validation (used before a draft is saved or published)
_SLUG = re.compile(r"^[a-z][a-z0-9_]{1,38}$")


def validate_def(d: dict, role_keys: set[str]) -> list[str]:
    errs: list[str] = []
    raw = d.get("stages")
    if not isinstance(raw, list) or not raw:
        return ["The workflow needs at least one stage."]
    keys = []
    for i, x in enumerate(raw, 1):
        k = str(x.get("key", ""))
        label = f"Stage {i} ({x.get('name') or k or 'unnamed'})"
        if not _SLUG.match(k):
            errs.append(f"{label}: the key must be lowercase letters, digits or underscores, starting with a letter.")
        if k in keys:
            errs.append(f"{label}: duplicate key '{k}'.")
        keys.append(k)
        if not str(x.get("name", "")).strip():
            errs.append(f"{label}: give it a name.")
        if not x.get("owner_roles"):
            errs.append(f"{label}: choose at least one role that does the work.")
        if not x.get("approver_roles"):
            errs.append(f"{label}: choose at least one role that approves.")
        bad = [r for r in list(x.get("owner_roles") or []) + list(x.get("approver_roles") or []) if r not in role_keys]
        if bad:
            errs.append(f"{label}: unknown role(s) {', '.join(sorted(set(bad)))}.")
        try:
            if int(x.get("sla_days", 14)) < 1:
                errs.append(f"{label}: the target time must be at least 1 day.")
        except (TypeError, ValueError):
            errs.append(f"{label}: the target time must be a number of days.")
        for f in x.get("features") or []:
            if f not in FEATURES:
                errs.append(f"{label}: unknown feature '{f}'.")
    keyset = set(keys)
    for x in raw:
        for r in x.get("requires") or []:
            if r not in keyset:
                errs.append(f"{x.get('name') or x.get('key')}: starts after unknown stage '{r}'.")
            elif r == x.get("key"):
                errs.append(f"{x.get('name') or x.get('key')}: cannot start after itself.")
    seen_feature: dict[str, str] = {}
    for x in raw:
        for f in x.get("features") or []:
            if f in seen_feature:
                errs.append(f"The '{f}' feature is used by both {seen_feature[f]} and {x.get('name')}; it can only be on one stage.")
            seen_feature[f] = x.get("name") or x.get("key")
    if errs:
        return errs
    # cycles / start / reachability
    deps = {x["key"]: set(x.get("requires") or []) for x in raw}
    if not any(not v for v in deps.values()):
        errs.append("There is no starting stage: at least one stage must not depend on another.")
    done: set[str] = set()
    while True:
        ready = {k for k, v in deps.items() if k not in done and v <= done}
        if not ready:
            break
        done |= ready
    if len(done) != len(deps):
        stuck = ", ".join(sorted(set(deps) - done))
        errs.append(f"These stages can never start (a circular dependency): {stuck}.")
    if sum(1 for x in raw if x.get("milestone")) > 1:
        errs.append("Only one stage can be marked as the milestone.")
    steps = (d.get("rules") or {}).get("artwork", {}).get("steps")
    if steps is not None:
        if not steps:
            errs.append("Artwork needs at least one review step.")
        for st in steps:
            if not re.match(r"^[a-z][a-z0-9_]{1,30}$", str(st.get("status", ""))) or not st.get("roles"):
                errs.append("Each artwork review step needs a key (letters, digits, underscore) and at least one role.")
                break
    return errs


# ------------------------------------------------------------------ registry (published + draft flows by workflow id)
_REG: dict[int, Flow] = {}


def register(workflow_id: int, flow: Flow):
    _REG[workflow_id] = flow


def get(workflow_id: int) -> Flow:
    return _REG[workflow_id]


# ------------------------------------------------------------------ built-in presets
def _st(key, name, phase, group, entity, owner, approver, owner_roles, approver_roles, desc, requires=(), **kw) -> dict:
    return asdict(Stage(key=key, name=name, phase=phase, group=group, entity=entity, owner=owner, approver=approver,
                        owner_roles=tuple(owner_roles), approver_roles=tuple(approver_roles), description=desc,
                        requires=tuple(requires), **kw))


def _preset(parallel_after: str | None, name: str) -> dict:
    """parallel_after: 'commercial' (legal/regulatory/artwork/manufacturer start after Commercial approval),
    'brief' (all five workstreams start together after the brief) or None (strict sequence)."""
    G1, G2, G3, G4, G5 = "Initiation", "Governance", "Parallel workstreams", "Dossier & regulatory", "Delivery"
    if parallel_after == "brief":
        G2 = G3 = "Governance & parallel work"
    com_req = ("brief",)
    par_req = ("commercial",) if parallel_after == "commercial" else ("brief",)
    seq = parallel_after is None
    legal_req = ("commercial",) if seq else par_req
    chain = {"legal": legal_req, "regulatory": ("legal",) if seq else par_req,
             "artwork": ("regulatory",) if seq else par_req, "manufacturer": ("artwork",) if seq else par_req}
    join = ("manufacturer",) if seq else (("legal", "regulatory", "artwork", "manufacturer") if parallel_after == "commercial"
                                           else ("commercial", "legal", "regulatory", "artwork", "manufacturer"))
    ws = parallel_after is not None
    stages = [
        _st("opportunity", "Opportunity", 1, G1, AU, "Commercial / Project team", "Director or Commercial lead", ("commercial", "project_manager"),
            ("director", "commercial"), "Opportunity identified and screened by Neo Health Australia.", can_close=True, sla_days=7),
        _st("brief", "Project Brief", 2, G1, JOINT, "Project Manager", "Director or Commercial lead", ("project_manager", "commercial"),
            ("director", "commercial"), "Brief created and reviewed. The project code is issued when the brief is approved.",
            ("opportunity",), sla_days=14, features=("issue_code",)),
        _st("commercial", "Feasibility & Commercial", 3, G2, AU, "Commercial team", "Director or Commercial lead", ("commercial", "project_manager"),
            ("director", "commercial"), "Feasibility and FMEA, cost and financial review, risk adjustment and commercial approval.",
            com_req, workstream=parallel_after == "brief", can_close=True, sla_days=21),
        _st("legal", "Legal / Agreements", 4, G3, IN, "Legal team", "Legal lead or Director", ("legal", "project_manager"), ("legal", "director"),
            "Supplier, Quality and PV agreements run in parallel, plus NDA / CDA / POA / notices.", chain["legal"], workstream=ws,
            sla_days=30, features=("agreements",)),
        _st("regulatory", "Regulatory / Dossier", 4, G3, IN, "Regulatory team", "RA reviewer or Director", ("regulatory", "project_manager"),
            ("regulatory", "director"), "Submission type, dossier structure and checklist, RA review.", chain["regulatory"], workstream=ws,
            sla_days=45, features=("dossier",)),
        _st("artwork", "Artwork / Packaging", 4, G3, IN, "Artwork team", "Regulatory review, then Director", ("artwork", "project_manager"),
            ("regulatory", "director"), "Carton, label, leaflet / insert, shade card and revisions.", chain["artwork"], workstream=ws,
            optional=True, sla_days=30, features=("artwork",)),
        _st("manufacturer", "Manufacturer / Technical data", 4, G3, MP, "Technical coordinator", "RA reviewer or Technical lead",
            ("technical", "project_manager"), ("regulatory", "technical"),
            "COA, MSDS, specification, testing, stability and manufacturing data from the manufacturer.", chain["manufacturer"], workstream=ws,
            optional=True, sla_days=30, features=("mfr",)),
        _st("dossier_ready", "Dossier Ready", 5, G4, IN, "Regulatory team", "RA reviewer or Director", ("regulatory", "project_manager"),
            ("regulatory", "director"), "Milestone lock. Complete only when the dossier, required artwork, required manufacturer data "
            "and legal / commercial conditions are all approved.", join, milestone=True, sla_days=7),
        _st("submission", "Regulatory Submission", 6, G4, IN, "Regulatory team", "RA reviewer", ("regulatory",), ("regulatory", "director"),
            "RA review, then the external submission is recorded (platform configurable).", ("dossier_ready",), sla_days=14, features=("submission",)),
        _st("rfi", "RFI / Changes", 7, G4, IN, "Regulatory team", "RA reviewer", ("regulatory",), ("regulatory", "director"),
            "Authority questions are assigned, evidence and responses tracked. Closes when no RFI is open.", ("submission",), sla_days=60,
            features=("rfi",)),
        _st("approval", "Regulatory Approval", 8, G4, IN, "Regulatory team", "RA reviewer or Director", ("regulatory", "project_manager"),
            ("regulatory", "director"), "Regulatory approval / market authorisation received.", ("rfi",), can_close=True, sla_days=90),
        _st("readiness", "Commercial Readiness", 9, G5, JOINT, "Commercial + Artwork", "Director or Commercial lead",
            ("commercial", "artwork", "project_manager"), ("director", "commercial"), "Final readiness: print proof, packaging and launch plan.",
            ("approval",), sla_days=30),
        _st("manufacturing", "Manufacturing", 10, G5, MP, "Technical coordinator", "Technical lead or Director", ("technical", "project_manager"),
            ("technical", "director"), "Commercial manufacturing with quality oversight.", ("readiness",), sla_days=60),
        _st("dispatch", "Samples / Dispatch", 11, G5, JOINT, "Technical coordinator", "Technical lead or Director", ("technical", "project_manager"),
            ("technical", "director"), "Pre-shipment sample review and dispatch.", ("manufacturing",), sla_days=21),
        _st("completion", "Project Completion", 12, G5, AU, "Project Manager", "Director", ("project_manager",), ("director",),
            "Final closure. The full project history is retained and the record is locked.", ("dispatch",), sla_days=7),
    ]
    return {"stages": stages, "rules": {k: dict(v) for k, v in DEFAULT_RULES.items()}}


PRESETS = {
    "after_commercial": ("Parallel after Commercial Approval",
                         "Legal, Regulatory, Artwork and Manufacturer data all start together once Commercial is approved; "
                         "Dossier Ready needs all four.", lambda: _preset("commercial", "")),
    "from_brief": ("Parallel from the Brief (requirements document)",
                   "Commercial, Legal, Regulatory, Artwork and Manufacturer data all start together once the brief is approved.",
                   lambda: _preset("brief", "")),
    "sequential": ("Strict sequence (one phase at a time)",
                   "Every phase waits for the previous one. The most controlled option, and the slowest.", lambda: _preset(None, "")),
}


def preset_def(key: str) -> dict:
    return PRESETS[key][2]()


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
    "manage_workflow": "Edit workflow drafts and publish a new workflow version",
    "manage_users": "Manage users, roles, permissions and settings",
}
ALL = list(PERMISSIONS)

# key -> (name, default permissions, who they may assign work to: ["*"] or role keys)
DEFAULT_ROLES = {
    "super_admin": ("Super Admin", ALL, ["*"]),
    "director": ("Director", ["manage_project", "assign", "reassign", "approve", "request_changes", "change_dates",
                              "bypass_optional", "lock_unlock", "manage_workflow"], ["*"]),
    "project_manager": ("Project Manager", ["manage_project", "assign", "reassign", "change_dates"], ["*"]),
    "commercial": ("Commercial", ["assign", "approve", "request_changes"], ["commercial", "project_manager", "artwork"]),
    "legal": ("Legal", ["assign", "approve", "request_changes"], ["legal", "project_manager"]),
    "regulatory": ("Regulatory (RA)", ["assign", "approve", "request_changes", "change_dates"],
                   ["regulatory", "artwork", "technical", "legal", "commercial"]),
    "artwork": ("Artwork", [], []),
    "technical": ("Technical / Manufacturer data", ["assign", "approve", "request_changes"], ["technical"]),
    "reviewer": ("Client reviewer (view and comment on the process)", [], []),
}

# ------------------------------------------------------------------ tasks
TASK_STATES = ["assigned", "accepted", "in_progress", "submitted", "changes_requested", "resubmitted", "approved", "locked"]
TASK_OPEN = ("assigned", "accepted", "in_progress", "submitted", "changes_requested", "resubmitted")
TASK_DONE = ("approved", "locked")
TASK_AWAITING = ("submitted", "resubmitted")
SATISFIED = ("approved", "bypassed")

# ------------------------------------------------------------------ modules
CORE_AGREEMENTS = ["supplier", "quality", "pv"]
AGREEMENT_KINDS = {"supplier": "Supplier Agreement", "quality": "Quality Agreement", "pv": "PV Agreement",
                   "nda": "NDA", "cda": "CDA", "poa": "POA", "notice": "Notice"}
AGREEMENT_STATUS = ["not_started", "drafting", "in_review", "changes_requested", "sent_for_signature", "signed"]

M = {"M1": "Administrative information", "M2": "Summaries / overviews", "M3": "Quality", "M4": "Nonclinical", "M5": "Clinical / bioequivalence"}
# submission type -> checklist (module or None, title). M1-M5 only where the type requires them.
SUBMISSION_TYPES = {
    "Registered medicine – full dossier (AUST R)": [(m, t) for m, t in M.items()],
    "Registered medicine – abridged / generic (AUST R)": [(m, M[m]) for m in ("M1", "M2", "M3", "M5")],
    "Variation to a registered medicine": [("M1", M["M1"]), ("M3", M["M3"])],
    "Listed medicine (AUST L)": [(None, "Product details and permitted ingredients"), (None, "Label compliance check"),
                                 (None, "Evidence of efficacy held on file")],
}
DOSSIER_STATUS = ["missing", "draft", "awaiting_approval", "changes_requested", "ready", "reviewed"]
DOSSIER_DONE = ("ready", "reviewed")

ARTWORK_KINDS = {"carton": "Carton", "label": "Label", "leaflet": "Leaflet / insert", "print_proof": "Print proof", "shade_card": "Shade card"}
DOC_KINDS = ["Brief", "Feasibility / FMEA", "Agreement", "Dossier", "Specification", "Report", "Correspondence", "Other"]

MFR_KINDS = {"coa": "COA", "msds": "MSDS", "specification": "Specification", "testing": "Testing data",
             "stability": "Stability data", "manufacturing": "Manufacturing data", "other": "Other"}
MFR_STATUS = ["requested", "received", "under_review", "changes_requested", "accepted"]
MFR_DONE = ("accepted",)

RFI_STATUS = ["open", "response_ready", "submitted", "closed"]
HEALTH = ("green", "amber", "red")

DEFAULT_SETTINGS = {
    "reminder_days": "7,3,1,0",             # reminders before the due date (0 = due today)
    "escalate_after_days": "1",             # overdue this many days -> escalate to the assigner and project manager
    "submission_platform": "TGA external submission platform (to be confirmed)",
    "manufacturer_access": "Internal entry by Neo technical team (to be confirmed: account / secure upload / internal entry)",
}
