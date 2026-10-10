"""Reference data (roles, settings, a first Super Admin) and an optional demo portfolio.
The demo is built by driving the real services, so every project carries a genuine audit trail."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as sc
from . import workflow
from .models import Project, Role, Setting, User
from .services import common, engine, modules, tasks, workflows


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


PEOPLE = [  # name, role, country
    ("Sarah Mitchell", "super_admin", "AU"), ("Tom Gallagher", "director", "AU"), ("Dr. Anil Rao", "director", "IN"),
    ("Priya Nair", "project_manager", "IN"), ("Liam Carter", "project_manager", "AU"), ("Emma Wilson", "commercial", "AU"),
    ("Rohan Mehta", "regulatory", "IN"), ("Jessica Lee", "regulatory", "AU"), ("Kavita Shah", "legal", "IN"),
    ("Arjun Patel", "artwork", "IN"), ("Neha Kulkarni", "technical", "IN"),
    ("Client Reviewer", "reviewer", "Partner"),
]


def seed_demo(db: Session):
    if db.scalar(select(Project.id).limit(1)):
        return
    for u in db.scalars(select(User).where(User.name == "Administrator")):
        u.active = False  # replaced by the demo people below
    for name, role, country in PEOPLE:
        db.add(User(name=name, email=f"{name.split()[-1].lower()}@neo.example", role_key=role, country=country))
    db.commit()
    admin = db.scalar(select(User).where(User.name == "Sarah Mitchell"))
    if not workflows.current(db):
        live = workflows.create_draft(db, admin, "Neo standard process",
                                      "Legal, Regulatory, Artwork and Manufacturer data start together once Commercial is approved.",
                                      preset="after_commercial")
        workflows.publish(db, admin, live)
    alt = workflows.create_draft(db, admin, "Option B: parallel from the Project Brief",
                                 "Everything except Commercial starts as soon as the Brief is approved. Shared for client feedback.",
                                 preset="from_brief")
    reviewer = db.scalar(select(User).where(User.name == "Client Reviewer"))
    workflows.add_feedback(db, reviewer, alt, "commercial", "We would prefer Commercial approval to stay a gate before any legal spend.")
    workflows.add_feedback(db, reviewer, alt, "", "Please confirm artwork starting before the dossier is ready suits the team.")
    Demo(db).build()


class Demo:
    def __init__(self, db: Session):
        self.db = db
        self.now = datetime.now(timezone.utc)
        self.u = {u.name.split()[0].replace("Dr.", "Anil"): u for u in db.scalars(select(User))}

    # ---- helpers
    def project(self, by, **kw) -> Project:
        return engine.create_project(self.db, by, sc.ProjectCreate(**kw))

    def act(self, p, who, action, stage_key=None, note="", to_stage=None):
        return engine.apply_action(self.db, who, p, sc.ActionIn(action=action, stage_key=stage_key, note=note, to_stage=to_stage))

    def done(self, p, key, submit_by="Priya", approve_by="Tom", note=""):
        """Run a stage through submit + approve, skipping the module guards (used to fast-forward the demo)."""
        row = p.row(key)
        flow = p.flow
        if row.state == "pending":
            return
        common.log(p, self.u[submit_by], "stage", "submit", note, key)
        common.log(p, self.u[approve_by], "stage", "approve", "", key)
        row.state, row.decided_at = "approved", common.now()
        if "issue_code" in flow.stage(key).features and not p.code:
            p.code = engine._next_code(self.db, p.created_at.year)
        engine._unlock(p)
        engine._sync(p)
        if all(r.state in workflow.SATISFIED for r in p.stages):
            p.status = "completed"
            for r in p.stages:
                r.locked = True
        self.db.commit()

    def through(self, p, *keys):
        for k in keys:
            self.done(p, k)

    def task(self, creator, p, stage, title, assignee, due_days, steps=(), required=True, desc=""):
        t = tasks.create_task(self.db, self.u[creator], p, stage, title, desc, self.u[assignee].id,
                              self.now + timedelta(days=due_days), required)
        for who, action, *rest in steps:
            kw = {"note": rest[0]} if rest else {}
            if len(rest) > 1:
                kw["due_at"] = self.now + timedelta(days=rest[1])
            tasks.apply_action(self.db, self.u[who], t, sc.TaskActionIn(action=action, **kw))
        return t

    def age(self, p, days, stage_days: dict | None = None):
        """Spread the audit trail over `days` and backdate when the active stages started."""
        start = self.now - timedelta(days=days)
        p.created_at = start
        evs = sorted(p.events, key=lambda e: e.id)
        step = (days * 86400) / max(1, len(evs))
        for i, e in enumerate(evs):
            e.created_at = start + timedelta(seconds=step * i)
        for r in p.stages:
            if r.state in ("in_progress", "awaiting_approval"):
                r.started_at = self.now - timedelta(days=(stage_days or {}).get(r.stage_key, 2))
        self.db.commit()

    # ---- the portfolio
    def build(self):
        d = self.db
        today = date.today()
        U = self.u

        # 1. Ibuprofen Gel: five workstreams running in parallel (the Project 360 showcase)
        a = self.project(U["Priya"], name="Ibuprofen Gel 5% – Topical Pain Relief", product="Ibuprofen 5% gel, 50 g tube",
                         category="Pain relief", initiator="Tom Gallagher", market="Australia",
                         submission_type="Registered medicine – abridged / generic (AUST R)",
                         summary="Generic OTC ibuprofen gel for the Australian market, manufactured in India.",
                         target_submission=today + timedelta(days=75), target_launch=today + timedelta(days=300))
        self.through(a, "opportunity", "brief")
        self.task("Tom", a, "commercial", "Complete FMEA risk analysis", "Emma", 3, [("Emma", "accept"), ("Emma", "start")])
        self.task("Tom", a, "commercial", "Finalise cost model", "Emma", -2, [("Emma", "accept"), ("Emma", "start"),
                  ("Emma", "request_date", "Waiting on the supplier's final quote", 4)])
        modules.create_document(d, U["Emma"], a, sc.DocumentCreate(stage_key="commercial", kind="Feasibility / FMEA", title="Feasibility report", link="https://example.com/docs/feasibility"))
        self.through(a, "commercial")
        ag = {x.kind: x for x in a.agreements}
        ag["supplier"].status, ag["supplier"].signed_date, ag["supplier"].counterparty = "signed", today - timedelta(days=9), "Zenith Pharma Pvt Ltd"
        ag["quality"].status, ag["quality"].counterparty, ag["quality"].owner_id = "in_review", "Zenith Pharma Pvt Ltd", U["Kavita"].id
        ag["pv"].status, ag["pv"].counterparty, ag["pv"].owner_id = "drafting", "Zenith Pharma Pvt Ltd", U["Kavita"].id
        ag["supplier"].due_date, ag["quality"].due_date, ag["pv"].due_date = today - timedelta(days=9), today + timedelta(days=12), today + timedelta(days=20)
        modules.create_agreement(d, U["Kavita"], a, sc.AgreementCreate(kind="nda", counterparty="Zenith Pharma Pvt Ltd", owner_id=U["Kavita"].id))
        a.agreements[-1].status = "signed"
        a.agreements[-1].signed_date = today - timedelta(days=30)
        items = {i.title: i for i in a.dossier_items}
        for t, s in (("Administrative information", "ready"), ("Summaries / overviews", "draft"), ("Quality", "draft"), ("Clinical / bioequivalence", "missing")):
            items[t].status = s
        self.task("Kavita", a, "legal", "Draft PV agreement", "Kavita", 5, [("Kavita", "accept"), ("Kavita", "start")])
        self.task("Rohan", a, "regulatory", "Compile Module 3 (Quality)", "Rohan", 6, [("Rohan", "accept"), ("Rohan", "start")])
        t = self.task("Priya", a, "regulatory", "Bioequivalence study report", "Jessica", 8, [("Jessica", "accept"), ("Jessica", "start"), ("Jessica", "submit")])
        tasks.apply_action(d, U["Priya"], t, sc.TaskActionIn(action="request_changes", note="Add the dissolution profile tables"))
        # artwork: three documents at different points of the review
        carton = modules.create_document(d, U["Arjun"], a, sc.DocumentCreate(artwork=True, kind="Carton", title="Ibuprofen Gel 50 g carton", link="https://example.com/artwork/carton-v1"))
        modules.document_action(d, U["Arjun"], carton, "submit", "")
        modules.document_action(d, U["Rohan"], carton, "return", "Warning statement size is below the minimum")
        modules.add_version(d, U["Arjun"], carton, sc.VersionIn(link="https://example.com/artwork/carton-v2", note="Enlarged warning statement"))
        modules.document_action(d, U["Arjun"], carton, "submit", "")
        label = modules.create_document(d, U["Arjun"], a, sc.DocumentCreate(artwork=True, kind="Label", title="Tube label", link="https://example.com/artwork/label-v1"))
        leaflet = modules.create_document(d, U["Arjun"], a, sc.DocumentCreate(artwork=True, kind="Leaflet / insert", title="Consumer leaflet", link="https://example.com/artwork/leaflet-v1"))
        modules.document_action(d, U["Arjun"], leaflet, "submit", "")
        modules.document_action(d, U["Rohan"], leaflet, "approve", "")
        modules.document_action(d, U["Tom"], leaflet, "approve", "")
        proof = modules.create_document(d, U["Arjun"], a, sc.DocumentCreate(artwork=True, kind="Print proof", title="Carton print proof", link="https://example.com/artwork/proof-v1"))
        modules.document_action(d, U["Arjun"], proof, "submit", "")
        modules.document_action(d, U["Rohan"], proof, "approve", "")
        shade = modules.create_document(d, U["Arjun"], a, sc.DocumentCreate(artwork=True, kind="Shade card", title="Pantone shade card", link="https://example.com/artwork/shade-v1"))
        modules.document_action(d, U["Arjun"], shade, "submit", "")
        modules.document_action(d, U["Rohan"], shade, "return", "Green is too light against the approved reference")
        # manufacturer data
        for kind, status in (("coa", "received"), ("msds", "requested"), ("stability", "requested"), ("specification", "accepted")):
            m = modules.create_mfr(d, U["Neha"], a, sc.MfrCreate(kind=kind, manufacturer="Zenith Pharma Pvt Ltd", due_date=today + timedelta(days=-3 if kind == "msds" else 14)))
            m.status = status
            m.link = "https://example.com/mfr/" + kind if status in ("received", "accepted") else ""
        a.critical_blocker = "Excipient supplier has not confirmed the lot COA"
        d.commit()
        self.age(a, 41, {"commercial": 12, "legal": 12, "regulatory": 12, "artwork": 12, "manufacturer": 12})

        # 2. Saline Nasal Spray: at Regulatory Submission
        b = self.project(U["Liam"], name="Saline Nasal Spray – Hypertonic (v2)", product="Hypertonic saline 3% nasal spray", project_type="In-Licence",
                         category="Nasal care", initiator="Tom Gallagher", submission_type="Listed medicine (AUST L)",
                         summary="In-licence of a hypertonic saline nasal spray.", target_submission=today + timedelta(days=10),
                         target_launch=today + timedelta(days=150))
        self.through(b, "opportunity", "brief", "commercial", "legal", "regulatory", "artwork", "manufacturer", "dossier_ready")
        modules.record_submission(d, U["Rohan"], b, sc.SubmissionIn(reference="TGA-LST-48213", submitted_on=today - timedelta(days=3), notes="Submitted via the configured platform"))
        self.task("Rohan", b, "submission", "Confirm submission acknowledgement", "Jessica", 2, [("Jessica", "accept"), ("Jessica", "start")])
        self.age(b, 96, {"submission": 3})

        # 3. Electrolyte sachets: in RFI / Changes with an open TGA case
        c = self.project(U["Priya"], name="Electrolyte Hydration Sachets", product="Oral rehydration sachets, 3 flavours", category="Hydration",
                         initiator="Priya Nair", submission_type="Registered medicine – abridged / generic (AUST R)",
                         summary="Oral rehydration sachets, three flavours.", target_launch=today + timedelta(days=200))
        self.through(c, "opportunity", "brief", "commercial", "legal", "regulatory", "artwork", "manufacturer", "dossier_ready", "submission")
        modules.record_submission(d, U["Rohan"], c, sc.SubmissionIn(reference="TGA-REG-77120", submitted_on=today - timedelta(days=50)))
        r = modules.create_rfi(d, U["Rohan"], c, sc.RFICreate(authority="TGA", reference="RFI-2026-114", summary="Questions on the stability data and the flavour excipients",
                                                                received_on=today - timedelta(days=12), due_date=today + timedelta(days=9)))
        due = self.now + timedelta(days=5)
        q1 = modules.add_rfi_question(d, U["Rohan"], r, sc.RFIQuestionCreate(question="Provide 24-month real-time stability data for the lemon flavour.", assignee_id=U["Neha"].id, due_at=due))
        q2 = modules.add_rfi_question(d, U["Rohan"], r, sc.RFIQuestionCreate(question="Justify the sweetener level against the permitted ingredients list.", assignee_id=U["Jessica"].id, due_at=self.now + timedelta(days=3)))
        q3 = modules.add_rfi_question(d, U["Rohan"], r, sc.RFIQuestionCreate(question="Confirm the shelf-life statement on the carton.", assignee_id=U["Arjun"].id, due_at=self.now - timedelta(days=1)))
        for q, steps in ((q1, ["accept", "start", "submit", "approve"]), (q2, ["accept", "start", "submit"]), (q3, ["accept"])):
            for s in steps:
                who = U["Rohan"] if s == "approve" else q.task.assignee
                tasks.apply_action(d, who, q.task, sc.TaskActionIn(action=s))
        q1.response, q1.evidence_link = "Data attached: 24 months at 25°C / 60% RH, all within specification.", "https://example.com/evidence/stability-24m"
        d.commit()
        self.age(c, 120, {"rfi": 12})

        # 4. Nail lacquer: rejected at Feasibility & Commercial
        e = self.project(U["Liam"], name="Medicated Nail Lacquer", product="Antifungal nail lacquer 5%", category="Dermatology", initiator="Emma Wilson",
                         summary="Antifungal nail lacquer for onychomycosis.")
        self.through(e, "opportunity", "brief")
        self.act(e, U["Emma"], "submit", "commercial")
        self.act(e, U["Tom"], "reject", "commercial", "Margins too thin against the current import cost; revisit next year.")
        self.age(e, 33)

        # 5. Eye drops: on hold during parallel work
        f = self.project(U["Priya"], name="Eye Drops – Lubricant", product="Lubricant eye drops 10 mL", category="Eye care", initiator="Tom Gallagher",
                         submission_type="Registered medicine – full dossier (AUST R)", summary="Preservative-free lubricant eye drops.")
        self.through(f, "opportunity", "brief", "commercial")
        self.act(f, U["Priya"], "hold", note="Waiting for the manufacturer to confirm the sterile fill line.")
        self.age(f, 58, {"commercial": 20, "legal": 20, "regulatory": 20, "artwork": 20, "manufacturer": 20})

        # 6. Throat lozenge: just started
        g = self.project(U["Liam"], name="Throat Lozenge – Honey & Lemon", product="Honey & lemon lozenges, pack of 24", category="Cold & flu",
                         initiator="Emma Wilson", summary="Soothing lozenge range extension.", target_launch=today + timedelta(days=330))
        self.task("Liam", g, "opportunity", "Screen the opportunity against the portfolio criteria", "Emma", 4, [("Emma", "accept")])
        self.age(g, 6, {"opportunity": 6})

        # 7. Vitamin D3 gummies: at Manufacturing
        h = self.project(U["Liam"], name="Vitamin D3 Gummies", product="Vitamin D3 1000 IU gummies, 60 pack", category="Vitamins", initiator="Emma Wilson",
                         submission_type="Listed medicine (AUST L)", summary="Chewable vitamin D3 for adults.", target_launch=today + timedelta(days=40))
        self.through(h, "opportunity", "brief", "commercial", "legal", "regulatory", "artwork", "manufacturer", "dossier_ready", "submission", "rfi", "approval", "readiness")
        self.task("Neha", h, "manufacturing", "Confirm batch 1 manufacturing slot", "Neha", 7, [("Neha", "accept"), ("Neha", "start")])
        self.age(h, 190, {"manufacturing": 10})

        # 8. Completed
        i = self.project(U["Priya"], name="Magnesium Sleep Spray", product="Magnesium spray 100 mL", category="Sleep", initiator="Tom Gallagher",
                         submission_type="Listed medicine (AUST L)", summary="Listed topical magnesium spray.")
        self.through(i, *[s.key for s in i.flow.stages])
        self.age(i, 260)
        d.commit()
