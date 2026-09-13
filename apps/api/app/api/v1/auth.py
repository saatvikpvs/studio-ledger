from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...core.db import get_db
from ...core.security import make_token, require_owner, verify_password
from ...models import Owner
from ...schemas import LoginIn, OwnerOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=OwnerOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    owner = db.scalar(select(Owner).where(Owner.email == body.email.lower()))
    # Same message either way -- never reveal whether an address exists.
    if owner is None or not verify_password(body.password, owner.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    if not owner.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled")

    response.set_cookie(
        settings.cookie_name,
        make_token(owner.id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.access_token_hours * 3600,
        path="/",
    )
    return owner


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(settings.cookie_name, path="/")
    return {"ok": True}


@router.get("/me", response_model=OwnerOut)
def me(owner_id: int = Depends(require_owner), db: Session = Depends(get_db)):
    return db.get(Owner, owner_id)
