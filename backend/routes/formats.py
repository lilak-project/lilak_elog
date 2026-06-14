"""
Log format (template) CRUD routes.
Managers can create / edit / delete formats.
Anyone can list them (needed by LogForm).
"""

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

import models
import schemas
from auth import require_manager
from database import get_db

router = APIRouter(tags=["formats"])


def _to_out(fmt: models.LogFormat, db: Session = None) -> schemas.LogFormatOut:
    try:
        fields = [schemas.FormatField(**f) for f in json.loads(fmt.fields_json)]
    except Exception:
        fields = []
    # Resolve the owning service name for UI grouping
    system_name = None
    owner_kind = None
    # Resolve the owning service. Prefer the many-to-many association
    # (service_formats), since a non-system service links its format only via
    # that table (system_id/subsystem_id stay NULL). Fall back to the FK columns.
    owner_svc = None
    try:
        if fmt.services:
            owner_svc = fmt.services[0]
    except Exception:
        owner_svc = None
    if owner_svc is None:
        sys_id = fmt.system_id or fmt.subsystem_id
        if sys_id and db:
            owner_svc = db.query(models.Service).filter(models.Service.id == sys_id).first()
    if owner_svc:
        system_name = owner_svc.name
        owner_kind = "system" if owner_svc.is_system else "service"
    elif (fmt.created_by and fmt.created_by.startswith("<module:")) or (fmt.name or "").startswith("[module]"):
        system_name = fmt.created_by or fmt.name  # keep module tag/name
        owner_kind = "module"
    return schemas.LogFormatOut(
        id=fmt.id,
        name=fmt.name,
        fields=fields,
        is_default=fmt.is_default,
        notify_community=fmt.notify_community,
        format_type=fmt.format_type or "user",
        task_type=fmt.task_type,
        run_type_lock=fmt.run_type_lock,
        subsystem_id=fmt.subsystem_id,
        system_id=fmt.system_id,
        system_name=system_name,
        owner_kind=owner_kind,
        created_at=fmt.created_at,
        created_by=fmt.created_by,
    )


@router.get("/formats", response_model=list[schemas.LogFormatOut])
def list_formats(db: Session = Depends(get_db)):
    """Return all formats, default first."""
    fmts = (
        db.query(models.LogFormat)
        .options(selectinload(models.LogFormat.services))
        .order_by(models.LogFormat.is_default.desc(), models.LogFormat.created_at)
        .all()
    )
    return [_to_out(f, db) for f in fmts]


@router.post("/formats", response_model=schemas.LogFormatOut, status_code=status.HTTP_201_CREATED)
def create_format(
    payload: schemas.LogFormatCreate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if payload.is_default:
        db.query(models.LogFormat).filter(models.LogFormat.is_default == True).update(
            {"is_default": False}
        )
    fmt = models.LogFormat(
        name=payload.name,
        fields_json=json.dumps([f.model_dump() for f in payload.fields]),
        is_default=payload.is_default,
        notify_community=payload.notify_community,
        format_type=payload.format_type or "user",
        task_type=payload.task_type,
        run_type_lock=payload.run_type_lock,
        created_by=current_user.username,
    )
    db.add(fmt)
    db.commit()
    db.refresh(fmt)
    return _to_out(fmt, db)


@router.put("/formats/{fmt_id}", response_model=schemas.LogFormatOut)
def update_format(
    fmt_id: int,
    payload: schemas.LogFormatUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    fmt = db.query(models.LogFormat).filter(models.LogFormat.id == fmt_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    # System / service / module formats are auto-managed and not editable.
    out = _to_out(fmt, db)
    if out.owner_kind in ("system", "service", "module"):
        raise HTTPException(
            status_code=403,
            detail=f"This format is managed by its {out.owner_kind} and cannot be edited.",
        )
    if payload.name is not None:
        fmt.name = payload.name
    if payload.fields is not None:
        fmt.fields_json = json.dumps([f.model_dump() for f in payload.fields])
    if payload.is_default is not None:
        if payload.is_default:
            db.query(models.LogFormat).filter(
                models.LogFormat.id != fmt_id, models.LogFormat.is_default == True
            ).update({"is_default": False})
        fmt.is_default = payload.is_default
    if payload.notify_community is not None:
        fmt.notify_community = payload.notify_community
    if payload.format_type is not None:
        fmt.format_type = payload.format_type
    if payload.task_type is not None:
        # Empty string clears the task type (DB stores NULL).
        fmt.task_type = payload.task_type or None
    if payload.run_type_lock is not None:
        fmt.run_type_lock = payload.run_type_lock or None
    db.commit()
    db.refresh(fmt)
    return _to_out(fmt, db)


@router.delete("/formats/{fmt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_format(
    fmt_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    fmt = db.query(models.LogFormat).filter(models.LogFormat.id == fmt_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    db.delete(fmt)
    db.commit()
