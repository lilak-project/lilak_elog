"""
User management routes + auth login + self-registration + log transfer.
"""

from datetime import datetime, timezone
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel as _BM
from typing import Optional

import models
import schemas
from auth import (
    create_access_token, hash_password, require_auth,
    require_manager, validate_username, validate_password, verify_password,
)
from database import get_db

router = APIRouter(tags=["users"])


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post("/auth/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.username == payload.username,
        models.User.is_active == True,
    ).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    token = create_access_token(user.id, user.username, user.role)
    return schemas.TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role,
    )


@router.get("/auth/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(require_auth)):
    return current_user


# ── User preferences ──────────────────────────────────────────────────────────

class PrefsPayload(_BM):
    theme:   Optional[str] = None
    density: Optional[str] = None
    size:    Optional[str] = None
    lang:    Optional[str] = None


@router.get("/auth/me/preferences")
def get_preferences(current_user: models.User = Depends(require_auth)):
    """Return the current user's UI preferences."""
    try:
        prefs = json.loads(current_user.preferences_json or '{}')
    except Exception:
        prefs = {}
    return prefs


@router.put("/auth/me/preferences")
def set_preferences(
    payload: PrefsPayload,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Save/merge UI preferences for the current user."""
    try:
        prefs = json.loads(current_user.preferences_json or '{}')
    except Exception:
        prefs = {}
    for key, val in payload.model_dump(exclude_none=True).items():
        prefs[key] = val
    current_user.preferences_json = json.dumps(prefs)
    db.commit()
    return prefs


@router.patch("/auth/me", response_model=schemas.UserOut)
def update_me(
    payload: schemas.UserUpdate,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Self-service profile updates. Role / is_active / password changes
    are NOT allowed here — those go through the manager endpoint."""
    if payload.display_name is not None:
        current_user.display_name = payload.display_name or None
    if payload.email is not None:
        current_user.email = payload.email or None
    if payload.phone is not None:
        current_user.phone = payload.phone or None
    if payload.experiment_role is not None:
        current_user.experiment_role = payload.experiment_role or None
    if payload.participation_from is not None:
        current_user.participation_from = payload.participation_from or None
    if payload.participation_to is not None:
        current_user.participation_to = payload.participation_to or None
    if payload.profile_color is not None:
        current_user.profile_color = payload.profile_color or None
    if payload.profile_shape is not None:
        current_user.profile_shape = payload.profile_shape or None
    db.commit()
    db.refresh(current_user)
    return current_user


# ── Self-registration (공개 엔드포인트) ────────────────────────────────────────

@router.post("/auth/register", response_model=schemas.TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    """누구나 계정을 만들 수 있습니다. 이메일 필수, 아이디 영문숫자, 비밀번호 숫자 전용."""
    # 아이디 중복 확인
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 아이디입니다.")
    # 이메일 중복 확인
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 이메일입니다.")

    user = models.User(
        username=payload.username,
        display_name=payload.display_name or payload.username,
        email=payload.email,
        phone=payload.phone,
        role="user",
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

    token = create_access_token(user.id, user.username, user.role)
    return schemas.TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role,
    )


# ── Log transfer (두 계정 비밀번호 모두 필요) ──────────────────────────────────

@router.post("/users/transfer-logs")
def transfer_logs(payload: schemas.LogTransferRequest, db: Session = Depends(get_db)):
    """from_user의 모든 로그를 to_user로 이전. 양쪽 비밀번호 검증 필요."""
    from_user = db.query(models.User).filter(models.User.username == payload.from_username).first()
    if not from_user or not verify_password(payload.from_password, from_user.password_hash):
        raise HTTPException(status_code=401, detail="원본 계정의 비밀번호가 올바르지 않습니다.")

    to_user = db.query(models.User).filter(models.User.username == payload.to_username).first()
    if not to_user or not verify_password(payload.to_password, to_user.password_hash):
        raise HTTPException(status_code=401, detail="대상 계정의 비밀번호가 올바르지 않습니다.")

    if from_user.id == to_user.id:
        raise HTTPException(status_code=400, detail="원본과 대상 계정이 동일합니다.")

    logs = db.query(models.LogEntry).filter(models.LogEntry.author_id == from_user.id).all()
    count = len(logs)
    to_name = to_user.username

    for log in logs:
        log.author_id = to_user.id
        log.author_name = to_name
        log.updated_by = f"transfer:{from_user.username}->{to_user.username}"
        log.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db.commit()
    return {"transferred": count, "from": from_user.username, "to": to_user.username}


# ── Log transfer (manager — 비밀번호 없음) ─────────────────────────────────────

@router.post("/users/transfer-logs-admin")
def transfer_logs_admin(
    payload: schemas.LogTransferAdminRequest,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Manager 권한으로 비밀번호 없이 로그를 이전합니다."""
    from_user = db.query(models.User).filter(models.User.username == payload.from_username).first()
    if not from_user:
        raise HTTPException(status_code=404, detail="원본 계정을 찾을 수 없습니다.")

    to_user = db.query(models.User).filter(models.User.username == payload.to_username).first()
    if not to_user:
        raise HTTPException(status_code=404, detail="대상 계정을 찾을 수 없습니다.")

    if from_user.id == to_user.id:
        raise HTTPException(status_code=400, detail="원본과 대상 계정이 동일합니다.")

    logs = db.query(models.LogEntry).filter(models.LogEntry.author_id == from_user.id).all()
    count = len(logs)
    to_name = to_user.username
    for log in logs:
        log.author_id = to_user.id
        log.author_name = to_name
        log.updated_by = f"transfer:{from_user.username}->{to_user.username}"
        log.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db.commit()
    return {"transferred": count, "from": from_user.username, "to": to_user.username}


# ── Delete all logs of a user (manager only) ──────────────────────────────────

@router.delete("/users/{username}/logs")
def delete_user_logs(
    username: str,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """해당 사용자의 모든 로그를 소프트 삭제합니다."""
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    logs = db.query(models.LogEntry).filter(
        models.LogEntry.author_id == user.id,
        models.LogEntry.deleted_at == None,
    ).all()
    count = len(logs)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for log in logs:
        log.deleted_at = now
    db.commit()
    return {"deleted": count, "username": username}


# ── Public user list (no auth, active users only) ─────────────────────────────

@router.get("/users/public", response_model=list[schemas.UserPublic])
def list_public_users(db: Session = Depends(get_db)):
    """로그인 화면 등에서 계정 목록 표시용 — 비밀번호 없는 공개 정보만."""
    return (
        db.query(models.User)
        .filter(models.User.is_active == True)
        .order_by(models.User.username)
        .all()
    )


# ── User CRUD (manager only) ──────────────────────────────────────────────────

@router.get("/users", response_model=list[schemas.UserOut])
def list_users(
    _: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    users = db.query(models.User).order_by(models.User.username).all()
    # Attach live log_count (non-deleted logs)
    for u in users:
        u.log_count = db.query(models.LogEntry).filter(
            models.LogEntry.author_id == u.id,
            models.LogEntry.deleted_at == None,
        ).count()
    return users


@router.post("/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: schemas.UserCreate,
    _: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 아이디입니다.")
    if payload.email and db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 이메일입니다.")
    user = models.User(
        username=payload.username,
        display_name=payload.display_name,
        email=payload.email,
        phone=payload.phone,
        role=payload.role,
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
    return user


@router.get("/users/{user_id}", response_model=schemas.UserOut)
def get_user(
    user_id: int,
    _: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return user


@router.put("/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    payload: schemas.UserUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.email is not None:
        user.email = payload.email
    if payload.phone is not None:
        user.phone = payload.phone or None
    if payload.role is not None:
        user.role = payload.role
    if payload.experiment_role is not None:
        user.experiment_role = payload.experiment_role or None
    if payload.participation_from is not None:
        user.participation_from = payload.participation_from or None
    if payload.participation_to is not None:
        user.participation_to = payload.participation_to or None
    if payload.profile_color is not None:
        user.profile_color = payload.profile_color or None
    if payload.profile_shape is not None:
        user.profile_shape = payload.profile_shape or None
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="자기 자신은 삭제할 수 없습니다.")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # 로그 기록이 있으면 삭제 불가
    log_count = db.query(models.LogEntry).filter(models.LogEntry.author_id == user_id).count()
    if log_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"이 계정에는 로그 기록({log_count}건)이 있어 삭제할 수 없습니다. 먼저 로그를 다른 계정으로 이전하세요."
        )

    # 로그 없으면 실제 비활성화
    user.is_active = False
    db.commit()
