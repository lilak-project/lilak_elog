"""Per-experiment settings: public read, manager write."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from auth import require_manager
from database import get_db
from settings_store import PUBLIC_KEYS, set_setting, public_settings

router = APIRouter(tags=["settings"])


@router.get("/settings")
def read_settings(db: Session = Depends(get_db)):
    """Readable by anyone — the app uses these (tab visibility, approval gate)."""
    return public_settings(db)


@router.put("/settings")
def update_settings(
    payload: dict,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    for k, v in payload.items():
        if k in PUBLIC_KEYS:        # ignore unknown keys
            set_setting(db, k, v)
    return public_settings(db)
