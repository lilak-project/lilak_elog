"""
Module routes — manage built-in elog modules.

GET  /modules               — list all available modules with current enabled/interval state
PATCH /modules/{id}         — update enabled/interval (manager only)
POST  /modules/{id}/collect — run collect() once and return raw data (no log written)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from auth import require_manager
from database import get_db
from module_runner import REGISTRY

router = APIRouter(tags=["modules"])


def _module_out(mod_cls, db_row: models.Module | None) -> schemas.ModuleOut:
    return schemas.ModuleOut(
        id=mod_cls.id,
        name=mod_cls.name,
        description=mod_cls.description,
        default_interval_sec=mod_cls.default_interval_sec,
        enabled=db_row.enabled if db_row else False,
        interval_sec=db_row.interval_sec if db_row else mod_cls.default_interval_sec,
    )


@router.get("/modules", response_model=list[schemas.ModuleOut])
def list_modules(db: Session = Depends(get_db)):
    """List all available built-in modules with their current state."""
    rows = {r.id: r for r in db.query(models.Module).all()}
    return [_module_out(cls, rows.get(cls.id)) for cls in REGISTRY]


@router.patch("/modules/{module_id}", response_model=schemas.ModuleOut)
def update_module(
    module_id: str,
    payload: schemas.ModuleUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Enable/disable a module or change its interval (manager only)."""
    mod_cls = next((m for m in REGISTRY if m.id == module_id), None)
    if mod_cls is None:
        raise HTTPException(status_code=404, detail=f"Module '{module_id}' not found")

    row = db.query(models.Module).filter(models.Module.id == module_id).first()
    if row is None:
        row = models.Module(
            id=module_id,
            enabled=False,
            interval_sec=mod_cls.default_interval_sec,
        )
        db.add(row)

    if payload.enabled is not None:
        row.enabled = payload.enabled
    if payload.interval_sec is not None:
        if payload.interval_sec < 5:
            raise HTTPException(status_code=400, detail="interval_sec must be >= 5")
        row.interval_sec = payload.interval_sec

    db.commit()
    db.refresh(row)
    return _module_out(mod_cls, row)


@router.post("/modules/{module_id}/collect")
async def collect_module(
    module_id: str,
    _: models.User = Depends(require_manager),
):
    """Run collect() once and return the raw data dict. No log is written.
    Used by the UI for the live Realtime display."""
    from module_runner import _instances
    mod = _instances.get(module_id)
    if mod is None:
        raise HTTPException(status_code=404, detail=f"Module '{module_id}' not found")
    data = await mod.collect()
    return data


@router.post("/modules/{module_id}/log")
async def log_module_now(
    module_id: str,
    _: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Run collect() once and immediately write a log entry. Returns the new log id."""
    from module_runner import _instances, _ensure_module_format, _now
    import json
    from sqlalchemy import func

    mod_cls = next((m for m in REGISTRY if m.id == module_id), None)
    if mod_cls is None:
        raise HTTPException(status_code=404, detail=f"Module '{module_id}' not found")

    mod = _instances.get(module_id)
    if mod is None:
        raise HTTPException(status_code=404, detail=f"Module '{module_id}' not running")

    data = await mod.collect()
    fmt_id = _ensure_module_format(mod, db)

    from database import next_log_index
    next_idx = next_log_index(db)
    title = f"[{mod.name}] {', '.join(f'{k}={v}' for k, v in data.items())}"

    if fmt_id is not None:
        fields_json = json.dumps({
            k: {"value": v, "error": 0} if isinstance(v, (int, float)) else v
            for k, v in data.items()
        })
        body = None
    else:
        fields_json = None
        body = "\n".join(f"{k}: {v}" for k, v in data.items())

    entry = models.LogEntry(
        log_index=next_idx,
        title=title,
        body=body,
        format_id=fmt_id,
        format_fields_json=fields_json,
        author_id=None,
        author_name=f"<module:{module_id}>",
        level="info",
        source=f"module:{module_id}",
        is_auto=True,
        metadata_json=json.dumps({"module_id": module_id, "data": data}),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "log_index": entry.log_index, "data": data}
