"""
Phase 6 — task log spawning + confirmation tag system.

Two responsibilities:

1) `spawn_task_logs(parent, parent_fmt, db)` — when a Start-of-run /
   End-of-run / Monitoring run log is created with a format that has
   `task_type` set, spawn an empty *task log* for every subsystem-owned
   format sharing the same `task_type`. Each task log:
       • links back to the parent via `parent_log_id`
       • inherits run_number / run_number_type from the parent
       • uses the format's locked run_type (S/E/M)
       • starts blank — to be filled later by webhook (Phase 7) or a shifter

2) Confirmation tags — for tasks that were auto-filled by a system,
   we attach the tag `"confirmation required"` so a human knows to
   sanity-check the values. The Confirm action then:
       • removes  `"confirmation required"`
       • adds     `"confirmed by <username>"`
   so the audit trail is preserved in the regular tag system.
"""

from __future__ import annotations

import models
from sqlalchemy import func
from sqlalchemy.orm import Session


# ── Confirmation tag constants ───────────────────────────────────────────────

TAG_CONFIRMATION_REQUIRED = "confirmation required"
TAG_CONFIRMED_BY_PREFIX   = "confirmed by "   # full tag = "confirmed by alice"


def _get_or_create_tag(name: str, db: Session) -> models.Tag:
    name = name.strip().lower()
    tag = db.query(models.Tag).filter(models.Tag.name == name).first()
    if tag is None:
        tag = models.Tag(name=name)
        db.add(tag)
        db.flush()
    return tag


def add_confirmation_required(entry: models.LogEntry, db: Session) -> None:
    """Attach the 'confirmation required' tag to a task log. Idempotent."""
    tag = _get_or_create_tag(TAG_CONFIRMATION_REQUIRED, db)
    if tag not in entry.tags:
        entry.tags.append(tag)


def remove_confirmation_required(entry: models.LogEntry, db: Session) -> None:
    """Drop the 'confirmation required' tag if present."""
    req_tag = (
        db.query(models.Tag)
          .filter(models.Tag.name == TAG_CONFIRMATION_REQUIRED)
          .first()
    )
    if req_tag and req_tag in entry.tags:
        entry.tags.remove(req_tag)


def confirm_log_entry(entry: models.LogEntry, user: models.User, db: Session) -> None:
    """Confirm: remove 'confirmation required', then add two tags — 'confirmed'
    and the reviewer's username (e.g. #confirmed #alice)."""
    remove_confirmation_required(entry, db)
    for name in ("confirmed", user.username):
        tg = _get_or_create_tag(name, db)
        if tg not in entry.tags:
            entry.tags.append(tg)


# ── Task spawning ────────────────────────────────────────────────────────────

def spawn_task_logs(parent: models.LogEntry,
                    parent_fmt: models.LogFormat,
                    db: Session) -> list[models.LogEntry]:
    """Spawn child task logs when a Start/End/Monitoring parent log is filed.

    Only spawns system-owned formats with the same task_type as the parent.
    Doesn't spawn anything when the parent itself is a system format (i.e.
    when a system is pushing its own log directly).
    """
    if not parent_fmt or not parent_fmt.task_type:
        return []

    # If the "parent" is itself a system-owned format, don't recurse —
    # it IS the child. Only the canonical (system_id IS NULL) format
    # acts as the root that spawns children.
    if parent_fmt.system_id is not None or parent_fmt.subsystem_id is not None:
        return []

    siblings = (
        db.query(models.LogFormat)
          .filter(models.LogFormat.task_type == parent_fmt.task_type,
                  models.LogFormat.id        != parent_fmt.id,
                  (models.LogFormat.system_id.isnot(None) |
                   models.LogFormat.subsystem_id.isnot(None)))
          .all()
    )

    spawned: list[models.LogEntry] = []
    for sib in siblings:
        svc_name = "system"
        svc_ref_id = sib.system_id or sib.subsystem_id
        if svc_ref_id:
            svc = (
                db.query(models.Service)
                  .filter(models.Service.id == svc_ref_id)
                  .first()
            )
            if svc:
                svc_name = svc.name

        from database import next_log_index
        next_log_idx = next_log_index(db)
        next_run_idx = None
        if parent.run_number is not None and (parent.run_number_type or "single") == "single":
            prior = (
                db.query(func.count(models.LogEntry.id))
                  .filter(models.LogEntry.run_number      == parent.run_number,
                          models.LogEntry.run_number_type == "single",
                          models.LogEntry.is_deleted      == False)            # noqa: E712
                  .scalar() or 0
            )
            next_run_idx = prior + 1

        child = models.LogEntry(
            log_index=next_log_idx,
            run_log_index=next_run_idx,
            title=svc_name,
            body="",
            author_id=None,
            author_name=svc_name,
            run_number=parent.run_number,
            run_number_type=parent.run_number_type or "single",
            run_number_text=parent.run_number_text,
            run_type=sib.run_type_lock or parent.run_type,
            level="info",
            format_id=sib.id,
            parent_log_id=parent.id,
            source="task",
            is_auto=True,
        )
        db.add(child)
        db.flush()
        spawned.append(child)

    return spawned


# ── Per-format task templates ─────────────────────────────────────────────────

def spawn_template_tasks(parent: models.LogEntry,
                         parent_fmt: models.LogFormat,
                         db: Session) -> list[models.LogEntry]:
    """Spawn child task logs from the parent format's `task_template_json`.

    Runs on every log filed with a format that has a template. Each item:
      • module  — child carries task_module + task_interval_min and starts as
                  'pending'; the background refresh loop fills it (immediately
                  on the next tick, then re-fills on its interval).
      • format  — a plain pending task log with just a title, to be filled by a
                  human via the "Go" button.
    """
    import json

    if not parent_fmt or not parent_fmt.task_template_json:
        return []
    try:
        items = json.loads(parent_fmt.task_template_json)
    except Exception:
        return []
    if not items:
        return []

    def _next_idx() -> int:
        from database import next_log_index
        return next_log_index(db)

    spawned: list[models.LogEntry] = []
    for item in items:
        kind = item.get("kind")
        if kind == "module":
            module_id = item.get("module_id")
            if not module_id:
                continue
            child = models.LogEntry(
                log_index=_next_idx(),
                title=f"[{module_id}]",
                body="",
                author_id=None,
                author_name=f"<module:{module_id}>",
                run_number=parent.run_number,
                run_number_type=parent.run_number_type or "single",
                run_number_text=parent.run_number_text,
                level="info",
                source=f"module:{module_id}",
                is_auto=True,
                parent_log_id=parent.id,
                task_status="pending",     # filled by the refresh loop's first tick
                task_module=module_id,
                task_interval_min=item.get("interval_min"),
            )
            db.add(child)
            db.flush()
            spawned.append(child)
        elif kind == "format":
            fmt_id = item.get("format_id")
            fmt = (
                db.query(models.LogFormat).filter(models.LogFormat.id == fmt_id).first()
                if fmt_id else None
            )
            # System-owned formats bring their own run number; others inherit
            # the mother (parent) log's run number.
            own_run = bool(fmt and (fmt.system_id is not None or fmt.subsystem_id is not None))
            child = models.LogEntry(
                log_index=_next_idx(),
                title=item.get("title") or (fmt.name if fmt else "task"),
                body="",
                author_id=parent.author_id,
                author_name=parent.author_name,
                run_number=None if own_run else parent.run_number,
                run_number_type=(parent.run_number_type or "single") if not own_run else "single",
                run_number_text=None if own_run else parent.run_number_text,
                level="info",
                run_type=fmt.run_type_lock if fmt else None,
                format_id=fmt_id,
                source=parent.source,
                is_auto=False,
                parent_log_id=parent.id,
                task_status="pending",
            )
            db.add(child)
            db.flush()
            spawned.append(child)
        elif kind == "service":
            from routes.services import _pick_format_id
            svc_id = item.get("service_id")
            svc = (
                db.query(models.Service).filter(models.Service.id == svc_id).first()
                if svc_id else None
            )
            if not svc:
                continue
            child = models.LogEntry(
                log_index=_next_idx(),
                title=item.get("title") or svc.name,
                body="",
                author_id=None,
                author_name=f"<service:{svc.name}>",
                run_number=parent.run_number,
                run_number_type=parent.run_number_type or "single",
                run_number_text=parent.run_number_text,
                level="info",
                format_id=_pick_format_id(svc, None),
                source=f"service:{svc.name}",
                is_auto=True,
                parent_log_id=parent.id,
                task_status="pending",     # filled by the refresh loop's first tick
                task_service_id=svc.id,
                task_interval_min=item.get("interval_min"),
            )
            db.add(child)
            db.flush()
            spawned.append(child)

    return spawned


# ── Phase 7: background webhook fetcher for freshly-spawned tasks ───────────

def fire_webhook_fills(child_ids: list[int]) -> None:
    """Kick off background webhook calls for each child task whose service
    has a `request_url`. Each call runs in its own thread with its own DB
    session so the parent request doesn't wait on them."""
    if not child_ids:
        return

    import threading
    from database import SessionLocal
    from utils_webhook import fill_task_via_webhook

    def _worker(log_id: int):
        sess = SessionLocal()
        try:
            child = sess.query(models.LogEntry).filter(
                models.LogEntry.id == log_id).first()
            if not child or not child.format_id:
                return
            fmt = sess.query(models.LogFormat).filter(
                models.LogFormat.id == child.format_id).first()
            svc_ref_id = (fmt.system_id or fmt.subsystem_id) if fmt else None
            if not fmt or not svc_ref_id:
                return
            svc = sess.query(models.Service).filter(
                models.Service.id == svc_ref_id).first()
            if not svc or not svc.request_url:
                # No request_url → leave the task empty for manual fill.
                return
            fill_task_via_webhook(child, svc, sess)
        except Exception as e:
            print(f"[webhook:{log_id}] worker crashed: {e}", flush=True)
        finally:
            sess.close()

    for cid in child_ids:
        threading.Thread(target=_worker, args=(cid,), daemon=True).start()
