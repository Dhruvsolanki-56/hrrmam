# Neo Health Project Tracker

A simple, high-level project tracker that replaces calls and Excel sheets. Based on the Project
Management Flow Chart (AD001-F01-00), condensed into 12 stages, each with its responsible entity/team.

**Stack:** React (Vite) · FastAPI · SQLite (file-based, via SQLAlchemy)

## Run it

```powershell
./run.ps1            # builds the frontend, starts the API + UI at http://localhost:8000
```

Development mode (hot reload):

```powershell
cd backend;  python -m uvicorn app.main:app --reload --port 8000
cd frontend; npm run dev        # http://localhost:5173, proxies /api to :8000
```

The database is `backend/neohealth.db`, created on first start and filled with demo projects.
Delete the file to reset, or set `SEED_DEMO_DATA=false` for an empty start.

## Core workflow

Create a project → it moves through the stages → at decision stages the responsible Director
**approves**, **rejects** (or returns for modification) → any project can be **put on hold** and resumed.
Every action is logged with a note and who did it.

## Structure

```
backend/app
  workflow.py   the stages, entities and owners (edit here to change the flow)
  models.py     two tables: projects, project_events
  services.py   workflow rules (approve / reject / hold / resume)
  routers/      thin HTTP layer
  database.py   engine + session; config.py reads DATABASE_URL
frontend/src
  pages/        Dashboard, ProjectDetail
  components/   stage tracker, action panel, timeline, new-project form
```

**Moving off SQLite:** set `DATABASE_URL` (e.g. `postgresql+psycopg://...`). Only SQLAlchemy is used and
no SQLite-specific features, so no code changes are needed beyond adding migrations (Alembic) for production.

## Branding

Colours, capsule shapes and type follow the Neo Health Brand Style Guide (Aug 2026): Neo Green `#00817e`,
Neo Dark Green `#004248`, Neo Bright Green `#C1E1C0`, Neo Black `#231F20`, Neo Grey `#DCDDDD`.
Body is Montserrat. Headings use **Eurostile Extended** if installed on the machine; otherwise they fall
back to Michroma (a close, freely licensed look-alike). To use the real font, add licensed files and an
`@font-face` for `'Eurostile Extended'` in `frontend/src/index.css`. The logo is the vector brandmark from the guide.
