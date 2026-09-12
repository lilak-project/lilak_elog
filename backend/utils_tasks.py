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

from datetime import datetime, timedelta, timezone

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


def clear_confirmation(entry: models.LogEntry, db: Session) -> None:
    """Drop a previous confirmation from `entry`. No-op if it has none.

    confirm_log_entry writes a PAIR — 'confirmed' plus the reviewer's username —
    so undoing it has to take both; leaving the bare username behind is only a
    different kind of stale mark. The username is matched against the user table
    so a tag that merely looks like one is left alone, and only ever when
    'confirmed' is present, which is the one way that pair gets written.
    """
    names = {t.name for t in entry.tags}
    if "confirmed" not in names:
        return
    reviewers = {r[0].lower() for r in db.query(models.User.username).all() if r[0]}
    drop = {"confirmed"} | (names & reviewers)
    entry.tags = [t for t in entry.tags if t.name not in drop]


def add_confirmation_required(entry: models.LogEntry, db: Session) -> None:
    """Mark a task log as awaiting review. Idempotent.

    Also clears any previous confirmation. Every caller reaches here because the
    log has just been (re-)filled with fresh machine values, and the review that
    passed the OLD values says nothing about ones nobody has looked at. Without
    this, a recurring service task — refilled on its interval hours after a
    shifter confirmed it — ended up wearing '#confirm' and '#confirmed' at the
    same time, each contradicting the other.
    """
    clear_confirmation(entry, db)
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

def format_owner(fmt, db) -> "models.Service | None":
    """The service a log format belongs to — by the SAME rule everywhere.

    There are two links, and they disagreed. A SYSTEM gets the FK columns
    (system_id/subsystem_id) filled by seed_formats; a plain SERVICE registered by
    handshake is linked only through the service_formats association, leaving those
    FKs NULL. routes/formats._to_out already preferred the association, but the task
    chain below still read the FKs alone — so a monitoring service's format could
    never be spawned as a task, and setting its task_type appeared to do nothing.
    """
    try:
        if fmt.services:
            # Sorted, not services[0]: association order is not guaranteed, and a
            # format wrongly linked to TWO services (it happens — a stray link in
            # KO2520 tied "Actuator Monitoring log" to both Actuator Monitoring and
            # MTE) would otherwise resolve to a different owner on different calls
            # and fire the webhook at the wrong service half the time.
            return sorted(fmt.services, key=lambda s: s.id)[0]
    except Exception:
        pass
    ref = (fmt.system_id or fmt.subsystem_id) if fmt else None
    return db.query(models.Service).filter(models.Service.id == ref).first() if ref else None


def system_run_number(fmt: models.LogFormat, db: Session) -> int | None:
    """The run number the format's own system is on, or None if it has none.

    A named system runs its own counter: MTE was on 392 while the experiment
    was on run 142. It files its own Start/End logs with that counter, so the
    answer is already in the logbook — the most recent run number on any of
    that system's formats.

    This is what `spawn_task_logs` needs when it hangs an MTE task off a GANIL
    run. Stamping the parent's 142 would claim the wrong run; leaving it blank,
    which is what it used to do, threw away a number the logbook already knew
    and left the entry with no run at all.
    """
    system_id = getattr(fmt, "system_id", None)
    subsystem_id = getattr(fmt, "subsystem_id", None)
    if system_id is None and subsystem_id is None:
        return None

    family = db.query(models.LogFormat.id)
    if system_id is not None:
        family = family.filter(models.LogFormat.system_id == system_id)
    else:
        family = family.filter(models.LogFormat.subsystem_id == subsystem_id)
    ids = [row[0] for row in family.all()]
    if not ids:
        return None

    last = (db.query(models.LogEntry)
              .filter(models.LogEntry.format_id.in_(ids),
                      models.LogEntry.run_number.isnot(None),
                      models.LogEntry.run_number_type == "single",
                      models.LogEntry.is_deleted == False)          # noqa: E712
              .order_by(models.LogEntry.created_at.desc(),
                        models.LogEntry.id.desc())
              .first())
    return last.run_number if last else None


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

    # "Owned by a service" means either link — see format_owner. Without the
    # `.services.any()` arm a plain service's format was invisible here.
    siblings = (
        db.query(models.LogFormat)
          .filter(models.LogFormat.task_type == parent_fmt.task_type,
                  models.LogFormat.id        != parent_fmt.id,
                  (models.LogFormat.system_id.isnot(None) |
                   models.LogFormat.subsystem_id.isnot(None) |
                   models.LogFormat.services.any()))
          .all()
    )

    spawned: list[models.LogEntry] = []
    for sib in siblings:
        owner = format_owner(sib, db)
        # A SYSTEM files its own Start/End — that is what `is_system` means here
        # ("your program PUSHES logs to elog"). Spawning a task for it as well
        # produced two rows for the same boundary: MTE's own "Run 395" push and
        # an identical task hanging off the main run. Only pull services, the
        # ones elog has to ask, get a task.
        if owner is not None and owner.is_system:
            continue
        svc_name = owner.name if owner else "system"

        from database import next_log_index
        next_log_idx = next_log_index(db)
        # A NAMED system's format (Start of MTE run) carries that subsystem's own
        # run counter, not the experiment's — MTE was on 390 while the run was 140.
        # Stamping the parent's number on it claimed the wrong run for the entry and
        # made the logbook show two different meanings of "run 140".
        # spawn_template_tasks has always applied this rule; this path had not.
        own_run = sib.system_id is not None or sib.subsystem_id is not None
        # Its own counter, not the parent's — and not nothing, which is what
        # this used to leave behind.
        sib_run = system_run_number(sib, db) if own_run else None
        next_run_idx = None
        if (not own_run) and parent.run_number is not None and (parent.run_number_type or "single") == "single":
            prior = (
                db.query(func.count(models.LogEntry.id))
                  .filter(models.LogEntry.run_number      == parent.run_number,
                          models.LogEntry.run_number_type == "single",
                          models.LogEntry.is_deleted      == False)            # noqa: E712
                  .scalar() or 0
            )
            next_run_idx = prior + 1

        ctx_beam, ctx_target = context_from(parent, db)
        child = models.LogEntry(
            log_index=next_log_idx,
            run_log_index=next_run_idx,
            beam=ctx_beam,
            target=ctx_target,
            title=svc_name,
            body="",
            author_id=None,
            author_name=svc_name,
            run_number=sib_run if own_run else parent.run_number,
            run_number_type=("single" if own_run else (parent.run_number_type or "single")),
            run_number_text=None if own_run else parent.run_number_text,
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

        # The child is itself a system's run log, and that log has its own task
        # template — the monitoring services MTE wants read at the start of a
        # run. Filed directly by MTE those came along; reached this way, as a
        # task of somebody else's run, they did not, and the run went unread.
        # A system brings its own sub-tasks wherever it is called from.
        if sib.task_template_json:
            spawned.extend(spawn_template_tasks(child, sib, db))

    return spawned


def inherit_context(db: Session) -> tuple:
    """The beam and target in force right now — the latest non-empty value of each.

    Both are STICKY by design: set once, and every log after them belongs to that
    beam and target until somebody changes it. Only create_log knew that, so a log
    typed by hand carried them while every task log spawned beside it came out
    blank — the run's own monitoring readings did not record what beam they were
    taken with, which is most of what makes them worth keeping.
    """
    def latest(field):
        row = (db.query(getattr(models.LogEntry, field))
                 .filter(getattr(models.LogEntry, field).isnot(None),
                         getattr(models.LogEntry, field) != "",
                         models.LogEntry.is_deleted == False)          # noqa: E712
                 .order_by(models.LogEntry.id.desc()).first())
        return row[0] if row else None
    return latest("beam"), latest("target")


def context_from(parent, db: Session) -> tuple:
    """A child task's beam/target: its parent's, or the sticky value when the
    parent predates this and has none of its own."""
    beam, target = getattr(parent, "beam", None), getattr(parent, "target", None)
    if beam and target:
        return beam, target
    sticky_beam, sticky_target = inherit_context(db)
    return beam or sticky_beam, target or sticky_target


def _due_at(item: dict):
    """When a template item's first reading may be taken, or None for 'now'."""
    try:
        delay = int(item.get("delay_min") or 0)
    except (TypeError, ValueError):
        return None
    if delay <= 0:
        return None
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=delay)


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
    _ctx = context_from(parent, db)   # every child of this log shares its beam/target
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
                beam=_ctx[0],
                target=_ctx[1],
                source=f"module:{module_id}",
                is_auto=True,
                parent_log_id=parent.id,
                task_status="pending",     # filled by the refresh loop's first tick
                task_module=module_id,
                task_interval_min=item.get("interval_min"),
                task_due_at=_due_at(item),
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
                beam=_ctx[0],
                target=_ctx[1],
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
            on_start = item.get("on_start", True)
            on_end = bool(item.get("on_end", False))
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
                beam=_ctx[0],
                target=_ctx[1],
                source=f"service:{svc.name}",
                is_auto=True,
                parent_log_id=parent.id,
                # on_start → 'pending' so the refresh loop fills it at the run's
                # start; otherwise 'filled' (empty) so it's only filled later by
                # the interval and/or the end-of-run hook.
                task_status="pending" if on_start else "filled",
                task_service_id=svc.id,
                task_interval_min=item.get("interval_min"),
                task_due_at=_due_at(item),
                # remember the end-of-run trigger so create_log can re-fill it.
                metadata_json=json.dumps({"on_end": True}) if on_end else None,
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
            if not fmt:
                return
            svc = format_owner(fmt, sess)
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
