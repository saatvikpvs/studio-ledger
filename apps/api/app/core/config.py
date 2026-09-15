from __future__ import annotations

import secrets
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Studio Ledger"

    # SQLite by default so the app runs with no infrastructure.
    # Point this at postgresql+psycopg://... to deploy; the models are portable.
    database_url: str = f"sqlite:///{(ROOT / 'studio_ledger.db').as_posix()}"

    #: Leave unset and one is generated and persisted to .secret_key on first
    #: run. A per-process random key would sign everyone out on every restart
    #: and break outright across multiple workers.
    secret_key: str = ""
    access_token_hours: int = 12
    cookie_secure: bool = False  # set true behind HTTPS
    #: "lax" works when frontend and API share an origin (local dev, or the
    #: single-process deploy). Splitting them across domains (e.g. a static
    #: frontend on Firebase Hosting calling an API on Render) needs "none",
    #: which requires cookie_secure=True -- browsers refuse a SameSite=None
    #: cookie that isn't also Secure.
    cookie_samesite: str = "lax"
    cookie_name: str = "sl_session"

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    upload_dir: Path = ROOT / "uploads"
    max_upload_mb: int = 15

    fiscal_year_start_month: int = 4  # April, Indian FY

    # Warn when a project has spent this share of what it has received.
    project_warn_ratio: float = 0.85


def _persisted_secret() -> str:
    key_file = ROOT / ".secret_key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    secret = secrets.token_urlsafe(48)
    key_file.write_text(secret, encoding="utf-8")
    try:  # best effort on Windows; POSIX honours the mode
        key_file.chmod(0o600)
    except OSError:
        pass
    return secret


settings = Settings()
if not settings.secret_key:
    settings.secret_key = _persisted_secret()
if settings.cookie_samesite.lower() == "none" and not settings.cookie_secure:
    # A browser drops a SameSite=None cookie that isn't also Secure -- silently,
    # with no error anywhere. Fail loudly at startup instead of "login works but
    # nothing stays signed in" three deploys from now.
    raise RuntimeError(
        "COOKIE_SAMESITE=none requires COOKIE_SECURE=true (cross-site cookies "
        "must be Secure, or browsers discard them)."
    )
settings.upload_dir.mkdir(parents=True, exist_ok=True)
