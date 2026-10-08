"""Demo data so the dashboard is populated on first run."""
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


def seed_if_empty(db):
    if db.scalars(select(Project).limit(1)).first():
        return
    for name, ptype, cat, who, summary, steps in DEMO:
        p = services.create_project(db, ProjectCreate(name=name, project_type=ptype, category=cat,
                                                      initiator=who, summary=summary))
        for action, note in steps:
            services.apply_action(db, p, ActionIn(action=action, note=note, actor=who))
