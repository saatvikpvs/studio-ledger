from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .api.v1 import api_router
from .core.config import settings
from .core.db import Base, engine
from .core.security import FORBIDDEN_FIELD
from .services.ledger import LedgerError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("studio_ledger")

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Project-fund accounting for an architectural practice running client "
        "money and personal money through one bank account."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    # NOTE: create_all is adequate for a single practice. Add Alembic before
    # the first schema change made against real data -- see README.
    from . import models  # noqa: F401  (registers the tables)

    Base.metadata.create_all(bind=engine)
    # Login always looks up by lowercased email; normalize any row an older
    # setup run stored with mixed case, so it stays findable.
    with engine.begin() as conn:
        conn.execute(text("UPDATE owner SET email = lower(email) WHERE email != lower(email)"))
    log.info("Database ready at %s", settings.database_url)


@app.middleware("http")
async def refuse_credentials(request: Request, call_next):
    """Section 14's hard rule, enforced at the edge.

    This application never accepts a bank password, PIN, CVV or OTP. Anything
    that looks like one is refused before it reaches a handler, so it can never
    be logged, stored, or forwarded.
    """
    if request.method in ("POST", "PATCH", "PUT"):
        for key in request.query_params:
            if FORBIDDEN_FIELD.search(key):
                return JSONResponse(
                    status_code=400,
                    content={
                        "detail": "This application never accepts bank credentials, "
                                  f"PINs or OTPs. Refused parameter: {key!r}"
                    },
                )
    return await call_next(request)


@app.exception_handler(LedgerError)
async def ledger_error_handler(_request: Request, exc: LedgerError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.app_name}


app.include_router(api_router)


# --------------------------------------------------------------------------
# serve the built frontend, when there is one
# --------------------------------------------------------------------------

# app/main.py -> app -> api -> apps, then apps/web/dist
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"

if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = WEB_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
