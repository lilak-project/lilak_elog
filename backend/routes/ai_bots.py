"""
AI Bot CRUD routes — manager-only.
Bots respond to @mentions in the community chat.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from auth import require_manager
from database import get_db

router = APIRouter(tags=["ai_bots"])


def _key_hint(key: str) -> str:
    """Return a masked API key hint, e.g. 'sk-...abcd'."""
    if not key:
        return "****"
    visible = min(4, len(key) // 2)
    return key[:visible] + "…" + key[-4:] if len(key) > visible + 4 else "****"


def _to_out(bot: models.AiBot) -> schemas.AiBotOut:
    return schemas.AiBotOut(
        id=bot.id,
        name=bot.name,
        display_name=bot.display_name,
        provider=bot.provider,
        api_key_hint=_key_hint(bot.api_key),
        model=bot.model,
        system_prompt=bot.system_prompt,
        context_count=bot.context_count,
        enabled=bot.enabled,
        created_at=bot.created_at,
        created_by=bot.created_by,
    )


@router.get("/ai-bots", response_model=list[schemas.AiBotOut])
def list_bots(
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    return [_to_out(b) for b in db.query(models.AiBot).order_by(models.AiBot.created_at).all()]


@router.post("/ai-bots", response_model=schemas.AiBotOut, status_code=status.HTTP_201_CREATED)
def create_bot(
    payload: schemas.AiBotCreate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    name = payload.name.strip().lower()
    if not name:
        raise HTTPException(400, "Name is required")
    if db.query(models.AiBot).filter(models.AiBot.name == name).first():
        raise HTTPException(400, f"Bot '{name}' already exists")
    if payload.provider not in ("openai", "anthropic"):
        raise HTTPException(400, "provider must be 'openai' or 'anthropic'")

    bot = models.AiBot(
        name=name,
        display_name=payload.display_name or name,
        provider=payload.provider,
        api_key=payload.api_key,
        model=payload.model,
        system_prompt=payload.system_prompt,
        context_count=max(1, min(50, payload.context_count)),
        enabled=payload.enabled,
        created_by=current_user.username,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return _to_out(bot)


@router.put("/ai-bots/{bot_id}", response_model=schemas.AiBotOut)
def update_bot(
    bot_id: int,
    payload: schemas.AiBotUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    bot = db.query(models.AiBot).filter(models.AiBot.id == bot_id).first()
    if not bot:
        raise HTTPException(404, "Bot not found")

    if payload.display_name is not None:
        bot.display_name = payload.display_name
    if payload.provider is not None:
        if payload.provider not in ("openai", "anthropic"):
            raise HTTPException(400, "provider must be 'openai' or 'anthropic'")
        bot.provider = payload.provider
    if payload.api_key:           # only update if non-empty
        bot.api_key = payload.api_key
    if payload.model is not None:
        bot.model = payload.model
    if payload.system_prompt is not None:
        bot.system_prompt = payload.system_prompt
    if payload.context_count is not None:
        bot.context_count = max(1, min(50, payload.context_count))
    if payload.enabled is not None:
        bot.enabled = payload.enabled

    db.commit()
    db.refresh(bot)
    return _to_out(bot)


@router.delete("/ai-bots/{bot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bot(
    bot_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    bot = db.query(models.AiBot).filter(models.AiBot.id == bot_id).first()
    if not bot:
        raise HTTPException(404, "Bot not found")
    db.delete(bot)
    db.commit()
