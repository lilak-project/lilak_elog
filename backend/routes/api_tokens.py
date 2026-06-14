"""
API token management (manager only).
Tokens are used by external DAQ/automation systems to POST log entries.
"""

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from auth import require_manager
from database import get_db

router = APIRouter(tags=["api-tokens"])


@router.get("/tokens", response_model=list[schemas.ApiTokenOut])
def list_tokens(
    _: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    return db.query(models.ApiToken).order_by(models.ApiToken.created_at.desc()).all()


@router.post("/tokens", response_model=schemas.ApiTokenOut, status_code=status.HTTP_201_CREATED)
def create_token(
    payload: schemas.ApiTokenCreate,
    _: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    # Revoke all previous tokens with the same source_name so only the new
    # one is valid — prevents duplicate pushes from stale credentials.
    # Soft-revoke (matching DELETE /tokens/{id}) so last_used_at audit
    # history survives the rotation.
    if payload.source_name:
        db.query(models.ApiToken).filter(
            models.ApiToken.source_name == payload.source_name
        ).update({"is_active": False}, synchronize_session=False)
    token_str = "elog_" + secrets.token_urlsafe(32)
    token = models.ApiToken(
        name=payload.name,
        token=token_str,
        source_name=payload.source_name,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(
    token_id: int,
    _: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    token = db.query(models.ApiToken).filter(models.ApiToken.id == token_id).first()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    token.is_active = False
    db.commit()
