"""Tiny additive migration so an existing database keeps working after a column is added.
(Use Alembic once the schema starts changing more often.)"""
from sqlalchemy import inspect, text


def ensure_columns(engine):
    insp = inspect(engine)
    if "project_events" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("project_events")}
        if "to_stage" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE project_events ADD COLUMN to_stage VARCHAR(40)"))
