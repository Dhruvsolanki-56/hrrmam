"""Demo data so the dashboard is populated on first run."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from . import services, workflow
from .models import Project
from .schemas import ActionIn, ProjectCreate


class _Demo:
    def __init__(self, db, p, who):
        self.db, self.p, self.who = db, p, who

    def do(self, action, stage_key=None, note=""):
        services.apply_action(self.db, self.p, ActionIn(action=action, stage_key=stage_key, note=note, actor=self.who))

    def approve_through(self, *keys):
        """Run each stage through its full cycle: submit (if there is work) then approve."""
        for k in keys:
            if not workflow.stage(k).decision_only:
                self.do("submit", k)
            self.do("approve", k)


def _backdate(p, ages):
    """Spread events back in time and set how long each active stage has been running."""
    now = datetime.now(timezone.utc)
    n = len(p.events)
    youngest = min(ages.values()) if ages else 2
    for i, e in enumerate(p.events):
        e.created_at = now - timedelta(days=youngest + 2 * (n - 1 - i))
    p.created_at = p.events[0].created_at
    p.updated_at = p.events[-1].created_at
    for row in p.stages:
        if row.stage_key in ages:
            row.started_at = now - timedelta(days=ages[row.stage_key])


def seed_if_empty(db):
    if db.scalars(select(Project).limit(1)).first():
        return

    def make(name, ptype, cat, who, summary):
        p = services.create_project(db, ProjectCreate(name=name, project_type=ptype, category=cat, initiator=who, summary=summary))
        return p, _Demo(db, p, who)

    # 1. Waiting on the India Director for more information (overdue)
    p, d = make("Ibuprofen Gel 5% – Topical Pain Relief", "Development", "Pain", "Priya Nair",
                "Topical NSAID gel for the AU OTC pain range.")
    d.approve_through("screening", "validation", "director_approval", "brief")
    d.do("clarify", "india_review", "Costing breakdown is missing from the brief")
    _backdate(p, {"india_review": 11})

    # 2. At the joint commercial approval
    p, d = make("Saline Nasal Spray – Hypertonic", "In-Licence", "Nasal care", "Tom Gallagher",
                "In-licence of a hypertonic saline nasal spray.")
    d.approve_through("screening", "validation", "director_approval", "brief", "india_review", "feasibility")
    _backdate(p, {"commercial_approval": 3})

    # 3. Three phases running in parallel, with one send-back cycle
    p, d = make("Electrolyte Hydration Sachets", "Development", "Hydration", "Priya Nair",
                "Oral rehydration sachets, three flavours.")
    d.approve_through("screening", "validation", "director_approval", "brief", "india_review", "feasibility",
                      "commercial_approval", "agreements")
    d.do("submit", "artwork")
    d.do("submit", "regulatory")
    d.do("send_back", "regulatory", "Stability data for module 3 is missing")
    _backdate(p, {"artwork": 4, "regulatory": 20})

    # 4. Rejected by the Director
    p, d = make("Medicated Nail Lacquer", "Development", "Nail care", "Aman Madan",
                "Antifungal nail lacquer for the AU market.")
    d.approve_through("screening", "validation")
    d.do("reject", "director_approval", "Margin below target – does not support launch")
    _backdate(p, {"director_approval": 14})

    # 5. On hold
    p, d = make("Eye Drops – Lubricant", "In-Licence", "Eye care", "Tom Gallagher",
                "Preservative-free lubricant eye drops.")
    d.approve_through("screening", "validation", "director_approval", "brief")
    d.do("hold", None, "Awaiting supplier dossier clarification")
    _backdate(p, {"india_review": 5})

    # 6. Just started
    p, d = make("Throat Lozenge – Honey & Lemon", "Development", "Ear & throat care", "Priya Nair",
                "Honey & lemon lozenge line extension.")
    d.do("submit", "screening")
    _backdate(p, {"screening": 2})

    db.commit()
