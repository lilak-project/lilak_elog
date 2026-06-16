"""
Phase 3 — built-in log format seeding + system auto-format management.

Two responsibilities:

1) `seed_default_formats(db)` — runs once per fresh experiment DB and creates
   the four canonical formats the rest of the system assumes exist:
        Standard log         — every builtin field, marked default
        Start of run log     — run(S) + title + body, task_type=start_of_run
        End of run log       — run(E) + body,         task_type=end_of_run
        Monitoring run log   — run(M) + title + body, task_type=monitoring_run

2) `sync_system_formats(svc, db)` — keeps a system's three S/E/M
   formats in sync with the service's current name. Idempotent.
        Start of {Name} run     — subsystem_run(S) + title + body
        End of {Name} run       — subsystem_run(E) + body
        Monitoring {Name} run   — subsystem_run(M) + title + body
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.orm import Session

import models


# ── helpers ──────────────────────────────────────────────────────────────────

def _field(key: str, builtin_id: str, label: str, order: int) -> dict:
    return {
        "key": key,
        "label": label,
        "field_type": "builtin",
        "builtin_id": builtin_id,
        "required": False,
        "order": order,
    }


# ── 1) Built-in defaults ─────────────────────────────────────────────────────

# Canonical field lists per spec. Reused by the seed routine and the
# subsystem-format generator (S/E/M are the same shapes either way).
_FIELDS_STANDARD = [
    _field("log_index",   "log_index",   "Log #",       0),
    _field("title",       "title",       "Title",       1),
    _field("run",         "run",         "Run",         2),
    _field("category",    "category",    "Category",    3),
    _field("level",       "level",       "Level",       4),
    _field("tags",        "tags",        "Tags",        5),
    _field("body",        "body",        "Body",        6),
    _field("attachments", "attachments", "Attachments", 7),
]

# Beam / Target "setter" logs: dedicated default formats whose key field is the
# beam (or target) setter — so beam/target live in their own log, not Standard.
def _setter_fields(builtin: str, label: str) -> list[dict]:
    return [
        _field("log_index", "log_index", "Log #", 0),
        _field("run",       "run",       "Run",   1),
        _field(builtin,     builtin,     label,   2),
        _field("body",      "body",      "Body",  3),
    ]

def _time_metric(order: int) -> dict:
    """The log timestamp exposed as a plottable metric (not an input field)."""
    f = _field("time", "time", "Time", order)
    f["metric"] = True
    return f

def _run_fields(run_builtin: str) -> list[dict]:
    """Fields shape for Start-of-run / Monitoring-run logs: run + title + body + time(metric)."""
    return [
        _field("run",   run_builtin, "Run",   0),
        _field("title", "title",     "Title", 1),
        _field("body",  "body",      "Body",  2),
        _time_metric(3),
    ]

def _end_run_fields(run_builtin: str) -> list[dict]:
    """End-of-run logs deliberately omit the title (per spec): run + body + time(metric)."""
    return [
        _field("run",  run_builtin, "Run",  0),
        _field("body", "body",      "Body", 1),
        _time_metric(2),
    ]

# task_types of all run-flow formats (global + per-subsystem) that should carry
# the time metric.
RUN_TASK_TYPES = ("init_of_run", "start_of_run", "end_of_run", "monitoring_run")

def remove_beam_target_from_standard(db: Session) -> int:
    """beam/target belong to their own setter formats, not Standard — strip them
    from the Standard format if present. Idempotent. Returns count changed."""
    n = 0
    for fmt in db.query(models.LogFormat).filter(models.LogFormat.name == "Standard log").all():
        try:
            fields = json.loads(fmt.fields_json or "[]")
        except Exception:
            continue
        kept = [f for f in fields if not (isinstance(f, dict) and f.get("builtin_id") in ("beam", "target"))]
        if len(kept) != len(fields):
            for i, f in enumerate(kept):
                f["order"] = i
            fmt.fields_json = json.dumps(kept)
            n += 1
    if n:
        db.commit()
    return n


def ensure_time_metric_on_run_formats(db: Session) -> int:
    """Idempotent migration: make sure every existing run-flow format exposes the
    `time` metric, so upgraded projects match freshly-seeded ones. Returns count."""
    n = 0
    fmts = db.query(models.LogFormat).filter(models.LogFormat.task_type.in_(RUN_TASK_TYPES)).all()
    for fmt in fmts:
        try:
            fields = json.loads(fmt.fields_json or "[]")
        except Exception:
            continue
        if any(isinstance(f, dict) and (f.get("builtin_id") == "time" or f.get("key") == "time") for f in fields):
            continue
        fields.append(_time_metric(len(fields)))
        fmt.fields_json = json.dumps(fields)
        n += 1
    if n:
        db.commit()
    return n


def seed_default_formats(db: Session) -> int:
    """Ensure the built-in formats exist. Idempotent per format (matched by
    canonical name + task_type), so DBs created before a format was introduced
    — e.g. upgraded from the legacy seeder — still get the canonical run-log
    formats that link_main_system_formats/spawn_task_logs depend on. Returns
    the number of formats created."""
    specs = [
        dict(
            name="Standard log",
            fields=_FIELDS_STANDARD,
            format_type="user",
            task_type=None,
            run_type_lock=None,
            is_default=True,
        ),
        dict(
            name="Beam setter log",
            fields=_setter_fields("beam", "Beam"),
            format_type="user",
            task_type=None,
            run_type_lock=None,
            is_default=True,
            force_default=True,   # always a Default-group format, even on upgraded DBs
        ),
        dict(
            name="Target setter log",
            fields=_setter_fields("target", "Target"),
            format_type="user",
            task_type=None,
            run_type_lock=None,
            is_default=True,
            force_default=True,
        ),
        dict(
            name="Init of run log",
            fields=_run_fields(run_builtin="run"),
            format_type="system",
            task_type="init_of_run",
            run_type_lock="I",
        ),
        dict(
            name="Start of run log",
            fields=_run_fields(run_builtin="run"),
            format_type="system",
            task_type="start_of_run",
            run_type_lock="S",
        ),
        dict(
            name="End of run log",
            fields=_end_run_fields(run_builtin="run"),
            format_type="system",
            task_type="end_of_run",
            run_type_lock="E",
        ),
        dict(
            name="Monitoring run log",
            fields=_run_fields(run_builtin="run"),
            format_type="system",
            task_type="monitoring_run",
            run_type_lock="M",
        ),
    ]
    # A pre-existing default (legacy DBs) keeps its default flag; only a
    # fresh DB gets "Standard log" marked default.
    has_default = (
        db.query(models.LogFormat)
          .filter(models.LogFormat.is_default == True)  # noqa: E712
          .first() is not None
    )
    created = 0
    for s in specs:
        q = db.query(models.LogFormat).filter(models.LogFormat.name == s["name"])
        if s["task_type"]:
            q = q.filter(
                models.LogFormat.task_type == s["task_type"],
                models.LogFormat.system_id.is_(None),
                models.LogFormat.subsystem_id.is_(None),
            )
        if q.first() is not None:
            continue
        db.add(models.LogFormat(
            name=s["name"],
            fields_json=json.dumps(s["fields"]),
            # force_default formats (beam/target setters) are always Default-group;
            # the singular Standard default is only seeded on a truly fresh DB.
            is_default=s.get("is_default", False) and (s.get("force_default", False) or not has_default),
            format_type=s["format_type"],
            task_type=s["task_type"],
            run_type_lock=s["run_type_lock"],
            created_by="<system:seed>",
        ))
        created += 1
    if created:
        db.commit()
    return created


# ── 2) System auto-formats ───────────────────────────────────────────────────

# (task_type, run_type, name_template, builder, has_title)
_SUBSYS_SPECS = [
    ("init_of_run",    "I", "Init of {name} run",       _run_fields,     True),
    ("start_of_run",   "S", "Start of {name} run",      _run_fields,     True),
    ("end_of_run",     "E", "End of {name} run",        _end_run_fields, False),
    ("monitoring_run", "M", "Monitoring {name} run",    _run_fields,     True),
]


def sync_system_formats(svc: models.Service, db: Session) -> list[models.LogFormat]:
    """Idempotently create the three S/E/M formats for a system service and
    link them. If the formats already exist (matched by system_id + task_type),
    rename them to follow the service's current name. Returns the resulting
    list of LogFormat rows (always length 3 when is_system)."""
    if not svc.is_system:
        return []

    result: list[models.LogFormat] = []
    for task_type, run_type, name_tmpl, build_fields, _has_title in _SUBSYS_SPECS:
        target_name = name_tmpl.format(name=svc.name)

        # Primary lookup: by system_id + task_type
        existing = (
            db.query(models.LogFormat)
              .filter(
                  (models.LogFormat.system_id == svc.id) |
                  (models.LogFormat.subsystem_id == svc.id),
                  models.LogFormat.task_type == task_type,
              )
              .first()
        )
        # Fallback: same name + same task_type but system_id not yet set
        # (can happen if a previous registration flushed before commit).
        if not existing:
            existing = (
                db.query(models.LogFormat)
                  .filter(
                      models.LogFormat.name == target_name,
                      models.LogFormat.task_type == task_type,
                      models.LogFormat.system_id.is_(None),
                  )
                  .first()
            )
        if existing:
            if existing.name != target_name:
                existing.name = target_name
            # keep both ids in sync
            existing.system_id = svc.id
            existing.subsystem_id = svc.id
            result.append(existing)
            continue

        fmt = models.LogFormat(
            name=target_name,
            fields_json=json.dumps(build_fields(run_builtin="subsystem_run")),
            is_default=False,
            format_type="system",
            task_type=task_type,
            run_type_lock=run_type,
            subsystem_id=svc.id,
            system_id=svc.id,
            created_by=f"<system:service:{svc.id}>",
        )
        db.add(fmt)
        db.flush()
        result.append(fmt)

    # Link to the service via the many-to-many table (idempotent).
    existing_ids = {f.id for f in svc.log_formats}
    for f in result:
        if f.id not in existing_ids:
            svc.log_formats.append(f)

    return result


# Legacy alias
def sync_subsystem_formats(svc: models.Service, db: Session) -> list[models.LogFormat]:
    """Deprecated alias for sync_system_formats — kept for backwards compat."""
    return sync_system_formats(svc, db)


def detach_system_formats(svc: models.Service, db: Session) -> None:
    """When a system flag is turned off or a service is being deleted,
    keep the auto-formats around (logs may reference them) but clear their
    system_id so they no longer move when the service is renamed."""
    fmts = (
        db.query(models.LogFormat)
          .filter(
              (models.LogFormat.system_id == svc.id) |
              (models.LogFormat.subsystem_id == svc.id)
          )
          .all()
    )
    for f in fmts:
        f.system_id = None
        f.subsystem_id = None


def unlink_named_system_formats(svc: models.Service, db: Session) -> None:
    """Remove this service's own named S/E/M formats (those tied via
    system_id/subsystem_id) from its log_formats list.  Used when promoting a
    subsystem to a main system: the named formats should no longer be linked,
    only the global ones.  The format rows themselves are left intact."""
    named_ids = {
        f.id for f in svc.log_formats
        if f.system_id == svc.id or f.subsystem_id == svc.id
    }
    if named_ids:
        svc.log_formats = [f for f in svc.log_formats if f.id not in named_ids]


# Legacy alias
def detach_subsystem_formats(svc: models.Service, db: Session) -> None:
    """Deprecated alias for detach_system_formats — kept for backwards compat."""
    detach_system_formats(svc, db)


# ── 3) Main-system global format linking ─────────────────────────────────────

# task_types of the four global (no-name) formats.
_MAIN_SYSTEM_TASK_TYPES = ["init_of_run", "start_of_run", "end_of_run", "monitoring_run"]

# Canonical names of the four global run-log formats seeded by
# `seed_default_formats`.  Orphaned named subsystem formats (e.g. "Init of
# lilak run") may also have NULL system_id, so we identify the canonical
# globals by their exact names rather than by NULL ids alone.
_MAIN_SYSTEM_FORMAT_NAMES = [
    "Init of run log",
    "Start of run log",
    "End of run log",
    "Monitoring run log",
]


def _global_run_formats(db: Session) -> list[models.LogFormat]:
    """The four canonical global Init/Start/End/Monitoring run-log formats."""
    return (
        db.query(models.LogFormat)
          .filter(
              models.LogFormat.task_type.in_(_MAIN_SYSTEM_TASK_TYPES),
              models.LogFormat.name.in_(_MAIN_SYSTEM_FORMAT_NAMES),
              models.LogFormat.system_id.is_(None),
              models.LogFormat.subsystem_id.is_(None),
          )
          .all()
    )


def link_main_system_formats(svc: models.Service, db: Session) -> list[models.LogFormat]:
    """Link the four global Init/Start/End/Monitoring formats to a main-system
    service.  These are the canonical top-level run logs (matched by name).
    Does NOT create or link named subsystem formats."""
    global_fmts = _global_run_formats(db)
    existing_ids = {f.id for f in svc.log_formats}
    for f in global_fmts:
        if f.id not in existing_ids:
            svc.log_formats.append(f)
    return global_fmts


def unlink_main_system_formats(svc: models.Service, db: Session) -> None:
    """Remove the global Init/Start/End/Monitoring formats from this service's
    format list (e.g. when is_main_system is turned off)."""
    global_ids = {f.id for f in _global_run_formats(db)}
    svc.log_formats = [f for f in svc.log_formats if f.id not in global_ids]
