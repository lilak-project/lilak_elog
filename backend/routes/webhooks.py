"""
Webhook management routes (manager only).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from auth import require_manager
from database import get_db

router = APIRouter(tags=["webhooks"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    name: str
    url: str
    enabled: bool = True


class WebhookUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    enabled: Optional[bool] = None


class WebhookOut(BaseModel):
    id: int
    name: str
    url: str
    enabled: bool

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/webhooks", response_model=List[WebhookOut])
def list_webhooks(
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    return db.query(models.Webhook).order_by(models.Webhook.id).all()


@router.post("/webhooks", response_model=WebhookOut, status_code=status.HTTP_201_CREATED)
def create_webhook(
    payload: WebhookCreate,
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    wh = models.Webhook(name=payload.name, url=payload.url, enabled=payload.enabled)
    db.add(wh)
    db.commit()
    db.refresh(wh)
    return wh


@router.put("/webhooks/{wh_id}", response_model=WebhookOut)
def update_webhook(
    wh_id: int,
    payload: WebhookUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    wh = db.query(models.Webhook).filter(models.Webhook.id == wh_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    if payload.name    is not None: wh.name    = payload.name
    if payload.url     is not None: wh.url     = payload.url
    if payload.enabled is not None: wh.enabled = payload.enabled
    db.commit()
    db.refresh(wh)
    return wh


@router.delete("/webhooks/{wh_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_webhook(
    wh_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    wh = db.query(models.Webhook).filter(models.Webhook.id == wh_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    db.delete(wh)
    db.commit()
