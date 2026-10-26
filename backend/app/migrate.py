"""Schema housekeeping. This is a rebuild of the tracker's data model (users, tasks, workstreams, ...), so a database
created by the earlier single-flow version is kept as a .bak file and a fresh one is created. For later changes use Alembic."""
import time
from pathlib import Path

from sqlalchemy import inspect

from .config import DATABASE_URL


def archive_legacy_db(engine):
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    if "projects" not in tables or "workflow_defs" in tables:
        return None  # empty database, or already on the configurable-workflow schema
    if not DATABASE_URL.startswith("sqlite:///"):
        raise RuntimeError("This database uses the old schema. Migrate or drop it before starting the new version.")
    path = Path(DATABASE_URL.removeprefix("sqlite:///"))
    engine.dispose()
    backup = path.with_name(f"{path.stem}.legacy-{time.strftime('%Y%m%d-%H%M%S')}.bak")
    path.rename(backup)
    return backup


# columns added after the first release: a database made before them gets them added in place (data is kept)
NEW_COLUMNS = {
    "project_events": {"actor_id": "INTEGER", "ref_kind": "VARCHAR(16) DEFAULT ''", "ref_id": "INTEGER", "to_user": "VARCHAR(240) DEFAULT ''"},
    "project_stages": {"lead_id": "INTEGER", "approver_id": "INTEGER"},
    "notifications": {"link": "VARCHAR(200) DEFAULT ''"},
}


def ensure_columns(engine):
    from sqlalchemy import text
    insp = inspect(engine)
    have = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, cols in NEW_COLUMNS.items():
            if table not in have:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def refresh_settings(engine):
    """Replace setting values that are still the old placeholder wording (anything an admin typed is kept), and drop the
    doubled word from RFI task titles written before rfi_name() ("RFI RFI-2026-115 · Q1" -> "RFI-2026-115 · Q1")."""
    from sqlalchemy import text
    from .workflow import DEFAULT_SETTINGS, OLD_SETTINGS, OLD_STEP_TEXT
    if "settings" not in set(inspect(engine).get_table_names()):
        return
    with engine.begin() as conn:
        for k, old in OLD_SETTINGS.items():
            conn.execute(text("UPDATE settings SET value = :new WHERE key = :k AND value = :old"), {"new": DEFAULT_SETTINGS[k], "k": k, "old": old})
        if "workflow_defs" in set(inspect(engine).get_table_names()):
            for old, new in OLD_STEP_TEXT:
                conn.execute(text("UPDATE workflow_defs SET definition = REPLACE(definition, :old, :new) WHERE definition LIKE :like"),
                             {"old": old, "new": new, "like": f"%{old}%"})
        for table, col in (("tasks", "title"), ("notifications", "title"), ("notifications", "body"), ("project_events", "note")):
            conn.execute(text(f"UPDATE {table} SET {col} = REPLACE({col}, 'RFI RFI-', 'RFI-') WHERE {col} LIKE '%RFI RFI-%'"))
