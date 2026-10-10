"""Reference data (roles, settings, a first Super Admin) and an optional demo portfolio.
The demo is built by driving the real services, so every project carries a genuine audit trail."""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as sc
from . import workflow
from .models import Agreement, DossierItem, ManufacturerRequest, Notification, Project, Role, Setting, User
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
    ("Olivia Brown", "project_manager", "AU"), ("Chloe Martin", "commercial", "AU"), ("Sanjay Gupta", "regulatory", "IN"),
    ("Ravi Kumar", "legal", "IN"), ("Meera Iyer", "artwork", "IN"), ("Vikram Singh", "technical", "IN"),
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
    # an inbox that looks lived in: older notifications already read, the newest few still unread
    now = datetime.now(timezone.utc)
    per_user: dict[int, int] = {}
    for n in db.scalars(select(Notification).order_by(Notification.id.desc())):
        i = per_user[n.user_id] = per_user.get(n.user_id, 0) + 1
        n.created_at = now - timedelta(hours=3 * i + n.id % 3)
        n.read = i > 6
    db.commit()


class Demo:
    def __init__(self, db: Session):
        self.db = db
        self.now = datetime.now(timezone.utc)
        self.u = {u.name.split()[0].replace("Dr.", "Anil"): u for u in db.scalars(select(User))}
        self.k, self.pm, self.mfr = 0, "Priya", "Zenith Pharma Pvt Ltd"

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
        due = (datetime.combine(date.today(), time(23, 59), tzinfo=timezone.utc) if due_days == "today"
               else self.now + timedelta(days=due_days))
        t = tasks.create_task(self.db, self.u[creator], p, stage, title, desc, self.u[assignee].id, due, required)
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

        d.commit()
        self.portfolio()

    # ================================================================ the wider portfolio
    # Every other project is built by walking its workflow stage by stage: finished stages get complete records
    # (signed agreements, reviewed dossier, accepted manufacturer data, approved documents and tasks), the stages
    # a project is sitting in get work in every state, so each page and each My work group has something to show.

    def portfolio(self):
        today = date.today()
        for spec in PORTFOLIO:
            spec = dict(spec)
            pm, at, mfr = spec.pop("pm"), spec.pop("at"), spec.pop("mfr", "Zenith Pharma Pvt Ltd")
            status, days, blocker = spec.pop("status", None), spec.pop("age"), spec.pop("blocker", "")
            waiting, sub_in, launch_in = spec.pop("awaiting", ()), spec.pop("sub_in", None), spec.pop("launch_in", None)
            self.calm = spec.pop("calm", False)  # on-track projects: no late or returned work
            spec.setdefault("initiator", "Tom Gallagher")
            if sub_in is not None:
                spec["target_submission"] = today + timedelta(days=sub_in)
            if launch_in is not None:
                spec["target_launch"] = today + timedelta(days=launch_in)
            p = self.project(self.u[pm], project_manager_id=self.u[pm].id, **spec)
            self.pm, self.mfr = pm, mfr
            self.walk(p, at, rejecting=status == "rejected", waiting=waiting)
            if status == "on_hold":
                self.act(p, self.u[pm], "hold", note="Waiting for the manufacturer to confirm capacity on the fill line.")
            elif status == "rejected":
                k = at[0]
                self.act(p, self.u[self.team(k)[0]], "submit", k)
                self.act(p, self.u["Tom"], "reject", k, "Landed cost leaves less than 20% margin at the target shelf price; revisit next financial year.")
            if blocker:
                p.critical_blocker = blocker
            self.db.commit()
            self.age(p, days, {k: max(2, min(days - 1, 4 + 3 * i)) for i, k in enumerate(at or [])})

    # ---- who works where
    def team(self, key):
        return TEAMS[STAGE_TEAM[key]] if STAGE_TEAM.get(key) else [x for x in ("Priya", "Liam", "Olivia") if x != self.pm]

    def lead(self, key):
        return {"commercial": "Emma", "legal": "Kavita", "regulatory": "Rohan", "artwork": "Rohan", "manufacturer": "Neha",
                "manufacturing": "Neha", "dispatch": "Neha"}.get(key)

    def director(self, key):
        return "Anil" if key in IN_STAGES else "Tom"

    def walk(self, p, at, rejecting=False, waiting=()):
        order = [s.key for s in p.flow.stages]
        at = list(at or [])
        last = max(order.index(k) for k in at) if at else len(order) - 1
        for k in order[: last + 1]:
            if k in at:
                full = rejecting or k in waiting
                self.fill(p, k, full)
                if k in waiting:
                    self.act(p, self.u[self.team(k)[0]], "submit", k)
            else:
                self.fill(p, k, True)
                self.done(p, k, submit_by=self.team(k)[0], approve_by=self.director(k))

    # ---- tasks
    def stage_tasks(self, p, key, full):
        titles = TASKS[key]
        people = self.team(key)
        if full:
            for i, (title, desc) in enumerate(titles[:2]):
                who = people[(self.k + i) % len(people)]
                self.task(self.pm, p, key, title, who, -20 - i * 6, [(who, "accept"), (who, "start"), (who, "submit"), (self.pm, "approve")], desc=desc)
            self.k += 1
            return
        for i, (title, desc) in enumerate(titles):
            who = people[(self.k + i) % len(people)]
            lead = self.lead(key)
            creator = lead if lead and lead != who and (self.k + i) % 2 else self.pm
            if creator == who:
                creator = self.pm
            pool = [v for j, v in enumerate(VARIANTS) if j in CALM] if self.calm else VARIANTS
            due, steps = pool[(self.k + i) % len(pool)]
            steps = [(creator if s[0] == "@by" else who, *s[1:]) for s in steps]
            self.task(creator, p, key, title, who, due, steps, desc=desc)
        # directors and project managers carry work of their own too
        name, boss = p.flow.stage(key).name, "Tom" if self.k % 4 < 2 else self.director(key)
        due, steps = pool[(self.k + 5) % len(pool)]
        if self.k % 2:
            steps = [(boss if s[0] == "@by" else self.pm, *s[1:]) for s in steps]
            self.task(boss, p, key, f"Update the {name} plan and risk log", self.pm, due, steps,
                      desc="Refresh the dates, owners and top three risks before the weekly portfolio review.")
        else:
            steps = [(self.pm if s[0] == "@by" else boss, *s[1:]) for s in steps]
            self.task(self.pm, p, key, f"Director review of the {name} pack", boss, due, steps,
                      desc="Read the summary pack and record the decision and any conditions.")
        self.k += 1

    # ---- stage records
    def fill(self, p, key, full):
        d, U, today = self.db, self.u, date.today()
        pm = U[self.pm]
        self.stage_tasks(p, key, full)
        for kind, title in STAGE_DOCS.get(key, ()):
            slug = title.lower().replace(" ", "-").replace("/", "")
            doc = modules.create_document(d, pm, p, sc.DocumentCreate(stage_key=key, kind=kind, title=title, owner_id=U[self.team(key)[0]].id,
                                                                      link=f"https://neo.sharepoint.example/{p.id}/{slug}-v1", note="First draft"))
            if full or self.k % 3 == 0:
                modules.document_action(d, pm, doc, "submit", "")
            if full:
                modules.document_action(d, self.approver(p, key), doc, "approve", "")
        getattr(self, "fill_" + key, lambda *a: None)(p, full, today)

    def approver(self, p, key):
        roles = p.flow.stage(key).approver_roles
        if "director" in roles:
            return self.u[self.director(key)]
        return next(u for u in self.u.values() if u.role_key in roles and u.can("approve"))

    def fill_legal(self, p, full, today):
        modules.ensure_core_agreements(p)
        owners = TEAMS["legal"]
        partial = ["signed", "sent_for_signature", "in_review", "drafting", "changes_requested"]
        for i, a in enumerate(x for x in p.agreements if x.core):
            a.counterparty, a.owner_id = self.mfr, self.u[owners[i % 2]].id
            a.status = "signed" if full else partial[(self.k + i) % len(partial)]
            a.due_date = today + timedelta(days=(-30 + i * 4) if full else (-2 + i * 9))
            a.signed_date = a.due_date - timedelta(days=2) if a.status == "signed" else None
            a.link = f"https://neo.sharepoint.example/{p.id}/legal/{a.kind}-agreement" if a.status != "drafting" else ""
            a.notes = AGREEMENT_NOTES[a.kind] if a.status == "signed" else AGREEMENT_OPEN_NOTES[a.status]
        for kind, cp, note in (("nda", self.mfr, "Mutual NDA covering formulation and pricing."),
                               ("cda", "Brandwell Packaging Pty Ltd", "Covers the artwork files shared with the printer."),
                               ("poa", "Neo Health (OTC) Pty Ltd", "Authorises the sponsor's agent to sign TGA forms.")):
            signed = full or kind == "nda"
            p.agreements.append(Agreement(kind=kind, counterparty=cp, owner_id=self.u[owners[0]].id, notes=note,
                                          status="signed" if signed else "drafting", due_date=today - timedelta(days=40) if signed else today + timedelta(days=12),
                                          signed_date=today - timedelta(days=42) if signed else None,
                                          link=f"https://neo.sharepoint.example/{p.id}/legal/{kind}" if signed else ""))
            common.log(p, self.u[owners[0]], "legal", "created", f"{workflow.AGREEMENT_KINDS[kind]} added ({cp})", "legal")
        self.db.commit()

    def fill_regulatory(self, p, full, today):
        modules.ensure_dossier(p)
        p.dossier_items.append(DossierItem(title="GMP clearance evidence", required=True, status="missing"))
        p.dossier_items.append(DossierItem(title="Product information cross-check", required=False, status="missing"))
        partial = ["reviewed", "ready", "awaiting_approval", "draft", "changes_requested", "missing"]
        for i, it in enumerate(p.dossier_items):
            it.status = "reviewed" if full else partial[(self.k + i) % len(partial)]
            if it.status != "missing":
                it.link = f"https://neo.sharepoint.example/{p.id}/dossier/{(it.module or 'item').lower()}-{it.id or i}"
            it.notes = DOSSIER_NOTES.get(it.status, "")
        common.log(p, self.u["Rohan"], "dossier", "update", "Dossier checklist reviewed against the submission type", "regulatory")
        self.db.commit()

    def fill_artwork(self, p, full, today):
        d, U = self.db, self.u
        ra, dr = U[TEAMS["regulatory"][self.k % 3]], U["Tom"]
        designer = U[TEAMS["artwork"][self.k % 2]]
        plan = [("Carton", "Outer carton"), ("Label", "Primary label"), ("Leaflet / insert", "Consumer medicine leaflet"), ("Shade card", "Pantone shade card")]
        ends = ["approved", "director", "regulatory", "returned", "draft"]
        for i, (kind, title) in enumerate(plan):
            slug = kind.split()[0].lower()
            doc = modules.create_document(d, U[self.pm], p, sc.DocumentCreate(
                artwork=True, kind=kind, title=f"{title} – {p.product}"[:120], owner_id=designer.id,
                link=f"https://neo.sharepoint.example/{p.id}/artwork/{slug}-v1", note="Initial layout from the brand template"))
            end = "approved" if full else ends[(self.k + i) % len(ends)]
            if i == 0 or end == "returned":  # a real revision history
                modules.document_action(d, U[self.pm], doc, "submit", "")
                modules.document_action(d, ra, doc, "return", ARTWORK_RETURNS[i % len(ARTWORK_RETURNS)])
                modules.add_version(d, U[self.pm], doc, sc.VersionIn(link=f"https://neo.sharepoint.example/{p.id}/artwork/{slug}-v2", note="Updated after RA comments"))
                if end == "returned":
                    modules.document_action(d, U[self.pm], doc, "submit", "")
                    modules.document_action(d, ra, doc, "return", "Batch and expiry panel still overlaps the barcode")
                    continue
            if end == "draft":
                continue
            modules.document_action(d, U[self.pm], doc, "submit", "")
            if end == "regulatory":
                continue
            modules.document_action(d, ra, doc, "approve", "")
            if end == "director":
                continue
            modules.document_action(d, dr, doc, "approve", "")

    def fill_manufacturer(self, p, full, today):
        tech = TEAMS["technical"]
        partial = ["accepted", "under_review", "received", "requested", "changes_requested", "requested"]
        for i, kind in enumerate(("coa", "msds", "specification", "stability", "testing", "manufacturing")):
            st = "accepted" if full else partial[(self.k + i) % len(partial)]
            late = st == "requested" and i % 2
            m = ManufacturerRequest(kind=kind, manufacturer=self.mfr, required=kind != "manufacturing", status=st,
                                    requested_on=today - timedelta(days=35 if full else 20),
                                    due_date=today + timedelta(days=-25 if full else (-4 if late else 10 + i * 3)),
                                    received_on=today - timedelta(days=(28 if full else 6) - i) if st not in ("requested",) else None,
                                    link=f"https://neo.sharepoint.example/{p.id}/mfr/{kind}" if st != "requested" else "",
                                    notes=MFR_NOTES[kind] if st != "changes_requested" else "Missing the assay results for batch 3; resend the full report.",
                                    owner_id=self.u[tech[i % 2]].id)
            p.mfr_requests.append(m)
            common.log(p, self.u[tech[i % 2]], "manufacturer", "requested", f"{workflow.MFR_KINDS[kind]} requested from {self.mfr}", "manufacturer")
        self.db.commit()

    def fill_submission(self, p, full, today):
        ra = self.u[TEAMS["regulatory"][self.k % 3]]
        modules.record_submission(self.db, ra, p, sc.SubmissionIn(
            kind="variation" if p.submission_type.startswith("Variation") else "initial",
            reference=f"PM-2026-{self.k * 137 % 90000 + 10000:05d}-1", platform="TGA Business Services",
            submitted_on=p.target_submission if p.target_submission and p.target_submission <= today else today - timedelta(days=4),
            notes="Dossier lodged with the evaluation fee paid; acknowledgement letter filed under Correspondence."))

    def fill_rfi(self, p, full, today):
        d, U = self.db, self.u
        ra = U["Rohan"]
        r = modules.create_rfi(d, ra, p, sc.RFICreate(authority="TGA", reference=f"RFI-2026-{100 + self.k}",
                                                        summary=RFI_SUMMARIES[self.k % len(RFI_SUMMARIES)],
                                                        received_on=today - timedelta(days=45 if full else 10),
                                                        due_date=today + timedelta(days=-15 if full else 12)))
        people = ["Neha", "Jessica", "Arjun", "Sanjay"]
        for i, q in enumerate(RFI_QUESTIONS[: 3 if full else 4]):
            who = people[i]
            x = modules.add_rfi_question(d, ra, r, sc.RFIQuestionCreate(question=q, assignee_id=U[who].id, due_at=self.now + timedelta(days=(-20 if full else -1 + i * 3))))
            steps = ["accept", "start", "submit", "approve"] if full else [["accept", "start", "submit", "approve"], ["accept", "start", "submit"], ["accept", "start"], []][i]
            for s in steps:
                tasks.apply_action(d, ra if s == "approve" else U[who], x.task, sc.TaskActionIn(action=s))
            if "submit" in steps:
                x.response = RFI_ANSWERS[i]
                x.evidence_link = f"https://neo.sharepoint.example/{p.id}/rfi/q{i + 1}-evidence"
        d.commit()
        if full:
            r.response_link = f"https://neo.sharepoint.example/{p.id}/rfi/response-package"
            for a in ("ready", "submit"):
                modules.rfi_action(d, ra, r, a, "")
            modules.rfi_action(d, ra, r, "close", "TGA confirmed the response resolves all questions.")


IN_STAGES = {"legal", "regulatory", "artwork", "manufacturer", "dossier_ready", "submission", "rfi", "approval", "manufacturing", "dispatch"}
TEAMS = {"commercial": ["Emma", "Chloe"], "legal": ["Kavita", "Ravi"], "regulatory": ["Rohan", "Jessica", "Sanjay"],
         "artwork": ["Arjun", "Meera"], "technical": ["Neha", "Vikram"]}
STAGE_TEAM = {"opportunity": "commercial", "brief": "commercial", "commercial": "commercial", "legal": "legal", "regulatory": "regulatory",
              "artwork": "artwork", "manufacturer": "technical", "dossier_ready": "regulatory", "submission": "regulatory", "rfi": "regulatory",
              "approval": "regulatory", "readiness": "commercial", "manufacturing": "technical", "dispatch": "technical", "completion": None}

# (due in days, steps). "@by" is the person who assigned the task; otherwise the assignee acts.
VARIANTS = [
    (-3, [("", "accept"), ("", "start")]),                                                   # overdue
    ("today", [("", "accept"), ("", "start")]),                                                # due today
    (4, [("", "accept")]),                                                                   # due this week
    (6, [("", "accept"), ("", "start"), ("", "submit")]),                                    # waiting for a decision
    (5, [("", "accept"), ("", "start"), ("", "submit"), ("@by", "request_changes", "Please add the batch references and re-check the totals.")]),
    (-1, [("", "accept"), ("", "start"), ("", "request_date", "Waiting on the manufacturer's final data pack", 6)]),
    (21, [("", "accept")]),                                                                  # upcoming
    (2, [("", "accept"), ("", "start"), ("", "submit"), ("@by", "approve")]),                # done
    (9, []),                                                                                 # newly assigned
]
CALM = (2, 3, 6, 7, 8)

TASKS = {
    "opportunity": [("Screen against the portfolio criteria", "Score the idea on market size, margin, regulatory route and fit with the Neo range."),
                    ("Market sizing and competitor scan", "IQVIA pharmacy sales for the last 12 months plus the top five competing SKUs."),
                    ("Shortlist candidate manufacturers", "At least two Indian manufacturers with TGA GMP clearance for this dosage form.")],
    "brief": [("Draft the project brief", "Scope, pack sizes, claims, target price and launch window on the brief template."),
              ("Confirm pack sizes and claims", "Check every claim against the permitted indications list."),
              ("Brief review with the Director", "Walk through the brief and capture decisions in the minutes.")],
    "commercial": [("Complete the FMEA risk analysis", "Failure modes for supply, quality and regulatory risk with owners and mitigations."),
                   ("Finalise the cost model", "Landed cost per unit including freight, duty and packaging."),
                   ("Pricing and margin review", "Shelf price scenarios against the three main banner groups."),
                   ("Three-year volume forecast", "Units by month for launch year, then yearly for years two and three.")],
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
                     ("Review the stability protocol", "ICH zone IVa conditions with 6, 12 and 24 month pulls."),
                     ("Collect the process description", "Manufacturing flow chart with in-process controls.")],
    "dossier_ready": [("Final dossier QC", "Hyperlinks, bookmarks and page numbering across all modules."),
                      ("Cross-check artwork against the dossier", "Carton and label text against Module 1 product information."),
                      ("Dossier ready sign-off checklist", "Confirm agreements, artwork and manufacturer data are all approved.")],
    "submission": [("Upload the dossier to TGA Business Services", "Lodge the application and attach the eCTD sequence."),
                   ("Pay the evaluation fee", "Raise the PO and pay within five working days of lodgement."),
                   ("Confirm the submission acknowledgement", "File the TGA acknowledgement letter and note the submission number.")],
    "rfi": [("Draft the response cover letter", "Cover letter listing each question and where the answer sits."),
            ("Collate evidence for the response", "Put every evidence file in the response package folder.")],
    "approval": [("Record the ARTG number", "Add the ARTG number to the product master and the artwork."),
                 ("Update product master data", "ERP item, barcodes and pricing set up for launch."),
                 ("Notify the commercial team of approval", "Share the approval letter and the approved indications.")],
    "readiness": [("Approve the final print proof", "Wet proof checked against the approved artwork."),
                  ("Launch plan and sales briefing", "Sell-in story, pricing and promotional calendar."),
                  ("Retailer listing pack", "Product data sheets and images for the banner groups.")],
    "manufacturing": [("Confirm the batch 1 manufacturing slot", "Lock in the slot and raw material call-off."),
                      ("Review the executed batch record", "Deviations, yields and in-process results."),
                      ("Release testing for batch 1", "Finished product testing against the specification.")],
    "dispatch": [("Pre-shipment sample review", "Check retained samples for appearance, labelling and pack integrity."),
                 ("Book freight Mumbai to Sydney", "Sea freight with temperature logger; ETA in the shared tracker."),
                 ("Import permit and customs entry", "Broker paperwork ready before the vessel arrives.")],
    "completion": [("Post-launch review", "What went well, what to change, and the final cost against budget."),
                   ("Archive the project records", "Confirm every record is final and the audit trail is complete.")],
}

STAGE_DOCS = {
    "opportunity": [("Report", "Opportunity screening summary")],
    "brief": [("Brief", "Project brief")],
    "commercial": [("Feasibility / FMEA", "Feasibility and FMEA report"), ("Report", "Cost model and margin analysis")],
    "legal": [("Agreement", "Agreement tracker export")],
    "regulatory": [("Report", "Regulatory strategy")],
    "manufacturer": [("Specification", "Finished product specification")],
    "dossier_ready": [("Dossier", "Dossier QC sign-off")],
    "submission": [("Correspondence", "TGA acknowledgement letter")],
    "approval": [("Correspondence", "ARTG approval letter")],
    "readiness": [("Report", "Launch readiness checklist")],
    "manufacturing": [("Report", "Batch 1 manufacturing record")],
    "dispatch": [("Report", "Pre-shipment sample report")],
    "completion": [("Report", "Project closure report")],
}

AGREEMENT_NOTES = {"supplier": "Five-year supply term, 60-day payment, annual price review.",
                   "quality": "Signed by both QA heads; change control notice period 90 days.",
                   "pv": "Serious adverse events exchanged within 24 hours."}
AGREEMENT_OPEN_NOTES = {"sent_for_signature": "Approved by Legal; with the manufacturer for signature.",
                        "in_review": "Redlines returned by the manufacturer, waiting for Legal review.",
                        "drafting": "First draft on the 2026 template.",
                        "changes_requested": "Liability cap must match the supply agreement.",
                        "not_started": "", "signed": ""}
DOSSIER_NOTES = {"reviewed": "Reviewed by RA, no open comments.", "ready": "Complete, waiting for RA review.",
                 "awaiting_approval": "Submitted for RA approval.", "draft": "Drafting in progress.",
                 "changes_requested": "Update the batch numbers to match the COAs.", "missing": ""}
MFR_NOTES = {"coa": "Three registration batches, all within specification.", "msds": "Safety data sheets for all excipients.",
             "specification": "Release and shelf-life specification, version 3.", "stability": "Zone IVa, 25°C / 60% RH and 40°C / 75% RH.",
             "testing": "Microbial limits and preservative efficacy.", "manufacturing": "Process flow and in-process controls."}
ARTWORK_RETURNS = ["Warning statement size is below the minimum", "Active ingredient must be on the main panel",
                   "Use the AUST number placeholder until approval", "Dosage table does not match the leaflet"]
RFI_SUMMARIES = ["Questions on the stability data and the dissolution method", "Clarification of the excipient grades and the label warnings",
                 "Further detail on the impurity limits and the pack closure"]
RFI_QUESTIONS = ["Provide 12-month real-time stability data for the commercial pack.",
                 "Justify the proposed shelf life against the accelerated data.",
                 "Confirm the warning statements on the carton follow RASML.",
                 "Explain the limit set for the largest unspecified impurity."]
RFI_ANSWERS = ["Data attached: 12 months at 30°C / 75% RH, all results within specification.",
               "Shelf life of 24 months supported by the accelerated data and the trend analysis.",
               "Carton updated; all required statements are present at the correct size.",
               "Limit set at 0.2% in line with ICH Q3B and the batch data."]

PORTFOLIO = [
    dict(pm="Liam", name="Saline Nasal Spray – Hypertonic (v2)", product="Hypertonic saline 3% nasal spray, 30 mL", project_type="In-Licence",
         category="Nasal care", submission_type="Listed medicine (AUST L)", mfr="Medisynth Labs", at=["submission"], age=96, sub_in=5, launch_in=150,
         summary="In-licence of a hypertonic saline nasal spray to refresh the Neo nasal range."),
    dict(pm="Priya", name="Eye Drops – Lubricant", product="Preservative-free lubricant eye drops, 10 mL", category="Eye care",
         submission_type="Registered medicine – full dossier (AUST R)", mfr="Sterifill Pharma", at=["legal", "regulatory", "artwork", "manufacturer"],
         status="on_hold", age=58, sub_in=90, launch_in=280, summary="Preservative-free lubricant eye drops in a multi-dose pack."),
    dict(pm="Liam", name="Throat Lozenge – Honey & Lemon", product="Honey & lemon lozenges, pack of 24", category="Ear & throat care",
         initiator="Emma Wilson", at=["opportunity"], age=6, launch_in=330, summary="Soothing lozenge range extension for the cold and flu season."),
    dict(pm="Liam", calm=True, name="Vitamin D3 Gummies", product="Vitamin D3 1000 IU gummies, 60 pack", category="Vitamins", initiator="Emma Wilson",
         submission_type="Listed medicine (AUST L)", mfr="Coastal Nutraceuticals", at=["manufacturing"], age=190, sub_in=-80, launch_in=40,
         summary="Chewable vitamin D3 for adults."),
    dict(pm="Priya", name="Magnesium Sleep Spray", product="Magnesium chloride spray, 100 mL", category="Sleep",
         submission_type="Listed medicine (AUST L)", mfr="Coastal Nutraceuticals", at=None, age=260, sub_in=-150, launch_in=-40,
         summary="Listed topical magnesium spray."),
    dict(pm="Olivia", calm=True, name="Paracetamol 500 mg Tablets", product="Paracetamol 500 mg film-coated tablets, 20 and 100 packs", category="Pain relief",
         submission_type="Registered medicine – abridged / generic (AUST R)", at=["approval"], awaiting=["approval"], age=230, sub_in=-110, launch_in=60,
         summary="Generic paracetamol tablets to complete the Neo pain range."),
    dict(pm="Priya", calm=True, name="Loratadine 10 mg Tablets", product="Loratadine 10 mg tablets, 30 pack", category="Respiratory & allergy",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Aurora Lifesciences", at=["dossier_ready"], age=150, sub_in=8, launch_in=210,
         summary="Non-drowsy antihistamine for hay fever season."),
    dict(pm="Liam", calm=True, name="Sodium Chloride Eye Wash", product="Sterile eye wash, 100 mL with eye cup", category="Eye care",
         submission_type="Listed medicine (AUST L)", mfr="Sterifill Pharma", at=["readiness"], age=210, sub_in=-90, launch_in=25,
         summary="Sterile eye wash for irritation and foreign bodies."),
    dict(pm="Olivia", name="Lactulose Oral Solution", product="Lactulose 3.34 g/5 mL oral solution, 500 mL", category="Gastro & bowel care",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Medisynth Labs", at=["legal", "regulatory", "manufacturer"], age=70,
         sub_in=55, launch_in=240, summary="Gentle osmotic laxative for constipation."),
    dict(pm="Priya", calm=True, name="Peppermint Oil IBS Capsules", product="Enteric-coated peppermint oil 187 mg, 45 capsules", category="Gastro & bowel care",
         submission_type="Listed medicine (AUST L)", at=["brief"], age=15, sub_in=150, launch_in=360, initiator="Chloe Martin",
         summary="Relief of abdominal cramping and bloating associated with IBS."),
    dict(pm="Liam", calm=True, name="Hydrocortisone 1% Cream", product="Hydrocortisone 1% cream, 30 g tube", category="Skin care",
         submission_type="Registered medicine – abridged / generic (AUST R)", at=["dispatch"], age=250, sub_in=-140, launch_in=14,
         summary="Short-term relief of itch and inflammation."),
    dict(pm="Olivia", name="Clotrimazole 1% Cream", product="Clotrimazole 1% cream, 20 g tube", category="Skin care",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Aurora Lifesciences", at=["legal", "regulatory", "artwork", "manufacturer"],
         age=48, sub_in=20, launch_in=200, blocker="API supplier lost its GMP certificate; second source needs qualification",
         summary="Broad-spectrum antifungal for tinea and thrush."),
    dict(pm="Priya", name="Ear Wax Removal Drops", product="Carbamide peroxide 6.5% ear drops, 15 mL", category="Ear & throat care",
         submission_type="Listed medicine (AUST L)", at=["commercial"], age=25, sub_in=120, launch_in=300, initiator="Emma Wilson",
         summary="Softens and removes ear wax at home."),
    dict(pm="Olivia", name="Benzydamine Throat Spray", product="Benzydamine 0.15% throat spray, 30 mL", category="Ear & throat care",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Medisynth Labs", at=["rfi"], age=140, sub_in=-35, launch_in=130,
         summary="Anti-inflammatory throat spray for sore throats."),
    dict(pm="Liam", calm=True, name="Dextromethorphan Cough Syrup", product="Dextromethorphan 15 mg/5 mL syrup, 200 mL", category="Respiratory & allergy",
         at=["opportunity"], age=4, launch_in=400, initiator="Chloe Martin", summary="Dry cough relief for adults and children over 12."),
    dict(pm="Priya", name="Terbinafine Nail Solution", product="Terbinafine 10 mg/g film-forming solution, 4 mL", category="Nail care",
         submission_type="Registered medicine – full dossier (AUST R)", at=["regulatory", "artwork", "manufacturer"], status="on_hold", age=80,
         sub_in=100, launch_in=320, summary="Once-weekly antifungal nail solution."),
    dict(pm="Olivia", name="Kids Oral Rehydration Ice Blocks", product="Oral rehydration ice blocks, 16 x 62.5 mL", category="Hydration",
         submission_type="Listed medicine (AUST L)", mfr="Coastal Nutraceuticals", at=None, age=300, sub_in=-200, launch_in=-60,
         summary="Fruit-flavoured rehydration ice blocks for children."),
    dict(pm="Liam", name="Loperamide 2 mg Capsules", product="Loperamide 2 mg capsules, 12 pack", category="Gastro & bowel care",
         at=["commercial"], status="rejected", age=40, summary="Fast relief of acute diarrhoea."),
    dict(pm="Olivia", calm=True, name="Oxymetazoline Nasal Spray", product="Oxymetazoline 0.05% nasal spray, 15 mL", category="Nasal care",
         submission_type="Variation to a registered medicine", mfr="Sterifill Pharma", at=["manufacturing"], age=170, sub_in=-75, launch_in=35,
         summary="Pack size variation for the 12-hour decongestant spray."),
    dict(pm="Priya", name="Cetirizine Oral Liquid for Kids", product="Cetirizine 1 mg/mL oral liquid, 100 mL", category="Respiratory & allergy",
         submission_type="Registered medicine – abridged / generic (AUST R)", mfr="Aurora Lifesciences", at=["submission"], awaiting=["submission"],
         age=120, sub_in=3, calm=True, launch_in=180, summary="Sugar-free antihistamine liquid for children aged 2 and over."),
]
