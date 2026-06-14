"""
Module runner — background scheduler for built-in elog modules.

On startup, reads enabled modules from the DB, then for each enabled module
runs collect() every interval_sec and posts a log entry internally.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from modules.net_speed import NetSpeedModule
from modules.base import ModuleBase

logger = logging.getLogger(__name__)

# ── Module registry ───────────────────────────────────────────────────────────
# All built-in module classes registered here.
REGISTRY: list = [
    NetSpeedModule,
]

# Instantiated module objects (keyed by id)
_instances: dict[str, object] = {cls.id: cls() for cls in REGISTRY}

# asyncio tasks currently running (keyed by module id)
_tasks: dict[str, asyncio.Task] = {}


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ensure_module_format(mod: ModuleBase, db) -> int | None:
    """Find or create a LogFormat for a module that declares fields.
    The format always includes: title, run (builtin), then the module's
    custom metric fields, then level (builtin).
    Returns the format id, or None if the module has no fields."""
    import models

    if not mod.fields:
        return None

    format_name = f"[module] {mod.name}"

    existing = db.query(models.LogFormat).filter(
        models.LogFormat.name == format_name
    ).first()
    if existing:
        return existing.id

    # Build fields_json — builtin fields + module custom fields
    format_fields = [
        {"key": "title", "label": "Title",  "field_type": "builtin", "builtin_id": "title", "required": False, "order": 0},
        {"key": "run",   "label": "Run",    "field_type": "builtin", "builtin_id": "run",   "required": False, "order": 1},
    ]
    for i, f in enumerate(mod.fields):
        format_fields.append({
            "key": f["key"],
            "label": f["label"],
            "field_type": "custom",
            "builtin_id": None,
            "custom_type": f.get("type", "number"),
            "unit": f.get("unit", ""),
            "required": False,
            "order": 2 + i,
        })
    format_fields.append(
        {"key": "level", "label": "Level", "field_type": "builtin", "builtin_id": "level", "required": False, "order": 2 + len(mod.fields)},
    )

    new_format = models.LogFormat(
        name=format_name,
        fields_json=json.dumps(format_fields),
        created_at=_now(),
    )
    db.add(new_format)
    db.flush()  # get the id
    return new_format.id


async def _run_module_loop(module_id: str) -> None:
    """Infinite loop for one module: collect → write log, sleep interval."""
    from database import SessionLocal
    import models

    mod = _instances[module_id]
    while True:
        try:
            # Read current config from DB on each cycle (supports live changes)
            db = SessionLocal()
            try:
                row = db.query(models.Module).filter(models.Module.id == module_id).first()
                if row is None or not row.enabled:
                    # Module was disabled — stop this loop
                    logger.info(f"[module:{module_id}] disabled, stopping loop")
                    return
                interval = max(5, row.interval_sec)
            finally:
                db.close()

            # Collect metrics
            data = await mod.collect()

            # Write a log entry
            db = SessionLocal()
            try:
                from database import next_log_index
                next_idx = next_log_index(db)

                # Auto-create a LogFormat for this module if it declares fields
                fmt_id = _ensure_module_format(mod, db)

                # Build a human-readable title summary
                title = f"[{mod.name}] {', '.join(f'{k}={v}' for k, v in data.items())}"

                # Store metric values in format_fields_json if a format exists,
                # otherwise fall back to body text
                if fmt_id is not None:
                    # Wrap numeric values as {value, error} for number_entry compat
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
                logger.debug(f"[module:{module_id}] logged: {data}")
            except Exception as e:
                logger.error(f"[module:{module_id}] DB write failed: {e}")
            finally:
                db.close()

        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.error(f"[module:{module_id}] collect() error: {e}")
            interval = 60  # fallback sleep on error

        await asyncio.sleep(interval)


async def _run_task_refresh_loop() -> None:
    """Periodically re-fill auto-module task logs that carry an auto-request
    interval. Each due task log re-runs its module's collect() and updates its
    own values in place (no new log row). A task log is "due" when
    updated_at + task_interval_min minutes has passed."""
    from datetime import timedelta
    from sqlalchemy import or_
    from database import SessionLocal
    import models

    TICK_SEC = 20
    while True:
        try:
            db = SessionLocal()
            try:
                now = _now()
                # Only actionable rows: pending first-fills and recurring
                # tasks. Filled one-shots (interval NULL/0) accumulate
                # forever, so they must be excluded in SQL — not in Python —
                # to keep each tick cheap.
                due_tasks = (
                    db.query(models.LogEntry)
                      .filter(
                          or_(models.LogEntry.task_module.isnot(None),
                              models.LogEntry.task_service_id.isnot(None)),
                          models.LogEntry.is_deleted == False,   # noqa: E712
                          or_(models.LogEntry.task_status == "pending",
                              models.LogEntry.task_interval_min > 0),
                      )
                      .all()
                )
                for t in due_tasks:
                    # A template-spawned module task starts 'pending' — fill it
                    # immediately on first sight. Otherwise it must carry an
                    # interval and be past due to be re-filled.
                    is_first_fill = t.task_status == "pending"
                    if not is_first_fill:
                        if not t.task_interval_min or t.task_interval_min <= 0:
                            continue
                        base_time = t.updated_at or t.created_at
                        if base_time + timedelta(minutes=t.task_interval_min) > now:
                            continue

                    # ── Service-backed task: fill by calling request_url ──
                    if t.task_service_id is not None:
                        svc = db.query(models.Service).filter(
                            models.Service.id == t.task_service_id).first()
                        if svc is None or not svc.request_url:
                            continue
                        try:
                            from utils_webhook import fill_task_via_webhook
                            ok, msg = fill_task_via_webhook(t, svc, db)
                            if ok:
                                t.task_status = "filled"
                                t.updated_at = _now()
                                logger.debug(f"[task_refresh] filled task #{t.id} via service {svc.name}")
                            else:
                                logger.error(f"[task_refresh] service {svc.name} fill failed: {msg}")
                        except Exception as e:
                            logger.error(f"[task_refresh] service fill error: {e}")
                        continue

                    mod = _instances.get(t.task_module)
                    if mod is None:
                        continue
                    try:
                        data = await mod.collect()
                    except Exception as e:
                        logger.error(f"[task_refresh] {t.task_module} collect failed: {e}")
                        continue
                    fmt_id = _ensure_module_format(mod, db)
                    if fmt_id is not None:
                        t.format_fields_json = json.dumps({
                            k: {"value": v, "error": 0} if isinstance(v, (int, float)) else v
                            for k, v in data.items()
                        })
                    else:
                        t.body = "\n".join(f"{k}: {v}" for k, v in data.items())
                    t.title = f"[{mod.name}] " + ", ".join(f"{k}={v}" for k, v in data.items())
                    t.metadata_json = json.dumps({"module_id": t.task_module, "data": data})
                    t.task_status = "filled"
                    t.updated_at = _now()
                    logger.debug(f"[task_refresh] refreshed task log #{t.id} via {t.task_module}")
                db.commit()
            finally:
                db.close()
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.error(f"[task_refresh] loop error: {e}")
        await asyncio.sleep(TICK_SEC)


async def start_module_runner() -> None:
    """Start background tasks for all currently-enabled modules.
    Called once from main.py lifespan."""
    from database import SessionLocal
    import models

    db = SessionLocal()
    try:
        rows = db.query(models.Module).all()
        enabled = {r.id for r in rows if r.enabled}
    finally:
        db.close()

    for module_id in enabled:
        if module_id in _instances and module_id not in _tasks:
            task = asyncio.create_task(_run_module_loop(module_id))
            _tasks[module_id] = task
            logger.info(f"[module_runner] started module: {module_id}")

    # Always start the task-log refresh loop (handles auto-module task logs).
    if "__task_refresh__" not in _tasks:
        _tasks["__task_refresh__"] = asyncio.create_task(_run_task_refresh_loop())
        logger.info("[module_runner] started task-refresh loop")


def restart_module(module_id: str) -> None:
    """Stop and restart a module's loop (called after config change).
    Safe to call from sync context — schedules via event loop."""
    loop = asyncio.get_event_loop()
    loop.call_soon_threadsafe(_restart_module_async, module_id)


def _restart_module_async(module_id: str) -> None:
    """Cancel existing task and start a new one if module is enabled."""
    if module_id in _tasks:
        _tasks[module_id].cancel()
        del _tasks[module_id]

    from database import SessionLocal
    import models

    db = SessionLocal()
    try:
        row = db.query(models.Module).filter(models.Module.id == module_id).first()
        enabled = row is not None and row.enabled
    finally:
        db.close()

    if enabled and module_id in _instances:
        task = asyncio.ensure_future(_run_module_loop(module_id))
        _tasks[module_id] = task
