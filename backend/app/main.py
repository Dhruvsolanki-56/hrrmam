from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, models  # noqa: F401  (importing models registers the tables)
from .database import Base, SessionLocal, engine
from .migrate import archive_legacy_db
from .routers import core, projects
from .seed import seed_reference, seed_demo
from .services import common, notify

app = FastAPI(title="Neo Product Lifecycle & Regulatory Operations Platform")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.include_router(core.public)
app.include_router(core.router)
app.include_router(projects.router)


@app.exception_handler(common.WorkflowError)
async def _workflow(_: Request, e: common.WorkflowError):
    return JSONResponse({"detail": str(e)}, status_code=422)


@app.exception_handler(common.Forbidden)
async def _forbidden(_: Request, e: common.Forbidden):
    return JSONResponse({"detail": str(e)}, status_code=403)


@app.exception_handler(common.NotFound)
async def _not_found(_: Request, e: common.NotFound):
    return JSONResponse({"detail": str(e)}, status_code=404)


@app.on_event("startup")
def startup():
    archive_legacy_db(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_reference(db)
        if config.SEED_DEMO_DATA:
            seed_demo(db)
        notify.refresh_reminders(db)


# Serve the built React app when present (single-command demo)
if (config.FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = config.FRONTEND_DIST / path
        return FileResponse(f if path and f.is_file() else config.FRONTEND_DIST / "index.html")
