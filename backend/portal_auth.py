"""
Portal authentication — central accounts at the launcher level.

The launcher is the entry point for *all* services (elog projects today, other
apps later). Accounts therefore live centrally here, in their own SQLite DB
(`data/_portal.db`), independent of any single service's database.

Backward-compat with elog is the whole point of reusing elog's own pieces:
  • the account row IS `models.User`, so a portal account already carries every
    attribute an elog user has (username, email, role, profile_*, …);
  • passwords use elog's `hash_password` / `verify_password`;
  • tokens use elog's `create_access_token` (same `ELOG_SECRET_KEY` + payload),
    so a portal token is valid for elog backends too — later phases resolve the
    portal identity to a local elog user by email when a user enters a service.

This module exposes the same `/api/auth/*` shapes the elog frontend already
speaks (LoginRequest / TokenResponse / RegisterRequest / UserOut), so the
existing AuthContext works unchanged on the cover page: experiment-less
`/api/auth/*` authenticates against the portal; once inside an experiment the
app talks to that experiment's own `/launcher/p/<name>/api/auth/*`.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

# Importing `auth` pulls in `database`, which on import makes a data dir for
# ELOG_EXPERIMENT (default "default"). In the launcher process there is no real
# experiment, so steer that stray dir under the reserved `_portal/` (the project
# list skips `_`-prefixed names) instead of polluting the list with "default".
os.environ.setdefault("ELOG_EXPERIMENT", "_portal")

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

import models
import schemas
from auth import hash_password, verify_password, create_access_token, decode_access_token

# ── Portal DB (separate from every service DB) ────────────────────────────────
_HERE      = Path(__file__).parent
_ROOT      = _HERE.parent
_DATA_ROOT = Path(os.environ.get("ELOG_DATA_ROOT", _ROOT / "data"))
_DB_PATH   = Path(os.environ.get("PORTAL_DB", _DATA_ROOT / "_portal" / "portal.db"))
_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

_engine = create_engine(f"sqlite:///{_DB_PATH}", connect_args={"check_same_thread": False})
PortalSession = sessionmaker(bind=_engine, autoflush=False, autocommit=False)

# Only the User table lives in the portal DB (no FKs out of it).
models.User.__table__.create(bind=_engine, checkfirst=True)


def get_portal_db():
    db = PortalSession()
    try:
        yield db
    finally:
        db.close()


def _portal_token(user: models.User) -> str:
    """Mint a portal token. It carries `portal: true` + the account's profile so
    a service (elog) can link/provision a matching local user on entry."""
    return create_access_token(user.id, user.username, user.role, extra={
        "portal": True,
        "email": user.email,
        "name": user.display_name,
        "color": user.profile_color,
        "shape": user.profile_shape,
        "prole": user.role,
    })


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def require_portal_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_portal_db),
) -> models.User:
    token = _bearer(authorization)
    payload = decode_access_token(token) if token else None
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")
    user = db.query(models.User).filter(models.User.id == int(payload.get("sub", 0))).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")
    return user


router = APIRouter(tags=["portal-auth"])


@router.post("/api/auth/login", response_model=schemas.TokenResponse)
def portal_login(payload: schemas.LoginRequest, db: Session = Depends(get_portal_db)):
    user = (
        db.query(models.User)
          .filter(models.User.username == payload.username, models.User.is_active == True)  # noqa: E712
          .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    return schemas.TokenResponse(access_token=_portal_token(user), user_id=user.id,
                                 username=user.username, role=user.role)


@router.post("/api/auth/register", status_code=status.HTTP_201_CREATED, response_model=schemas.TokenResponse)
def portal_register(payload: schemas.RegisterRequest, db: Session = Depends(get_portal_db)):
    """Open self-signup. The very first portal account becomes the admin
    ('manager'); everyone after is a normal 'user'."""
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 아이디입니다.")
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 이메일입니다.")

    first = db.query(models.User).count() == 0
    user = models.User(
        username=payload.username,
        display_name=payload.display_name or payload.username,
        email=payload.email,
        phone=payload.phone,
        role="manager" if first else "user",
        is_active=True,
        experiment_role=payload.experiment_role,
        participation_from=payload.participation_from,
        participation_to=payload.participation_to,
        profile_color=payload.profile_color,
        profile_shape=payload.profile_shape,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.TokenResponse(access_token=_portal_token(user), user_id=user.id,
                                 username=user.username, role=user.role)


@router.get("/api/auth/me", response_model=schemas.UserOut)
def portal_me(current_user: models.User = Depends(require_portal_user)):
    return current_user


@router.post("/api/auth/logout")
def portal_logout(current_user: models.User = Depends(require_portal_user)):
    # Stateless JWT — the client drops the token. Endpoint exists for symmetry.
    return {"ok": True}
