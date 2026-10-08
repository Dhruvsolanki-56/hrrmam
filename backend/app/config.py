"""Runtime configuration. Change DATABASE_URL to move to Postgres/MySQL later."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'neohealth.db'}")
SEED_DEMO_DATA = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
