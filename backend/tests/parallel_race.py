"""Two people approve the last two parallel lanes at the same moment.  Run:  python backend/tests/parallel_race.py"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
import os, sys, tempfile
db = os.path.join(tempfile.gettempdir(), 'nh_race.db')
if os.path.exists(db): os.remove(db)
os.environ['DATABASE_URL'] = 'sqlite:///' + db.replace(chr(92), '/')
sys.path.insert(0, str(ROOT))
from sqlalchemy import select
from app.database import Base, engine, SessionLocal
from app.seed import seed_reference, PEOPLE, Demo
from app.models import User, Project
from app import schemas as sc
from app.services import workflows, engine as E

Base.metadata.create_all(engine)
with SessionLocal() as s:
    seed_reference(s); workflows.load_registry(s)
    for u in s.query(User).filter(User.name == "Administrator"): u.active = False
    for name, role, country in PEOPLE:
        s.add(User(name=name, email=name.lower().replace(' ', '.') + '@neo.example', role_key=role, country=country))
    s.commit()


def setup(name):
    with SessionLocal() as s:
        d = Demo(s)
        p = d.drive(dict(name=name, product="x", category="Pain relief", submission_type="Listed medicine (AUST L)", at="parallel",
                         lanes=dict(commercial="review", legal="review", regulatory="done", artwork="done", manufacturer="done"), age=10))
        return p.id


def race(pid, patched):
    saved = E._reconcile
    if patched:
        E._reconcile = lambda *a, **k: None
    try:
        s1, s2 = SessionLocal(), SessionLocal()
        p1, p2 = s1.get(Project, pid), s2.get(Project, pid)
        _ = [r.state for r in p1.stages], [r.state for r in p2.stages]   # both requests have read the project
        u1 = s1.scalar(select(User).where(User.role_key == "director"))
        u2 = s2.scalar(select(User).where(User.role_key == "director"))
        E.apply_action(s1, u1, p1, sc.ActionIn(action="approve", stage_key="commercial"))
        E.apply_action(s2, u2, p2, sc.ActionIn(action="approve", stage_key="legal"))
        s1.close(); s2.close()
    finally:
        E._reconcile = saved
    with SessionLocal() as s:
        p = s.get(Project, pid)
        return {r.stage_key: r.state for r in p.stages}


a = race(setup("race without the fix"), True)
b = race(setup("race with the fix"), False)
print("without reconcile: dossier_ready =", a["dossier_ready"])
print("with reconcile   : dossier_ready =", b["dossier_ready"])
assert a["dossier_ready"] == "pending", "expected the bug to show without the fix"
assert b["dossier_ready"] == "in_progress", b
print("OK: the join opens even when the last two approvals overlap")
