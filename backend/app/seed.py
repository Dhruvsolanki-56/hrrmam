"""Reference data (roles, settings, the Neo process, a first Super Admin) and an optional demo portfolio.

The demo is driven through the real services: every record is made by the person who would make it and every
submit / approve / send-back goes through the same guards as the live app, so seeding doubles as a check of the flow.

One specialist owns each phase (Amit: commercial, Kavita: legal, Anjali: regulatory, Neha: artwork, Suresh: technical
data); Rajiv (director) approves and Priya (project manager) coordinates."""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as sc
from . import workflow
from .models import Notification, Project, Role, Setting, User
from .services import common, engine, extras, modules, tasks, workflows


def seed_reference(db: Session):
    for key, (name, perms, assign_to) in workflow.DEFAULT_ROLES.items():
        if not db.get(Role, key):
            db.add(Role(key=key, name=name, permissions=list(perms), assign_to=list(assign_to)))
    for k, v in workflow.DEFAULT_SETTINGS.items():
        if not db.get(Setting, k):
            db.add(Setting(key=k, value=v))
    db.flush()
    if not db.scalar(select(User.id).limit(1)):
        db.add(User(name="Administrator", email="admin@example.com", role_key="super_admin", country="AU"))
    db.commit()
    publish_process(db)


def publish_process(db: Session):
    """Projects need a published process. Neo's runs every workstream in parallel once the brief is approved."""
    if workflows.current(db):
        return
    admin = db.scalar(select(User).where(User.role_key == "super_admin", User.active))
    draft = workflows.create_draft(db, admin, "Neo standard process",
                                   "Commercial, Legal, Regulatory, Artwork and Manufacturer data all start together once the brief is "
                                   "approved. Dossier Ready needs all five.", preset="from_brief")
    workflows.publish(db, admin, draft)


# one person per role, so every phase has exactly one owner
PEOPLE = [  # name, role, country
    ("Vikram Malhotra", "super_admin", "AU"), ("Rajiv Kapoor", "director", "AU"), ("Priya Sharma", "project_manager", "IN"),
    ("Amit Verma", "commercial", "AU"), ("Kavita Joshi", "legal", "IN"), ("Anjali Desai", "regulatory", "IN"),
    ("Neha Kulkarni", "artwork", "IN"), ("Suresh Patel", "technical", "IN"), ("Meera Iyer", "quality", "IN"),
]

# stage -> (who does the work, who approves it)
LANE = {
    "opportunity": ("commercial", "director"), "brief": ("project_manager", "director"), "commercial": ("commercial", "director"),
    "legal": ("legal", "director"), "regulatory": ("regulatory", "director"), "artwork": ("artwork", "regulatory"),
    "manufacturer": ("technical", "regulatory"), "quality": ("quality", "director"), "dossier_ready": ("regulatory", "director"), "submission": ("regulatory", "director"),
    "rfi": ("regulatory", "director"), "approval": ("regulatory", "director"), "readiness": ("commercial", "director"),
    "manufacturing": ("technical", "director"), "dispatch": ("technical", "director"), "completion": ("project_manager", "director"),
}
LANES = ("commercial", "legal", "regulatory", "artwork", "manufacturer", "quality")


def seed_demo(db: Session):
    if db.scalar(select(Project.id).limit(1)):
        return
    for u in db.scalars(select(User).where(User.name == "Administrator")):
        u.active = False  # replaced by the people below
    for name, role, country in PEOPLE:
        first, last = name.lower().split()
        db.add(User(name=name, email=f"{first}.{last}@neo.example", role_key=role, country=country))
    db.commit()
    Demo(db).build()
    # an inbox that looks lived in: older notifications already read, the newest few still unread
    now = datetime.now(timezone.utc)
    per_user: dict[int, int] = {}
    for n in db.scalars(select(Notification).order_by(Notification.id.desc())):
        i = per_user[n.user_id] = per_user.get(n.user_id, 0) + 1
        n.created_at = now - timedelta(hours=3 * i + n.id % 3)
        n.read = i > 6
    db.commit()


# ---------------------------------------------------------------------------------------------- content
TASKS = {
    "opportunity": [("Screen against the portfolio criteria", "Score the idea on market size, margin, regulatory route and fit with the Neo range."),
                    ("Market sizing and competitor scan", "Pharmacy sales for the last 12 months plus the top five competing products."),
                    ("Shortlist candidate manufacturers", "At least two Indian manufacturers with TGA GMP clearance for this dosage form.")],
    "brief": [("Draft the project brief", "Product, market, client, formulation, commercial expectations, timings and the regulatory route."),
              ("Confirm the target client and launch window", "Name the pharmacy group and the month Australia wants the product on shelf."),
              ("Brief review with the Director", "Walk through the brief and record the decisions in the minutes.")],
    "commercial": [("Complete the FMEA risk analysis", "Failure modes for supply, quality and regulatory risk, each with an owner and a mitigation."),
                   ("Finalise the cost model", "Landed cost per pack including freight, duty and packaging."),
                   ("Pricing and margin review", "Shelf price scenarios against the main pharmacy banner groups."),
                   ("Three-year volume forecast", "Units by month for the launch year, then yearly for years two and three.")],
    "legal": [("Draft the supplier agreement", "Use the 2026 supply template; payment terms 60 days."),
              ("Quality agreement redlines", "Respond to the manufacturer's comments on change control and recalls."),
              ("PV agreement with the manufacturer", "Safety data exchange timelines and contact points."),
              ("Execute the mutual NDA", "Countersign and file the executed copy.")],
    "regulatory": [("Compile the administrative pack", "Application form, sponsor details, GMP clearance and fee calculation."),
                   ("Write the quality overall summary", "Summarise Module 3 for the evaluator."),
                   ("Check ingredients against the permitted list", "Every excipient checked against the TGA ingredient tables."),
                   ("Prepare the ARTG entry draft", "Indications, warnings and product details for the ARTG entry.")],
    "artwork": [("Carton design from the brand template", "Use the Neo 2026 pack architecture and the category colour."),
                ("Label copy check against the ARTG entry", "Every statement on pack must match the ARTG entry word for word."),
                ("Consumer leaflet layout", "Minimum 8 pt text; include the dosage table."),
                ("Shade card sign-off with the printer", "Match the Neo green to the approved Pantone reference.")],
    "manufacturer": [("Request the COA for three pilot batches", "Certificates of analysis for the three registration batches."),
                     ("Chase the MSDS for all excipients", "Current safety data sheets, no older than three years."),
                     ("Review the stability protocol", "Long-term and accelerated conditions with 6, 12 and 24 month pulls."),
                     ("Collect the process description", "Manufacturing flow chart with in-process controls.")],
    "quality": [("Quality risk assessment for the product", "Critical quality attributes, controls and the residual risk rating."),
                ("Review the manufacturer's quality system", "Audit report, CAPA status and the last inspection outcome."),
                ("Set up the pharmacovigilance contact points", "Safety mailbox, 24-hour contact and the reporting timelines."),
                ("Complete the PV system summary", "Summarise how adverse events are collected, assessed and reported.")],
    "dossier_ready": [("Final dossier QC", "Hyperlinks, bookmarks and page numbering across all modules."),
                      ("Cross-check artwork against the dossier", "Carton and label text against the product information."),
                      ("Submission ready sign-off checklist", "Confirm commercial, legal, dossier, artwork and manufacturer data are all approved.")],
    "submission": [("Upload the dossier to TGA Business Services", "Lodge the application and attach the eCTD sequence."),
                   ("Pay the evaluation fee", "Raise the PO and pay within five working days of lodgement."),
                   ("Confirm the submission acknowledgement", "File the TGA acknowledgement and note the submission number.")],
    "rfi": [("Draft the response cover letter", "Cover letter listing each question and where the answer sits."),
            ("Collate evidence for the response", "Put every evidence file in the response package folder.")],
    "approval": [("Record the ARTG number", "Add the ARTG number to the product master and the artwork."),
                 ("Update product master data", "ERP item, barcodes and pricing set up for launch."),
                 ("Share the approval letter with Australia", "Send the approval letter and the approved indications to the commercial team.")],
    "readiness": [("Approve the final print proof", "Wet proof checked against the approved artwork."),
                  ("Launch plan and sales briefing", "Sell-in story, pricing and the promotional calendar."),
                  ("Pharmacy listing pack", "Product data sheets and images for the banner groups.")],
    "manufacturing": [("Confirm the batch 1 manufacturing slot", "Lock in the slot and the raw material call-off."),
                      ("Review the executed batch record", "Deviations, yields and in-process results."),
                      ("Release testing for batch 1", "Finished product testing against the specification.")],
    "dispatch": [("Pre-shipment sample review", "Check retained samples for appearance, labelling and pack integrity."),
                 ("Book freight Mumbai to Sydney", "Sea freight with a temperature logger; ETA in the shared tracker."),
                 ("Import permit and customs entry", "Broker paperwork ready before the vessel arrives.")],
    "completion": [("Post-launch review", "What went well, what to change, and the final cost against budget."),
                   ("Archive the project records", "Confirm every record is final and the audit trail is complete.")],
}

STAGE_DOCS = {
    "opportunity": [("Report", "Opportunity screening summary")],
    "brief": [("Brief", "Project brief")],
    "commercial": [("Feasibility / FMEA", "Feasibility and FMEA report"), ("Report", "Cost model and margin analysis")],
    "regulatory": [("Report", "Regulatory strategy")],
    "manufacturer": [("Specification", "Finished product specification")],
    "quality": [("Report", "Quality risk assessment"), ("Report", "PV system summary")],
    "dossier_ready": [("Dossier", "Submission ready checklist")],
    "submission": [("Correspondence", "TGA acknowledgement letter")],
    "approval": [("Correspondence", "ARTG approval letter")],
    "readiness": [("Report", "Launch readiness checklist")],
    "manufacturing": [("Report", "Batch 1 manufacturing record")],
    "dispatch": [("Report", "Pre-shipment sample report")],
    "completion": [("Report", "Project closure report")],
}

SEND_BACK = {
    "opportunity": "Add the competitor price points before this goes for a decision.",
    "brief": "Pack size and target price are still missing from the brief.",
    "commercial": "The manufacturer's quote of AUD 2.10 per pack is above the AUD 1.85 ceiling. Renegotiate and resubmit.",
    "legal": "Liability cap in the quality agreement must match the supply agreement.",
    "regulatory": "The Module 3 stability justification is incomplete. Include the latest report.",
    "artwork": "Storage statement on the carton does not match the ARTG entry.",
    "manufacturer": "The COA is missing the assay results for batch 3.",
    "quality": "The PV contact points are missing the out-of-hours number.",
}
REWORK_TASK = {
    "commercial": ("Renegotiate the unit cost with the manufacturer", "Target below AUD 1.85 per pack. Report back with the revised quote."),
}
NEEDED_FOR = {"coa": "Module 3 (Quality)", "msds": "Module 3 (Quality)", "specification": "Module 3 (Quality)",
              "raw_spec": "Module 3 (Drug substance)", "stability": "Module 3 (Stability)", "testing": "Module 3 (Quality)",
              "manufacturing": "Module 3 (Process)"}
CLIENTS = ["ABC Pharmacy", "CityCare Pharmacies", "Southern Cross Chemists", "Harbour Health Group", "Wellness Rx Group", "Outback Pharmacy Alliance"]
AGREEMENT_NOTES = {"addendum": "Adds the second manufacturing site to the supply agreement.", "notice": "Notice of the manufacturer's change of address.",
                   "supplier": "Five-year supply term, 60-day payment, annual price review.",
                   "quality": "Change control notice period 90 days; both QA heads sign.",
                   "pv": "Serious adverse events exchanged within 24 hours.",
                   "nda": "Mutual NDA covering the formulation and pricing.",
                   "cda": "Covers the artwork files shared with the printer.",
                   "poa": "Authorises the sponsor's agent to sign TGA forms."}
AGREEMENT_OPEN = {"in_review": "With Legal for review before it goes for signature.",
                  "changes_requested": "Liability cap must match the supply agreement.",
                  "drafting": "First draft on the 2026 template."}
DOSSIER_NOTES = {"reviewed": "Reviewed by Regulatory, no open comments.", "awaiting_approval": "Submitted for review.",
                 "draft": "Drafting in progress.", "changes_requested": "Update the batch numbers to match the COAs."}
MFR_NOTES = {"raw_spec": "Drug substance and excipient specifications from the approved suppliers.",
             "coa": "Three registration batches. Needed for Module 3.", "msds": "Safety data sheets for every excipient.",
             "specification": "Release and shelf-life specification. Needed for Module 3.",
             "stability": "Zone IVa conditions, 6/12/24 month pulls. Needed for Module 3.",
             "testing": "Microbial limits and preservative efficacy. Needed for Module 3.",
             "manufacturing": "Process flow and in-process controls."}
ART_RETURNS = ["Storage statement incorrect.", "Warning statement needs revision.", "Active ingredient must be on the main panel.",
               "Dosage table does not match the leaflet."]
RFI_QUESTIONS = [  # question, who answers (the RFI is split by owner, as in the brief), evidence
    ("Provide additional stability justification for the commercial pack.", "technical",
     "Data attached: 12 months at 30°C / 75% RH, all results within specification."),
    ("Confirm the impurity specification and the limit for the largest unspecified impurity.", "regulatory",
     "Limit set at 0.2% in line with ICH Q3B and the batch data."),
    ("Clarify the warning statements on the carton.", "artwork",
     "Carton updated; all required statements are present at the correct size."),
]
RFI_SUMMARIES = ["Questions on the stability data, the impurity limits and the carton warnings",
                 "Further detail on the dissolution method and the label statements"]

# kinds of task, as (days until due, steps). "a" is the person doing the work, "c" the person who assigned it.
STEPS = {
    "new": (9, []),
    "upcoming": (21, [("a", "accept")]),
    "week": (4, [("a", "accept")]),
    "today": ("today", [("a", "accept"), ("a", "start")]),
    "overdue": (-3, [("a", "accept"), ("a", "start")]),
    "datereq": (-1, [("a", "accept"), ("a", "start"), ("a", "request_date", "Waiting on the manufacturer's data pack", 6)]),
    "waiting": (6, [("a", "accept"), ("a", "start"), ("a", "submit", "Draft attached and ready for your review.")]),
    "returned": (5, [("a", "accept"), ("a", "start"), ("a", "submit", "First version for review."),
                     ("c", "request_changes", "Please add the batch references and re-check the totals.")]),
    "done": (-8, [("a", "accept"), ("a", "start"), ("a", "submit", "Done, files are in the project folder."), ("c", "approve")]),
    "negotiated": (-10, [("a", "accept"), ("a", "start"), ("a", "request_date", "Needs the latest supplier quote first", -4),
                         ("c", "approve_date", "Agreed, new date set."), ("a", "submit", "Done with the latest quote."), ("c", "approve")]),
}
MID = ["week", "waiting", "today", "done", "returned", "upcoming"]
CALM_MID = ["week", "waiting", "done", "upcoming", "done", "week"]
LEVEL_KINDS = {"early": ["new", "upcoming", "week", "new"], "late": ["overdue", "datereq", "waiting", "returned"],
               "nearly": ["done", "done", "waiting", "week"]}
OVERSIGHT_PM = [("Prepare the steering committee update", "One page: progress, risks and the decisions needed."),
                ("Confirm the resource plan with the manufacturer", "Capacity, batch slots and the contact for escalations."),
                ("Update the risk and issue log", "Refresh owners, dates and the top three risks."),
                ("Chase the open approvals before the weekly review", "Anything waiting more than two days.")]
OVERSIGHT_DIRECTOR = [("Decide on the revised pricing envelope", "Margin impact of the latest manufacturer quote."),
                      ("Approve the second API source for qualification", "Cost and timing against the single-supplier risk.")]


class Demo:
    def __init__(self, db: Session):
        self.db = db
        self.now = datetime.now(timezone.utc)
        self.R = {u.role_key: u for u in db.scalars(select(User).where(User.active))}
        self.k = 0
        self.mfr = "Zenith Pharma Pvt Ltd"
        self.calm = False
        self.want_rfi = False

    # ---- helpers
    def act(self, p, role, action, stage=None, note="", to_stage=None):
        return engine.apply_action(self.db, self.R[role], p, sc.ActionIn(action=action, stage_key=stage, note=note, to_stage=to_stage))

    def task(self, creator, p, stage, title, assignee, due, steps=(), required=True, desc=""):
        due_at = (datetime.combine(date.today(), time(23, 59), tzinfo=timezone.utc) if due == "today" else self.now + timedelta(days=due))
        t = tasks.create_task(self.db, self.R[creator], p, stage, title, desc, self.R[assignee].id, due_at, required)
        for who, action, *rest in steps:
            if action == "submit":
                extras.add_attachment(self.db, self.R[assignee], t, "", self.link(p, "task", str(t.id), "v1"), "First version")
            kw = {"note": rest[0]} if rest else {}
            if len(rest) > 1:
                kw["due_at"] = self.now + timedelta(days=rest[1])
            tasks.apply_action(self.db, self.R[assignee if who == "a" else creator], t, sc.TaskActionIn(action=action, **kw))
        return t

    def link(self, p, *parts):
        return "https://neo.sharepoint.example/" + str(p.id) + "/" + "/".join(parts)

    # ---- tasks and documents that every stage has
    def stage_tasks(self, p, key, level):
        worker, _ = LANE[key]
        creator = "director" if worker == "project_manager" else "project_manager"
        titles = TASKS[key]
        if level in ("done", "review", "returned"):
            kinds = ["negotiated" if (self.k + i) % 4 == 0 else "done" for i in range(min(3, len(titles)))]
        elif level == "mid":
            pool = CALM_MID if self.calm else MID
            kinds = [pool[(self.k + i) % len(pool)] for i in range(min(3, len(titles)))]
        else:
            kinds = LEVEL_KINDS[level][: min(len(titles), 2 if level == "early" else 3)]
            if self.calm:
                kinds = [("week" if x in ("overdue", "returned") else "upcoming" if x == "datereq" else x) for x in kinds]
        for i, kind in enumerate(kinds):
            due, steps = STEPS[kind]
            if kind in ("done", "negotiated"):
                due -= 6 * i
            title, desc = titles[i]
            self.task(creator, p, key, title, worker, due, steps, desc=desc)

    def stage_docs(self, p, key, level):
        worker, approver = LANE[key]
        for i, (kind, title) in enumerate(STAGE_DOCS.get(key, ())):
            doc = modules.create_document(self.db, self.R[worker], p, sc.DocumentCreate(
                stage_key=key, kind=kind, title=title, owner_id=self.R[worker].id, link=self.link(p, key, f"doc{i + 1}-v1"), note="First draft"))
            if level in ("done", "review", "returned", "nearly") or (level == "mid" and (self.k + i) % 2 == 0):
                modules.document_action(self.db, self.R[worker], doc, "submit", "")
                if level != "mid" and not (level == "nearly" and i == 0 and (self.k % 2)):
                    modules.document_action(self.db, self.R[approver], doc, "approve", "")

    # ---- legal: supplier, quality and PV agreements run side by side, plus NDA / CDA / POA
    def move_agreement(self, a, goal, due):
        legal, director = self.R["legal"], self.R["director"]
        p = a.project
        if goal == "not_started":
            modules.update_agreement(self.db, legal, a, sc.AgreementUpdate(counterparty=self.mfr, owner_id=legal.id, due_date=due))
            return
        notes = AGREEMENT_NOTES[a.kind] if goal in ("sent_for_signature", "signed") else AGREEMENT_OPEN[goal]
        modules.update_agreement(self.db, legal, a, sc.AgreementUpdate(
            status="drafting", counterparty=self.mfr if a.kind != "cda" else "Brandwell Packaging Pty Ltd", owner_id=legal.id, due_date=due,
            notes=notes, link="" if goal == "drafting" else self.link(p, "legal", a.kind)))
        if goal == "drafting":
            return
        modules.entry_action(self.db, legal, "agreement", a, "submit", "")
        if goal == "changes_requested":
            modules.entry_action(self.db, director, "agreement", a, "reject", AGREEMENT_OPEN["changes_requested"])
        elif goal in ("sent_for_signature", "signed"):
            modules.entry_action(self.db, director, "agreement", a, "approve", "")
            if goal == "signed":
                modules.update_agreement(self.db, legal, a, sc.AgreementUpdate(status="signed", signed_date=due + timedelta(days=2), notes=AGREEMENT_NOTES[a.kind]))

    def m_legal(self, p, level):
        today = date.today()
        core = {a.kind: a for a in p.agreements if a.core}
        goals = {"done": ("signed", "signed", "signed"), "review": ("signed", "signed", "signed"), "returned": ("signed", "signed", "signed"),
                 "nearly": ("signed", "signed", "sent_for_signature"),
                 # the example in the brief: Supplier signed, Quality changes requested, PV in review
                 "mid": ("signed", "changes_requested", "in_review"), "early": ("drafting", "not_started", "not_started"),
                 "late": ("signed", "changes_requested", "drafting")}[level]
        late = level == "late"
        for i, kind in enumerate(("supplier", "quality", "pv")):
            due = today + timedelta(days=(-30 + 4 * i) if level in ("done", "review", "returned") else (-6 + 5 * i if late else 8 + 9 * i))
            self.move_agreement(core[kind], goals[i], due)
        extras = {"done": ("signed", "signed", "signed", "signed"), "review": ("signed", "signed", "signed", None), "returned": ("signed", "signed", "signed", None),
                  "nearly": ("signed", "signed", "in_review", "drafting"), "mid": ("signed", None, "drafting", None), "late": ("signed", None, "drafting", "drafting"),
                  "early": ("signed", None, None, None)}[level]
        for kind, goal in zip(("nda", "cda", "poa", "addendum"), extras):
            if not goal:
                continue
            a = modules.create_agreement(self.db, self.R["legal"], p, sc.AgreementCreate(kind=kind, counterparty=self.mfr, owner_id=self.R["legal"].id))
            self.move_agreement(a, goal, today - timedelta(days=40 if goal == "signed" else -12))

    # ---- brief: India reviews it; what is missing is asked, answered and accepted on the record
    def m_brief(self, p, level):
        pm, com = self.R["project_manager"], self.R["commercial"]
        c = extras.create_clarification(self.db, pm, p, "Pack size and the target price per pack are missing from the brief. Please confirm both.",
                                        com.id, date.today() + timedelta(days=4))
        if level in ("mid", "late", "early"):
            if self.k % 2:
                extras.clarification_action(self.db, com, c, "respond", "30 tablets per pack; target shelf price AUD 7.99.")
            return
        extras.clarification_action(self.db, com, c, "respond", "30 tablets per pack; target shelf price AUD 7.99.")
        extras.clarification_action(self.db, pm, c, "accept", "")

    # ---- regulatory: the dossier checklist (M1-M5 only where the submission type needs them)
    def m_regulatory(self, p, level):
        ra, director = self.R["regulatory"], self.R["director"]
        for title, required in (("GMP clearance evidence", True), ("Sponsor declaration", True), ("Product information cross-check", False)):
            modules.create_dossier_item(self.db, ra, p, sc.DossierItemCreate(title=title, required=required))
        items = list(p.dossier_items)
        rot = self.k % 3
        pattern = {"early": ["draft", "missing", "missing", "draft", "missing", "missing", "missing"],
                   "mid": ["reviewed", "reviewed", "awaiting_approval", "draft", "changes_requested", "reviewed", "missing"],
                   "late": ["reviewed", "draft", "changes_requested", "missing", "draft", "missing", "missing"],
                   "nearly": ["reviewed", "reviewed", "reviewed", "reviewed", "reviewed", "awaiting_approval", "draft"]}.get(level, ["reviewed"] * 7)
        for i, it in enumerate(items):
            goal = pattern[(i + (rot if level in ("mid", "late") else 0)) % len(pattern)]
            if not it.required and goal == "missing":
                continue
            if goal == "missing":
                continue
            modules.update_dossier_item(self.db, ra, it, sc.DossierItemUpdate(status="draft", link=self.link(p, "dossier", f"item{i + 1}"),
                                                                              notes=DOSSIER_NOTES["draft"]))
            if goal == "draft":
                continue
            modules.entry_action(self.db, ra, "dossier_item", it, "submit", "")
            if goal == "changes_requested":
                modules.entry_action(self.db, director, "dossier_item", it, "reject", DOSSIER_NOTES["changes_requested"])
                modules.update_dossier_item(self.db, ra, it, sc.DossierItemUpdate(notes=DOSSIER_NOTES["changes_requested"]))
            elif goal == "reviewed":
                modules.entry_action(self.db, director, "dossier_item", it, "approve", "")
                modules.update_dossier_item(self.db, ra, it, sc.DossierItemUpdate(notes=DOSSIER_NOTES["reviewed"]))

    # ---- artwork: every version is kept; Regulatory reviews first, then the Director
    def art(self, p, kind, title, end, versions):
        d, designer, ra, director = self.db, self.R["artwork"], self.R["regulatory"], self.R["director"]
        slug = kind.split()[0].lower()
        doc = modules.create_document(d, designer, p, sc.DocumentCreate(
            artwork=True, kind=kind, title=title, owner_id=designer.id, link=self.link(p, "artwork", f"{slug}-v1"), note="Initial layout from the Neo brand template"))
        qa = self.R["quality"]
        for v in range(1, versions):
            modules.document_action(d, designer, doc, "submit", "")
            if v == 2:  # the example in the brief: V2 is stopped by Quality
                modules.document_action(d, ra, doc, "approve", "")
                modules.document_action(d, qa, doc, "return", "Warning statement needs revision.")
            else:
                modules.document_action(d, ra, doc, "return", ART_RETURNS[(self.k + v) % len(ART_RETURNS)] if v > 1 else ART_RETURNS[0])
            modules.add_version(d, designer, doc, sc.VersionIn(link=self.link(p, "artwork", f"{slug}-v{v + 1}"), note="Updated after the review comments"))
        if end == "draft":
            return
        modules.document_action(d, designer, doc, "submit", "")
        if end == "returned":
            modules.document_action(d, ra, doc, "return", ART_RETURNS[(self.k + versions) % len(ART_RETURNS)])
            return
        if end == "regulatory_review":
            return
        modules.document_action(d, ra, doc, "approve", "")
        if end == "quality_review":
            return
        modules.document_action(d, qa, doc, "approve", "")
        if end == "director_approval":
            return
        modules.document_action(d, director, doc, "approve", "")

    def m_artwork(self, p, level):
        names = [("Carton", "Outer carton"), ("Label", "Primary label"), ("Leaflet / insert", "Consumer medicine leaflet"), ("Shade card", "Pantone shade card")]
        plan = {"done": [("approved", 3), ("approved", 1), ("approved", 2), ("approved", 1)],
                "review": [("approved", 3), ("approved", 1), ("approved", 1), ("approved", 2)],
                "returned": [("approved", 2), ("approved", 1), ("approved", 1), ("approved", 1)],
                # the example in the brief: Carton V3 under review while the rest is further ahead
                "nearly": [("regulatory_review", 3), ("approved", 1), ("approved", 2), ("approved", 1)],
                "mid": [("quality_review", 2), ("approved", 1), ("director_approval", 1), ("draft", 1)],
                "late": [("returned", 2), ("regulatory_review", 1), ("draft", 1), ("returned", 2)],
                "early": [("draft", 1), ("draft", 1), None, None]}[level]
        if level == "mid" and self.k % 2:
            plan = [plan[2], plan[0], plan[3], plan[1]]
        for (kind, title), spec in zip(names, plan):
            if spec:
                self.art(p, kind, f"{title} – {p.product}"[:120], *spec)

    # ---- manufacturer: evidence that flows Manufacturer -> Neo India -> dossier
    def move_mfr(self, m, goal):
        tech, ra = self.R["technical"], self.R["regulatory"]
        if goal == "requested":
            return
        modules.update_mfr(self.db, tech, m, sc.MfrUpdate(status="received", link=self.link(m.project, "mfr", m.kind)))
        if goal == "received":
            return
        modules.entry_action(self.db, tech, "mfr", m, "submit", "")
        if goal == "changes_requested":
            modules.entry_action(self.db, ra, "mfr", m, "reject", "Missing the assay results for batch 3; resend the full report.")
        elif goal == "accepted":
            modules.entry_action(self.db, ra, "mfr", m, "approve", "")

    def m_manufacturer(self, p, level):
        today = date.today()
        kinds = ("coa", "msds", "specification", "raw_spec", "stability", "testing", "manufacturing")
        rot = self.k % 3
        goals = {"done": ["accepted"] * 7, "review": ["accepted"] * 7, "returned": ["accepted"] * 7,
                 # the example in the brief: two documents still pending
                 "nearly": ["accepted", "accepted", "accepted", "accepted", "requested", "under_review", "requested"],
                 "mid": ["accepted", "under_review", "received", "requested", "requested", "requested", "requested"],
                 "late": ["accepted", "requested", "changes_requested", "requested", "requested", "requested", "requested"],
                 "early": ["received", "requested", "requested", "requested", "requested", "requested", "requested"]}[level]
        if level in ("mid", "late"):
            goals = goals[rot:] + goals[:rot]
        for i, (kind, goal) in enumerate(zip(kinds, goals)):
            overdue = goal == "requested" and i % 2 == 1 and level in ("late", "mid")
            m = modules.create_mfr(self.db, self.R["technical"], p, sc.MfrCreate(
                kind=kind, manufacturer=self.mfr, needed_for=NEEDED_FOR[kind], required=kind != "manufacturing", notes=MFR_NOTES[kind], owner_id=self.R["technical"].id,
                due_date=today + timedelta(days=-25 if level in ("done", "review", "returned") else -4 if overdue else 10 + 3 * i)))
            self.move_mfr(m, goal)

    # ---- regulatory submission and RFI
    def m_submission(self, p, level):
        if level in ("mid", "early", "late"):
            return
        today = date.today()
        s = modules.record_submission(self.db, self.R["regulatory"], p, sc.SubmissionIn(
            kind="variation" if p.submission_type.startswith("Variation") else "initial",
            reference=f"TGA-APP-2026-{10000 + (p.id * 137) % 80000}", platform="TGA Business Services",
            submitted_on=today - timedelta(days=60 if level == "done" else 4),
            notes="Dossier lodged and the evaluation fee paid. The acknowledgement letter is filed under Documents."))
        modules.update_submission(self.db, self.R["regulatory"], s, sc.SubmissionUpdate(
            status="approved" if level == "done" else "acknowledged", acknowledgement_ref=f"ACK-{20000 + (p.id * 311) % 70000}",
            acknowledged_on=date.today() - timedelta(days=58 if level == "done" else 3)))

    def m_rfi(self, p, level):
        d, ra, today = self.db, self.R["regulatory"], date.today()
        closed = level in ("done", "review", "returned")
        if closed and not self.want_rfi:
            return
        r = modules.create_rfi(d, ra, p, sc.RFICreate(authority="TGA", reference=f"RFI-2026-{100 + p.id}", summary=RFI_SUMMARIES[p.id % 2],
                                                      received_on=today - timedelta(days=45 if closed else 12),
                                                      due_date=today + timedelta(days=-15 if closed else 9)))
        plan = {"done": 3, "review": 3, "returned": 3, "nearly": 3, "mid": 3, "late": 3, "early": 2}[level]
        # how far each question has got when the case is still open
        steps = [["accept", "start", "submit", "approve"], ["accept", "start", "submit"], ["accept"]]
        for i, (text, who, answer) in enumerate(RFI_QUESTIONS[:plan]):
            q = modules.add_rfi_question(d, ra, r, sc.RFIQuestionCreate(
                question=text, assignee_id=self.R[who].id, due_at=self.now + timedelta(days=-20 if closed else (-1 if i == 2 and level != "nearly" else 3 + 2 * i))))
            go = ["accept", "start", "submit", "approve"] if level in ("done", "review", "returned", "nearly") else steps[i]
            for s in go:
                # a question owned by Regulatory itself is approved by the Director, never by its own assignee
                decider = self.R["director"] if (s == "approve" and who == "regulatory") else ra if s == "approve" else self.R[who]
                tasks.apply_action(d, decider, q.task, sc.TaskActionIn(action=s))
            if "submit" in go:
                modules.update_rfi_question(d, self.R[who], q, sc.RFIQuestionUpdate(response=answer, evidence_link=self.link(p, "rfi", f"q{i + 1}-evidence")))
        if level in ("done", "review", "returned", "nearly"):
            modules.update_rfi(d, ra, r, sc.RFIUpdate(response_link=self.link(p, "rfi", "response-package")))
            modules.rfi_action(d, ra, r, "ready", "")
            modules.rfi_action(d, ra, r, "submit", "")
            if level != "nearly":
                modules.rfi_action(d, ra, r, "close", "TGA confirmed the response answers every question.")

    # ---- one stage from start to finish
    def run_stage(self, p, key, level, finish=True):
        worker, approver = LANE[key]
        self.stage_tasks(p, key, level)
        self.stage_docs(p, key, level)
        getattr(self, "m_" + key, lambda *a: None)(p, level)
        if level == "returned":
            title, desc = REWORK_TASK.get(key, ("Rework after the review comments", "Address the comments and resubmit."))
            self.act(p, worker, "submit", key)
            self.act(p, approver, "send_back", key, SEND_BACK.get(key, "Please address the review comments."))
            self.task("project_manager" if worker != "project_manager" else "director", p, key, title, worker, 3, [("a", "accept"), ("a", "start")], desc=desc)
        elif level in ("done", "review") and finish:
            if level == "done" and self.k % 4 == 0:  # the approver sends it back once, as happens for real
                self.act(p, worker, "submit", key)
                self.act(p, approver, "send_back", key, SEND_BACK.get(key, "Please attach the signed copy and the review notes first."))
            self.act(p, worker, "submit", key)
            if level == "done":
                self.act(p, approver, "approve", key)
        self.k += 1

    # ---- a project: build it by walking its process
    def plan(self, p, at, lanes, state):
        order = [s.key for s in p.flow.stages]
        if at == "completed":
            return {k: "done" for k in order}
        if at == "parallel":
            return {"opportunity": "done", "brief": "done", **{k: lanes.get(k, "mid") for k in LANES}}
        out = {k: "done" for k in order[: order.index(at)]}
        out[at] = {"work": "mid"}.get(state, state)
        return out

    def oversight(self, p):
        """Work the Director gives the Project Manager (and the reverse), so both have a real My work page. Optional, so it never blocks a stage."""
        if p.status != "active" or not p.active_keys:
            return
        key = p.active_keys[0]
        pool = CALM_MID if self.calm else MID
        due, steps = STEPS[pool[self.k % len(pool)]]
        title, desc = OVERSIGHT_PM[self.k % len(OVERSIGHT_PM)]
        self.task("director", p, key, title, "project_manager", due, steps, required=False, desc=desc)
        if p.critical_blocker or self.k % 5 == 0:
            due, steps = STEPS[("week", "waiting", "today", "upcoming")[self.k % 4]]
            title, desc = OVERSIGHT_DIRECTOR[self.k % 2]
            self.task("project_manager", p, key, title, "director", due, steps, required=False, desc=desc)
        self.k += 1

    def drive(self, spec):
        spec = dict(spec)
        at, lanes, state, status = spec.pop("at"), spec.pop("lanes", {}), spec.pop("state", "work"), spec.pop("status", None)
        days, blocker, reject_at = spec.pop("age"), spec.pop("blocker", ""), spec.pop("reject_at", None)
        sub_in, launch_in = spec.pop("sub_in", None), spec.pop("launch_in", None)
        self.calm, self.mfr, self.want_rfi = spec.pop("calm", False), spec.pop("mfr", "Zenith Pharma Pvt Ltd"), spec.pop("rfi", False)
        today = date.today()
        spec_product = spec.get("product", "")
        reopen = spec.pop("reopen", False)
        initiator = spec.pop("initiator", "Amit Verma")
        p = engine.create_project(self.db, self.R["project_manager"], sc.ProjectCreate(
            **spec, market="Australia", initiator=initiator,
            target_submission=today + timedelta(days=sub_in) if sub_in is not None else None,
            target_launch=today + timedelta(days=launch_in) if launch_in is not None else None))
        engine.update_project(self.db, self.R["project_manager"], p, sc.ProjectUpdate(
            potential_client=CLIENTS[p.id % len(CLIENTS)], opportunity_value=float(150000 + (p.id * 97531) % 2200000),
            formulation=spec_product, commercial_expectations="Gross margin above 35% at the target shelf price; first-year volume agreed with the client.",
            manufacturer_info=self.mfr + ", India (TGA GMP clearance held)",
            regulatory_route=p.submission_type or "To be decided with Regulatory",
            stakeholders="Rajiv Kapoor (Director), Amit Verma (Commercial), Priya Sharma (Project Manager)"))
        plan = self.plan(p, at, lanes, state)
        for key in [s.key for s in p.flow.stages]:
            if key in plan:
                self.run_stage(p, key, plan[key], finish=key != reject_at)
        if blocker:
            p.critical_blocker = blocker
        self.db.commit()
        self.oversight(p)
        if reject_at:
            worker, approver = LANE[reject_at]
            self.act(p, worker, "submit", reject_at)
            self.act(p, approver, "reject", reject_at, "Landed cost leaves less than 20% margin at the target shelf price; revisit next financial year.")
        if reopen:
            t = next((x for x in p.tasks if x.state == "approved" and x.required), None)
            if t:
                extras.request_reopen(self.db, self.R[t.assignee.role_key], p, "task", t.id,
                                      "The pack size changed after approval; the cost model needs the new figure.")
        if status == "on_hold":
            self.act(p, "project_manager", "hold", note="Waiting for the manufacturer to confirm capacity on the fill line.")
        self.age(p, days)
        return p

    # ---- spread a project's history over its lifetime so ages, waits and dates look real
    def age(self, p, days, stage_days=3):
        start = self.now - timedelta(days=days)
        p.created_at = start
        evs = sorted(p.events, key=lambda e: e.id)
        step = (days * 86400) / (len(evs) + 1)
        for i, e in enumerate(evs):
            e.created_at = start + timedelta(seconds=step * (i + 1))
        decided = {e.stage_key: e.created_at for e in evs if e.area == "stage" and e.action in ("approve", "bypass")}
        flow = p.flow
        for r in p.stages:
            if r.state == "pending":
                continue
            reqs = flow.stage(r.stage_key).requires
            r.started_at = max((decided[x] for x in reqs if x in decided), default=start)
            if r.stage_key in decided:
                r.decided_at = decided[r.stage_key]
            if r.state in ("in_progress", "awaiting_approval"):
                r.started_at = self.now - timedelta(days=stage_days)
            if r.state == "awaiting_approval":
                r.submitted_at = self.now - timedelta(days=2)
        by_task: dict[int, list] = {}
        for e in evs:
            if e.task_id:
                by_task.setdefault(e.task_id, []).append(e.created_at)
        for t in p.tasks:
            if t.id in by_task:
                t.created_at, t.updated_at = min(by_task[t.id]), max(by_task[t.id])
        self.db.commit()

    def build(self):
        for spec in PORTFOLIO:
            self.drive(spec)


def spec(**kw):
    return kw


PORTFOLIO = [
    # --- the example in the brief: five lanes at the same time, each in its own state
    spec(name="NEO Allergy Relief Tablets", product="Loratadine 10 mg tablets, 30 pack", category="Respiratory & allergy",
         submission_type="Registered medicine – abridged / generic (AUST R)", initiator="Neo Health Australia team",
         summary="Raised by Neo Health Australia for ABC Pharmacy: non-drowsy allergy tablets for a March 2027 launch. Product route: new development.",
         at="parallel", lanes=dict(commercial="returned", legal="mid", regulatory="nearly", artwork="nearly", manufacturer="nearly"),
         age=41, sub_in=10, launch_in=148),
    spec(name="Ibuprofen Gel 5% – Topical Pain Relief", product="Ibuprofen 5% gel, 50 g tube", category="Pain relief",
         submission_type="Registered medicine – abridged / generic (AUST R)", summary="Generic OTC ibuprofen gel for Australia, made in India.",
         at="parallel", lanes=dict(commercial="done", legal="late", regulatory="mid", artwork="late", manufacturer="early"),
         age=55, sub_in=45, launch_in=300, blocker="Excipient supplier has not confirmed the lot COA"),
    spec(name="Lactulose Oral Solution", product="Lactulose 3.34 g/5 mL oral solution, 500 mL", category="Gastro & bowel care",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Medisynth Labs", summary="Gentle osmotic laxative for constipation.",
         at="parallel", lanes=dict(commercial="review", legal="mid", regulatory="early", artwork="mid", manufacturer="late"),
         age=30, sub_in=55, launch_in=240),
    spec(name="Clotrimazole 1% Cream", product="Clotrimazole 1% cream, 20 g tube", category="Skin care",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Aurora Lifesciences", summary="Broad-spectrum antifungal for tinea and thrush.",
         at="parallel", lanes=dict(commercial="done", legal="late", regulatory="late", artwork="mid", manufacturer="late"),
         age=48, sub_in=20, launch_in=200, blocker="API supplier lost its GMP certificate; a second source needs qualifying"),
    spec(name="Ear Wax Removal Drops", product="Carbamide peroxide 6.5% ear drops, 15 mL", category="Ear & throat care",
         submission_type="Listed medicine (AUST L)", summary="Softens and removes ear wax at home.", calm=True,
         at="parallel", lanes=dict(commercial="mid", legal="early", regulatory="early", artwork="early", manufacturer="early"),
         age=12, sub_in=120, launch_in=300),
    spec(name="Eye Drops – Lubricant", product="Preservative-free lubricant eye drops, 10 mL", category="Eye care",
         submission_type="Registered medicine – full dossier (AUST R)", mfr="Sterifill Pharma", summary="Preservative-free lubricant eye drops in a multi-dose pack.",
         at="parallel", lanes=dict(commercial="done", legal="mid", regulatory="mid", artwork="early", manufacturer="mid"),
         status="on_hold", age=58, sub_in=90, launch_in=280),
    spec(name="Terbinafine Nail Solution", product="Terbinafine 10 mg/g film-forming solution, 4 mL", category="Nail care",
         submission_type="Registered medicine – full dossier (AUST R)", summary="Once-weekly antifungal nail solution.",
         at="parallel", lanes=dict(commercial="done", legal="early", regulatory="mid", artwork="early", manufacturer="mid"),
         status="on_hold", age=80, sub_in=100, launch_in=320),
    spec(name="Loperamide 2 mg Capsules", product="Loperamide 2 mg capsules, 12 pack", category="Gastro & bowel care",
         submission_type="Registered medicine – abridged / generic (AUST R)", summary="Fast relief of acute diarrhoea.",
         at="parallel", lanes=dict(commercial="review", legal="early", regulatory="early", artwork="early", manufacturer="early"),
         reject_at="commercial", age=40),
    # --- before the lanes open
    spec(name="Throat Lozenge – Honey & Lemon", product="Honey & lemon lozenges, pack of 24", category="Ear & throat care",
         initiator="Amit Verma", summary="Soothing lozenge range extension for the cold and flu season.", at="opportunity", state="mid", calm=True,
         age=6, launch_in=330),
    spec(name="Dextromethorphan Cough Syrup", product="Dextromethorphan 15 mg/5 mL syrup, 200 mL", category="Respiratory & allergy",
         summary="Dry cough relief for adults and children over 12.", at="opportunity", state="review", calm=True, age=4, launch_in=400),
    spec(name="Medicated Nail Lacquer", product="Antifungal nail lacquer 5%", category="Nail care",
         summary="Antifungal nail lacquer for onychomycosis.", at="opportunity", state="review", reject_at="opportunity", age=33),
    spec(name="Peppermint Oil IBS Capsules", product="Enteric-coated peppermint oil 187 mg, 45 capsules", category="Gastro & bowel care",
         submission_type="Listed medicine (AUST L)", summary="Relief of abdominal cramping and bloating associated with IBS.",
         at="brief", state="work", calm=True, age=15, sub_in=150, launch_in=360),
    # --- after the lanes have joined
    spec(name="Cetirizine Oral Liquid for Kids", product="Cetirizine 1 mg/mL oral liquid, 100 mL", category="Respiratory & allergy",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Aurora Lifesciences",
         summary="Sugar-free antihistamine liquid for children aged 2 and over.", at="dossier_ready", state="mid", calm=True, age=110, sub_in=12, launch_in=180),
    spec(name="Saline Nasal Spray – Hypertonic (v2)", product="Hypertonic saline 3% nasal spray, 30 mL", project_type="In-Licence", category="Nasal care",
         submission_type="Listed medicine (AUST L)", mfr="Medisynth Labs", summary="In-licence of a hypertonic saline nasal spray to refresh the nasal range.",
         at="submission", state="nearly", calm=True, age=96, sub_in=5, launch_in=150),
    spec(name="Electrolyte Hydration Sachets", product="Oral rehydration sachets, 3 flavours", category="Hydration",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Coastal Nutraceuticals", summary="Oral rehydration sachets in three flavours.",
         at="rfi", state="mid", age=120, sub_in=-50, launch_in=200),
    spec(name="Benzydamine Throat Spray", product="Benzydamine 0.15% throat spray, 30 mL", category="Ear & throat care",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Medisynth Labs", summary="Anti-inflammatory throat spray for sore throats.",
         at="rfi", state="nearly", calm=True, age=140, sub_in=-35, launch_in=130),
    spec(name="Paracetamol 500 mg Tablets", product="Paracetamol 500 mg film-coated tablets, 20 and 100 packs", category="Pain relief",
         submission_type="Registered medicine – abridged / generic (AUST R)", rfi=True, summary="Generic paracetamol tablets to complete the Neo pain range.",
         at="approval", state="review", calm=True, age=230, sub_in=-110, launch_in=60, reopen=True),
    spec(name="Sodium Chloride Eye Wash", product="Sterile eye wash, 100 mL with eye cup", category="Eye care",
         submission_type="Listed medicine (AUST L)", mfr="Sterifill Pharma", summary="Sterile eye wash for irritation and foreign bodies.",
         at="readiness", state="mid", calm=True, age=210, sub_in=-90, launch_in=25),
    spec(name="Vitamin D3 Gummies", product="Vitamin D3 1000 IU gummies, 60 pack", category="Vitamins", submission_type="Listed medicine (AUST L)",
         mfr="Coastal Nutraceuticals", summary="Chewable vitamin D3 for adults.", at="manufacturing", state="mid", calm=True, age=190, sub_in=-80, launch_in=40),
    spec(name="Oxymetazoline Nasal Spray", product="Oxymetazoline 0.05% nasal spray, 15 mL", category="Nasal care",
         submission_type="Variation to a registered medicine", mfr="Sterifill Pharma", summary="Pack size variation for the 12-hour decongestant spray.",
         at="manufacturing", state="nearly", calm=True, age=170, sub_in=-75, launch_in=35),
    spec(name="Hydrocortisone 1% Cream", product="Hydrocortisone 1% cream, 30 g tube", category="Skin care",
         submission_type="Registered medicine – abridged / generic (AUST R)", rfi=True, summary="Short-term relief of itch and inflammation.",
         at="dispatch", state="mid", calm=True, age=250, sub_in=-140, launch_in=14),
    # --- finished: everything stays available in the project history
    spec(name="Magnesium Sleep Spray", product="Magnesium chloride spray, 100 mL", category="Sleep", submission_type="Listed medicine (AUST L)",
         mfr="Coastal Nutraceuticals", summary="Listed topical magnesium spray.", at="completed", age=260, sub_in=-150, launch_in=-40),
    spec(name="Kids Oral Rehydration Ice Blocks", product="Oral rehydration ice blocks, 16 x 62.5 mL", category="Hydration", submission_type="Listed medicine (AUST L)",
         mfr="Coastal Nutraceuticals", rfi=True, summary="Fruit-flavoured rehydration ice blocks for children.", at="completed", age=300, sub_in=-200, launch_in=-60),
]
