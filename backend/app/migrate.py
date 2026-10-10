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
