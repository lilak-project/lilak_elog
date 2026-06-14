"""
Task-log registration.

From the Experiment tab a manager opens a system/service, picks one of its log
formats, and registers task logs against it. Each registration creates a
"mother" log (from the chosen format) and one child task log per selected item:

  • module item — backed by a built-in auto-fill module (e.g. net_speed).
      Filled immediately by running collect() once. May carry an auto-request
      interval (minutes) so it can be refreshed later. task_status='filled'.

  • format item — a plain log format the user picked, with a title only.
      Created empty (task_status='pending'); a human later presses "Go",
      fills the fields and saves to complete it.

Child logs link to the mother via parent_log_id and render nested beneath it
in the log list.
"""

from __future__ import annotations

import json
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from auth import require_manager
from database import get_db
from module_runner import REGISTRY, _instances, _ensure_module_format, _now

router = APIRouter(tags=["tasks"])


# ── Request models ────────────────────────────────────────────────────────────

class TaskItem(BaseModel):
    kind: Literal["module", "format", "service"]
    # module items
    module_id: Optional[str] = None
    interval_min: Optional[int] = None
    # format items
    format_id: Optional[int] = None
    title: Optional[str] = None
    # service items — auto-filled by calling the service's request_url
    service_id: Optional[int] = None


class RegisterTasksPayload(BaseModel):
    # Either create a new mother (system_id + mother_format_id) OR attach to an
    # existing one (mother_log_id).
    system_id: Optional[int] = None
    mother_format_id: Optional[int] = None
    mother_title: Optional[str] = None
    mother_log_id: Optional[int] = None
    items: list[TaskItem]


def _next_log_index(db: Session) -> int:
    from database import next_log_index
    return next_log_index(db)


@router.post("/tasks/register")
async def register_tasks(
    payload: RegisterTasksPayload,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="No task items provided")

    # Resolve the system service (optional when attaching to an existing mother)
    svc = None
    if payload.system_id is not None:
        svc = db.query(models.Service).filter(models.Service.id == payload.system_id).first()

    # ── 1) Resolve or create the mother log ──
    if payload.mother_log_id is not None:
        mother = (
            db.query(models.LogEntry)
              .filter(models.LogEntry.id == payload.mother_log_id,
                      models.LogEntry.is_deleted == False)              # noqa: E712
              .first()
        )
        if not mother:
            raise HTTPException(status_code=404, detail="Mother log not found")
    else:
        if not svc:
            raise HTTPException(status_code=404, detail="System not found")
        mother_fmt = (
            db.query(models.LogFormat)
              .filter(models.LogFormat.id == payload.mother_format_id)
              .first()
        )
        if not mother_fmt:
            raise HTTPException(status_code=404, detail="Mother format not found")
        mother_title = payload.mother_title or f"{svc.name} — {mother_fmt.name}"
        mother = models.LogEntry(
            log_index=_next_log_index(db),
            title=mother_title,
            body="",
            author_id=current_user.id,
            author_name=current_user.display_name or current_user.username,
            level="info",
            run_type=mother_fmt.run_type_lock,
            format_id=mother_fmt.id,
            source=svc.name,
            is_auto=False,
            created_at=_now(),
            updated_at=_now(),
        )
        db.add(mother)

    # Name used as the source/author for plain task children.
    src_name = svc.name if svc else (mother.source or "system")
    db.flush()   # need mother.id

    created_children: list[models.LogEntry] = []

    # ── 2) Create one child task log per item ──
    for item in payload.items:
        if item.kind == "module":
            mod_cls = next((m for m in REGISTRY if m.id == item.module_id), None)
            if mod_cls is None:
                raise HTTPException(status_code=404, detail=f"Module '{item.module_id}' not found")
            mod = _instances.get(item.module_id)
            if mod is None:
                raise HTTPException(status_code=404, detail=f"Module '{item.module_id}' not running")

            data = await mod.collect()
            fmt_id = _ensure_module_format(mod, db)
            if fmt_id is not None:
                fields_json = json.dumps({
                    k: ({"value": v, "error": 0} if isinstance(v, (int, float)) else v)
                    for k, v in data.items()
                })
                body = None
            else:
                fields_json = None
                body = "\n".join(f"{k}: {v}" for k, v in data.items())

            child = models.LogEntry(
                log_index=_next_log_index(db),
                title=f"[{mod.name}] " + ", ".join(f"{k}={v}" for k, v in data.items()),
                body=body,
                format_id=fmt_id,
                format_fields_json=fields_json,
                author_id=None,
                author_name=f"<module:{item.module_id}>",
                level="info",
                source=f"module:{item.module_id}",
                is_auto=True,
                parent_log_id=mother.id,
                task_status="filled",
                task_module=item.module_id,
                task_interval_min=item.interval_min,
                # Modules carry no run of their own → inherit the mother's run.
                run_number=mother.run_number,
                run_number_type=mother.run_number_type or "single",
                run_number_text=mother.run_number_text,
                metadata_json=json.dumps({"module_id": item.module_id, "data": data}),
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(child)
            db.flush()
            created_children.append(child)

        elif item.kind == "format":
            fmt = (
                db.query(models.LogFormat)
                  .filter(models.LogFormat.id == item.format_id)
                  .first()
            )
            if not fmt:
                raise HTTPException(status_code=404, detail=f"Format {item.format_id} not found")

            # A system-owned format brings its own run number (filled by the
            # system later); everything else inherits the mother's run.
            own_run = fmt.system_id is not None or fmt.subsystem_id is not None
            child = models.LogEntry(
                log_index=_next_log_index(db),
                title=item.title or fmt.name,
                body="",
                format_id=fmt.id,
                author_id=current_user.id,
                author_name=current_user.display_name or current_user.username,
                level="info",
                run_type=fmt.run_type_lock,
                run_number=None if own_run else mother.run_number,
                run_number_type=(mother.run_number_type or "single") if not own_run else "single",
                run_number_text=None if own_run else mother.run_number_text,
                source=src_name,
                is_auto=False,
                parent_log_id=mother.id,
                task_status="pending",
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(child)
            db.flush()
            created_children.append(child)

        elif item.kind == "service":
            from routes.services import _pick_format_id
            from utils_webhook import fill_task_via_webhook
            svc_t = (
                db.query(models.Service)
                  .filter(models.Service.id == item.service_id)
                  .first()
            )
            if not svc_t:
                raise HTTPException(status_code=404, detail=f"Service {item.service_id} not found")
            if not svc_t.request_url:
                raise HTTPException(status_code=400, detail=f"Service '{svc_t.name}' has no request_url")

            svc_fmt_id = _pick_format_id(svc_t, None)
            child = models.LogEntry(
                log_index=_next_log_index(db),
                title=item.title or svc_t.name,
                body="",
                format_id=svc_fmt_id,
                author_id=None,
                author_name=f"<service:{svc_t.name}>",
                level="info",
                run_number=mother.run_number,
                run_number_type=mother.run_number_type or "single",
                run_number_text=mother.run_number_text,
                source=f"service:{svc_t.name}",
                is_auto=True,
                parent_log_id=mother.id,
                task_status="pending",
                task_service_id=svc_t.id,
                task_interval_min=item.interval_min,
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(child)
            db.flush()
            # Fill immediately from the service (best-effort; failure leaves it
            # pending for the refresh loop / manual fill).
            try:
                ok, _msg = fill_task_via_webhook(child, svc_t, db)
                if ok:
                    child.task_status = "filled"
            except Exception:
                db.rollback()
            created_children.append(child)

    db.commit()
    db.refresh(mother)

    return {
        "mother_id": mother.id,
        "mother_log_index": mother.log_index,
        "child_ids": [c.id for c in created_children],
    }


class TaskTemplatePayload(BaseModel):
    items: list[TaskItem]


@router.get("/formats/{format_id}/task-template")
def get_task_template(format_id: int, db: Session = Depends(get_db)):
    """Return the task template configured on a log format."""
    fmt = db.query(models.LogFormat).filter(models.LogFormat.id == format_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    if not fmt.task_template_json:
        return {"items": []}
    try:
        return {"items": json.loads(fmt.task_template_json)}
    except Exception:
        return {"items": []}


@router.put("/formats/{format_id}/task-template")
def set_task_template(
    format_id: int,
    payload: TaskTemplatePayload,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Replace the task template on a log format. Future logs of this format
    will spawn these task logs automatically."""
    fmt = db.query(models.LogFormat).filter(models.LogFormat.id == format_id).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    items = [it.model_dump(exclude_none=True) for it in payload.items]
    fmt.task_template_json = json.dumps(items) if items else None
    db.commit()
    return {"items": items}


@router.get("/tasks/{mother_id}/children")
def list_task_children(mother_id: int, db: Session = Depends(get_db)):
    """List the task logs attached to a mother log (for the manage UI)."""
    rows = (
        db.query(models.LogEntry)
          .filter(models.LogEntry.parent_log_id == mother_id,
                  models.LogEntry.is_deleted == False)                  # noqa: E712
          .order_by(models.LogEntry.id.asc())
          .all()
    )
    return [
        {
            "id": r.id,
            "log_index": r.log_index,
            "title": r.title,
            "task_status": r.task_status,
            "task_module": r.task_module,
            "task_service_id": r.task_service_id,
            "task_interval_min": r.task_interval_min,
        }
        for r in rows
    ]


@router.delete("/tasks/{task_id}", status_code=204)
def remove_task(
    task_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Remove a registered task log (soft delete). Only acts on actual task
    logs (those with a parent)."""
    entry = db.query(models.LogEntry).filter(models.LogEntry.id == task_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Task log not found")
    if entry.parent_log_id is None:
        raise HTTPException(status_code=400, detail="Not a task log")
    entry.is_deleted = True
    entry.deleted_at = _now()
    entry.deleted_by = current_user.username
    db.commit()
