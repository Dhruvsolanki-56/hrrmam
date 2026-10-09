"""Demo data so the dashboard is populated on first run."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from . import services
from .models import Project
from .schemas import ActionIn, ProjectCreate

DEMO = [
    ("Ibuprofen Gel 5% – Topical Pain Relief", "Development", "Pain", "Priya Nair",
     "Topical NSAID gel for the AU OTC pain range.",
     [("advance", "Screening passed"), ("advance", "Business case validated"),
      ("approve", "Approved to proceed"), ("advance", "Brief drafted, internal review complete"),
      ("clarify", "Costing breakdown is missing from the brief")]),
    ("Saline Nasal Spray – Hypertonic", "In-Licence", "Nasal care", "Tom Gallagher",
     "In-licence of a hypertonic saline nasal spray.",
     [("advance", ""), ("advance", ""), ("approve", "Approved"), ("advance", ""),
      ("approve", "Brief approved"), ("approve", "FMEA reviewed, feasibility accepted")]),
    ("Electrolyte Hydration Sachets", "Development", "Hydration", "Priya Nair",
     "Oral rehydration sachets, three flavours.",
     [("advance", ""), ("advance", ""), ("approve", ""), ("advance", ""), ("approve", ""),
      ("approve", "Feasibility approved"), ("approve", "Both Directors approved"),
      ("approve", "Supplier agreement signed"), ("approve", "Artwork approved")]),
    ("Medicated Nail Lacquer", "Development", "Nail care", "Aman Madan",
     "Antifungal nail lacquer for the AU market.",
     [("advance", ""), ("advance", ""), ("reject", "Margin below target – does not support launch")]),
    ("Eye Drops – Lubricant", "In-Licence", "Eye care", "Tom Gallagher",
     "Preservative-free lubricant eye drops.",
     [("advance", ""), ("advance", ""), ("approve", ""), ("advance", ""),
      ("hold", "Awaiting supplier dossier clarification")]),
    ("Throat Lozenge – Honey & Lemon", "Development", "Ear & throat care", "Priya Nair",
     "Honey & lemon lozenge line extension.", []),
]


# Days each demo project has been in its current stage: shows ok / near-limit / overdue states.
DAYS_IN_STAGE = [11, 3, 20, 14, 5, 2]


def _backdate(p, days_in_stage):
    """Spread events back in time so the last stage entry is `days_in_stage` days ago."""
    now = datetime.now(timezone.utc)
    n = len(p.events)
    for i, e in enumerate(p.events):
        e.created_at = now - timedelta(days=days_in_stage + 3 * (n - 1 - i))
    p.created_at = p.events[0].created_at
    p.updated_at = p.events[-1].created_at


def seed_if_empty(db):
    if db.scalars(select(Project).limit(1)).first():
        return
    for (name, ptype, cat, who, summary, steps), age in zip(DEMO, DAYS_IN_STAGE):
        p = services.create_project(db, ProjectCreate(name=name, project_type=ptype, category=cat,
                                                      initiator=who, summary=summary))
        for action, note in steps:
            services.apply_action(db, p, ActionIn(action=action, note=note, actor=who))
        _backdate(p, age)
        db.commit()
