from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, models  # noqa: F401  (importing models registers the tables)
from .database import Base, SessionLocal, engine
from .routers import projects
from .seed import seed_if_empty

app = FastAPI(title="Neo Health Project Tracker")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.include_router(projects.router)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    if config.SEED_DEMO_DATA:
        with SessionLocal() as db:
            seed_if_empty(db)


# Serve the built React app when present (single-command demo)
if (config.FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = config.FRONTEND_DIST / path
        return FileResponse(f if path and f.is_file() else config.FRONTEND_DIST / "index.html")
