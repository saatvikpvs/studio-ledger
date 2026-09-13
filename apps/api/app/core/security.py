from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db

_hasher = PasswordHasher()

# The hard rule from section 14, enforced in code rather than left as policy:
# this system never accepts a bank credential, however it is spelled.
FORBIDDEN_FIELD = re.compile(
    r"(bank[_\s-]?password|net[_\s-]?banking|upi[_\s-]?pin|card[_\s-]?pin|"
    r"debit[_\s-]?pin|atm[_\s-]?pin|\bcvv\b|\botp\b|mpin)",
    re.IGNORECASE,
)


def reject_credential_fields(payload: dict) -> None:
    """Refuse any request that looks like it is carrying a banking secret."""
    for key in payload:
        if FORBIDDEN_FIELD.search(str(key)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "This application never accepts bank passwords, PINs, CVVs or OTPs. "
                    f"Refused field: {key!r}"
                ),
            )


def hash_password(raw: str) -> str:
    if len(raw) < 10:
        raise ValueError("password must be at least 10 characters")
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        _hasher.verify(hashed, raw)
        return True
    except (VerifyMismatchError, Exception):  # noqa: BLE001 - any failure is a failure
        return False


def make_token(owner_id: int) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(owner_id),
            "iat": now,
            "exp": now + timedelta(hours=settings.access_token_hours),
        },
        settings.secret_key,
        algorithm="HS256",
    )


def current_owner_id(
    session_cookie: str | None = Cookie(default=None, alias=settings.cookie_name),
) -> int:
    if not session_cookie:
        raise HTTPException(status_code=401, detail="Not signed in")
    try:
        payload = jwt.decode(session_cookie, settings.secret_key, algorithms=["HS256"])
        return int(payload["sub"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Session expired") from exc


def require_owner(
    owner_id: int = Depends(current_owner_id),
    db: Session = Depends(get_db),
) -> int:
    from ..models import Owner

    owner = db.get(Owner, owner_id)
    if owner is None or not owner.is_active:
        raise HTTPException(status_code=401, detail="Account not available")
    return owner_id
