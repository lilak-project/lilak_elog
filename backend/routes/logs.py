"""
Log entry CRUD routes + search.
"""

import json
import os
import re
import socket
import subprocess
import sys
import threading
import urllib.request

from sqlalchemy import func

from utils_fields import normalize_format_fields, normalize_number_entry
from utils_tasks  import spawn_task_logs, spawn_template_tasks, confirm_log_entry, add_confirmation_required, fire_webhook_fills
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel as _PydanticBase
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_api_token_source, get_current_user_optional, require_auth, require_manager
from database import get_db, EXPERIMENT, DATA_ROOT

router = APIRouter(tags=["logs"])

# ── Webhook notification ──────────────────────────────────────────────────────

def _notify_webhooks(entry, db: Session) -> None:
    """Fire-and-forget: POST new-log notification to all enabled webhooks in DB.

    Sends every field on the log entry (except attachments) as a clean,
    readable markdown message that Dooray renders nicely.
    """
    from database import SessionLocal

    def _fmt_dt(dt):
        if not dt:
            return "—"
        try:
            return dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return str(dt)

    # ── 1. Meta line: #id  level  (date)  by author ──────────────────────
    level_str   = entry.level or "info"
    author_str  = entry.author_name or "—"
    date_str    = _fmt_dt(entry.created_at)
    source_display = "auto" if entry.is_auto else (entry.source or "human")

    meta_parts = [f"`#{entry.log_index or entry.id}`", f"`{level_str}`", f"({date_str})"]
    if source_display != "human":
        meta_parts.append(f"by `{author_str}` (`{source_display}`)")
    else:
        meta_parts.append(f"by `{author_str}`")
    lines = ["  ".join(meta_parts)]

    # ── 2. Run prefix + title ─────────────────────────────────────────────
    title = (entry.title or "").strip() or "(no title)"
    run_type_map = {"S": "S", "E": "E", "I": "I", "M": "M", "R": "R", "A": "A", "IDLE": "IDLE"}
    if entry.run_number and entry.run_type and entry.run_type in run_type_map:
        run_prefix = f"`{entry.run_type}#{entry.run_number}`"
        lines.append(f"{run_prefix}  {title}")
    else:
        lines.append(title)

    # ── 3. Tags (생략 가능) ───────────────────────────────────────────────
    tag_names = [t.name for t in (entry.tags or [])]
    if tag_names:
        tags_str = ", ".join(f"`{n}`" for n in tag_names)
        lines.append(tags_str)

    # ── 4. Custom format fields ───────────────────────────────────────────
    if entry.format_fields_json:
        try:
            field_values = json.loads(entry.format_fields_json)
        except Exception:
            field_values = {}

        labels: dict = {}
        if entry.format_id:
            try:
                fmt = db.query(models.LogFormat).get(entry.format_id)
                if fmt and fmt.fields_json:
                    for f in json.loads(fmt.fields_json):
                        labels[f.get("key")] = f.get("label") or f.get("key")
            except Exception:
                pass

        if field_values:
            lines.append("")
            for k, v in field_values.items():
                lbl = labels.get(k, k)
                lines.append(f"- {lbl}: {v if v not in (None, '') else '—'}")

    # ── 5. Body ───────────────────────────────────────────────────────────
    body = (entry.body or "").strip()
    if body:
        lines.append("---")
        lines.append(body)

    text = "\n".join(lines)

    # ── 5. Fetch enabled URLs ──────────────────────────────────────────────
    try:
        sess = SessionLocal()
        urls = [wh.url for wh in sess.query(models.Webhook).filter(models.Webhook.enabled == True).all()]
        sess.close()
    except Exception:
        return

    if not urls:
        return

    def _send():
        body_bytes = json.dumps({"text": text}).encode()
        for url in urls:
            try:
                req = urllib.request.Request(
                    url, data=body_bytes,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass  # 알림 실패가 로그 저장에 영향을 주지 않도록

    threading.Thread(target=_send, daemon=True).start()


# ── Run number helpers ────────────────────────────────────────────────────────

def _run_number_matches(entry: models.LogEntry, target: int) -> bool:
    rtype = entry.run_number_type or "single"
    if rtype == "single":
        return entry.run_number == target
    rtext = entry.run_number_text or ""
    if rtype == "range":
        for part in rtext.split(","):
            part = part.strip()
            if "-" in part:
                try:
                    lo, hi = part.split("-", 1)
                    if int(lo) <= target <= int(hi):
                        return True
                except Exception:
                    pass
        return False
    if rtype == "multiple":
        try:
            return target in [int(x.strip()) for x in rtext.split(",") if x.strip()]
        except Exception:
            return False
    return False


# ── Serializers ───────────────────────────────────────────────────────────────

def _entry_to_summary(entry: models.LogEntry) -> schemas.LogEntrySummary:
    return schemas.LogEntrySummary(
        id=entry.id,
        log_index=entry.log_index,
        title=entry.title,
        body_excerpt=entry.body[:300] if entry.body else None,
        author_name=entry.author_name,
        category=entry.category,
        run_number=entry.run_number,
        run_number_type=entry.run_number_type or "single",
        run_number_text=entry.run_number_text,
        level=entry.level or "info",
        run_type=entry.run_type,
        beam=entry.beam,
        target=entry.target,
        run_log_index=entry.run_log_index,
        parent_log_id=entry.parent_log_id,
        task_status=entry.task_status,
        task_module=entry.task_module,
        task_service_id=entry.task_service_id,
        task_interval_min=entry.task_interval_min,
        source=entry.source,
        is_auto=entry.is_auto,
        is_notice=entry.is_notice or False,
        is_deleted=entry.is_deleted,
        tags=[schemas.TagOut(id=t.id, name=t.name, color=t.color, border_color=t.border_color, text_color=t.text_color) for t in entry.tags],
        attachment_count=len(entry.attachments),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def _entry_to_detail(entry: models.LogEntry, db: Session = None) -> schemas.LogEntryDetail:
    # Phase 6b: list IDs of child task logs spawned from this one.
    child_ids: list[int] = []
    if db is not None:
        rows = (
            db.query(models.LogEntry.id)
              .filter(models.LogEntry.parent_log_id == entry.id,
                      models.LogEntry.is_deleted    == False)             # noqa: E712
              .order_by(models.LogEntry.id.asc())
              .all()
        )
        child_ids = [r[0] for r in rows]
    return schemas.LogEntryDetail(
        id=entry.id,
        title=entry.title,
        body=entry.body,
        author_id=entry.author_id,
        author_name=entry.author_name,
        category=entry.category,
        run_number=entry.run_number,
        run_number_type=entry.run_number_type or "single",
        run_number_text=entry.run_number_text,
        level=entry.level or "info",
        run_type=entry.run_type,
        beam=entry.beam,
        target=entry.target,
        run_log_index=entry.run_log_index,
        parent_log_id=entry.parent_log_id,
        task_status=entry.task_status,
        task_module=entry.task_module,
        task_service_id=entry.task_service_id,
        task_interval_min=entry.task_interval_min,
        source=entry.source,
        is_auto=entry.is_auto,
        is_notice=entry.is_notice or False,
        is_deleted=entry.is_deleted,
        metadata_json=entry.metadata_json,
        updated_by=entry.updated_by,
        deleted_at=entry.deleted_at,
        deleted_by=entry.deleted_by,
        format_id=entry.format_id,
        format_fields_json=entry.format_fields_json,
        tags=[schemas.TagOut(id=t.id, name=t.name, color=t.color, border_color=t.border_color, text_color=t.text_color) for t in entry.tags],
        attachment_count=len(entry.attachments),
        attachments=[
            schemas.AttachmentOut(
                id=a.id, log_id=a.log_id, filename=a.filename,
                original_filename=a.original_filename, content_type=a.content_type,
                size=a.size, created_at=a.created_at,
            )
            for a in entry.attachments
        ],
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        child_task_ids=child_ids,
    )


def _get_or_create_tags(db: Session, names: list[str]) -> list[models.Tag]:
    tags = []
    for name in set(n.strip().lower() for n in names if n.strip()):
        tag = db.query(models.Tag).filter(models.Tag.name == name).first()
        if not tag:
            tag = models.Tag(name=name)
            db.add(tag)
            db.flush()
        tags.append(tag)
    return tags


# ── Run-type auto-flow (Phase 4) ─────────────────────────────────────────────

# Default transitions when no format lock is in effect. Each entry maps
# "the run_type of the most recent non-Monitoring log for this run" to the
# run_type that should be pre-selected for the next log on the same run.
#
#   S → R   (start → running)
#   R → R   (still running)
#   E → A   (end → after)
#   A → A   (still after the run)
#   IDLE → IDLE
#
# Monitoring (M) is handled separately: an M log doesn't change run state,
# so we skip back past any M logs to find the actual prior state.
# Between Start and End → Running; after End (or otherwise) → IDLE.
_NEXT_RUN_TYPE = {
    "I":    "IDLE",   # Init is before Start → still idle until a Start log
    "S":    "R",
    "R":    "R",
    "E":    "IDLE",
    "A":    "IDLE",   # legacy 'After' collapses to IDLE
    "IDLE": "IDLE",
}


def _last_run_state_log(db: Session, run_number: int) -> Optional[models.LogEntry]:
    """The most recent non-deleted, non-Monitoring log on `run_number` — the
    log that defines the run's current state. (M logs are transparent.)"""
    return (
        db.query(models.LogEntry)
          .filter(models.LogEntry.run_number == run_number,
                  models.LogEntry.is_deleted == False,                # noqa: E712
                  models.LogEntry.run_type.isnot(None),
                  models.LogEntry.run_type != "M")
          .order_by(models.LogEntry.created_at.desc())
          .first()
    )


def _compute_run_type(db: Session, run_number: Optional[int]) -> str:
    """The run_type a new log on `run_number` should get: between Start and End
    → 'R', after End (or no run) → 'IDLE'. No prior log → 'R' (assume running)."""
    if run_number is None:
        return "IDLE"
    last = _last_run_state_log(db, run_number)
    if not last:
        return "R"
    return _NEXT_RUN_TYPE.get(last.run_type, "R")


@router.get("/logs/next-run-type")
def next_run_type(
    run_number: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Pre-compute the run_type the LogForm should default to for a new log.

    Rules:
      • no run_number          → 'IDLE'  (no run context)
      • no prior log on that run → 'R'    (assume a run is currently running)
      • prior log run_type X  → transitions table above
      • Monitoring (M) logs are transparent — they don't change run state, so
        we look back past them.

    Returns:  { run_type: str, based_on: { id, run_type } | null }
    """
    if run_number is None:
        return {"run_type": "IDLE", "based_on": None}

    # Same query + transition table as _compute_run_type, so the form's
    # suggestion always matches what the server assigns on save.
    last = _last_run_state_log(db, run_number)
    if not last:
        return {"run_type": "R", "based_on": None}

    return {
        "run_type": _NEXT_RUN_TYPE.get(last.run_type, "R"),
        "based_on": {"id": last.id, "run_type": last.run_type},
    }


# ── Current run status (idle / run#N) ────────────────────────────────────────
@router.get("/runs/current")
def current_run(db: Session = Depends(get_db)):
    """Latest run boundary decides the status: a start_of_run with no later
    end_of_run → running that run; otherwise idle."""
    last = (db.query(models.LogEntry)
            .filter(models.LogEntry.run_type.in_(["S", "E"]),
                    models.LogEntry.is_deleted == False)
            .order_by(models.LogEntry.created_at.desc())
            .first())
    if last and last.run_type == "S" and last.run_number is not None:
        return {"state": "running", "run_number": last.run_number}
    return {"state": "idle", "run_number": None}


# ── List / search ─────────────────────────────────────────────────────────────

@router.get("/logs", response_model=schemas.LogListResponse)
def list_logs(
    q: Optional[str] = Query(None),
    author: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    tag_expr: Optional[str] = Query(None),   # "#auto && #task" / "#a || #b"
    run_number: Optional[int] = Query(None),
    log_index: Optional[int] = Query(None),
    beam: Optional[str] = Query(None),
    target: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),   # legacy alias
    source: Optional[str] = Query(None),
    is_auto: Optional[bool] = Query(None),
    is_notice: Optional[bool] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    include_deleted: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    show_deleted = include_deleted and (current_user and current_user.role == "manager")

    if q:
        fts_sql = "SELECT rowid FROM log_fts WHERE log_fts MATCH :q ORDER BY rank"
        try:
            rows = db.execute(text(fts_sql), {"q": q}).fetchall()
        except OperationalError:
            # Queries with FTS5 metacharacters ('#', unbalanced quotes, …)
            # are syntax errors. Retry with each token quoted as a phrase
            # instead of returning a 500.
            db.rollback()
            quoted = " ".join(
                '"' + tok.replace('"', '""') + '"' for tok in q.split()
            )
            try:
                rows = db.execute(text(fts_sql), {"q": quoted}).fetchall()
            except OperationalError:
                db.rollback()
                rows = []
        ids = [r[0] for r in rows]
        if not ids:
            return schemas.LogListResponse(items=[], total=0, page=page, page_size=page_size)
        query = db.query(models.LogEntry).filter(models.LogEntry.id.in_(ids))
    else:
        query = db.query(models.LogEntry)

    if not show_deleted:
        query = query.filter(models.LogEntry.is_deleted == False)
    if author:
        query = query.filter(models.LogEntry.author_name.ilike(f"%{author}%"))
    if category:
        query = query.filter(models.LogEntry.category == category)
    effective_level = level or severity   # accept legacy ?severity= for now
    if effective_level:
        query = query.filter(models.LogEntry.level == effective_level)
    if source:
        query = query.filter(models.LogEntry.source == source)
    if is_auto is not None:
        query = query.filter(models.LogEntry.is_auto == is_auto)
    if is_notice is not None:
        query = query.filter(models.LogEntry.is_notice == is_notice)
    if date_from:
        query = query.filter(models.LogEntry.created_at >= date_from)
    if date_to:
        query = query.filter(models.LogEntry.created_at <= date_to)
    if tag:
        query = query.join(models.LogEntry.tags).filter(models.Tag.name == tag.lower().strip())
    if log_index is not None:
        query = query.filter(models.LogEntry.log_index == log_index)
    if beam:
        query = query.filter(func.lower(models.LogEntry.beam) == beam.lower().strip())
    if target:
        query = query.filter(func.lower(models.LogEntry.target) == target.lower().strip())

    # tag_expr: combine tags with && (AND) or || (OR). Synthetic tags 'auto' and
    # 'task' map to is_auto / parent_log_id so #auto, #task work like in the UI.
    if tag_expr and tag_expr.strip():
        expr = tag_expr.strip()
        if "&&" in expr and "||" in expr:
            raise HTTPException(
                status_code=400,
                detail="tag_expr cannot mix && and || in one expression",
            )
        op = "&&" if "&&" in expr else ("||" if "||" in expr else None)
        parts = [p.strip().lstrip("#").lower() for p in
                 (expr.split(op) if op else [expr])]
        parts = [p for p in parts if p]

        def _has_tag(e, name):
            if name == "auto":
                return bool(e.is_auto)
            if name == "task":
                return e.parent_log_id is not None
            if name == "confirm":
                name = "confirmation required"
            return any(t.name.lower() == name for t in e.tags)

        all_entries = query.order_by(models.LogEntry.created_at.desc()).all()
        if op == "||":
            matched = [e for e in all_entries if any(_has_tag(e, p) for p in parts)]
        else:  # AND (default for single tag too)
            matched = [e for e in all_entries if all(_has_tag(e, p) for p in parts)]
        # run_number must still apply when combined with tag_expr
        if run_number is not None:
            matched = [e for e in matched if _run_number_matches(e, run_number)]
        total = len(matched)
        start = (page - 1) * page_size
        return schemas.LogListResponse(
            items=[_entry_to_summary(e) for e in matched[start: start + page_size]],
            total=total, page=page, page_size=page_size,
        )

    # run_number: SQL for single, Python filter for range/multiple
    if run_number is not None:
        all_entries = query.order_by(models.LogEntry.created_at.desc()).all()
        all_entries = [e for e in all_entries if _run_number_matches(e, run_number)]
        total = len(all_entries)
        start = (page - 1) * page_size
        return schemas.LogListResponse(
            items=[_entry_to_summary(e) for e in all_entries[start: start + page_size]],
            total=total, page=page, page_size=page_size,
        )

    total = query.count()
    entries = (
        query.order_by(models.LogEntry.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size).all()
    )
    return schemas.LogListResponse(
        items=[_entry_to_summary(e) for e in entries],
        total=total, page=page, page_size=page_size,
    )


# ── Last run number ───────────────────────────────────────────────────────────

@router.get("/logs/last-run-number")
def get_last_run_number(db: Session = Depends(get_db)):
    """Return the highest single run_number among non-deleted entries."""
    entry = (
        db.query(models.LogEntry)
        .filter(
            models.LogEntry.is_deleted == False,
            models.LogEntry.run_number_type == "single",
            models.LogEntry.run_number != None,
        )
        .order_by(models.LogEntry.run_number.desc())
        .first()
    )
    return {"last_run_number": entry.run_number if entry else None}


# ── Get single ────────────────────────────────────────────────────────────────

@router.get("/logs/{log_id}", response_model=schemas.LogEntryDetail)
def get_log(
    log_id: int,
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    entry = db.query(models.LogEntry).filter(models.LogEntry.id == log_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    if entry.is_deleted and not (current_user and current_user.role == "manager"):
        raise HTTPException(status_code=404, detail="Log entry not found")
    return _entry_to_detail(entry, db)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/logs", response_model=schemas.LogEntryDetail, status_code=status.HTTP_201_CREATED)
def create_log(
    payload: schemas.LogEntryCreate,
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    api_token: Optional[models.ApiToken] = Depends(get_api_token_source),
    db: Session = Depends(get_db),
):
    if current_user is None and api_token is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    if current_user:
        author_id = current_user.id
        author_name = current_user.username
        source = "human"
        is_auto = False
    else:
        author_id = None
        author_name = api_token.source_name or api_token.name
        source = payload.source or api_token.source_name or api_token.name
        is_auto = payload.is_auto

    # ── log_type → format_id + run_type 자동 해석 ─────────────────────────────
    # token으로 서비스를 찾아서 log_type에 맞는 format을 연결합니다.
    #   0  = 일반 서비스 로그 (task_type이 없는 첫 번째 포맷)
    #   11 = init_of_run   → run_type 'I'
    #   12 = start_of_run  → run_type 'S'
    #   13 = end_of_run    → run_type 'E'
    #   14 = monitoring_run → run_type 'M'
    _LOG_TYPE_TO_TASK: dict[int, str] = {
        11: "init_of_run",
        12: "start_of_run",
        13: "end_of_run",
        14: "monitoring_run",
    }
    _LOG_TYPE_TO_RUN_TYPE: dict[int, str] = {
        11: "I", 12: "S", 13: "E", 14: "M",
    }
    resolved_format_id = payload.format_id
    resolved_run_type  = payload.run_type
    if payload.log_type is not None and api_token is not None and resolved_format_id is None:
        svc_name = api_token.source_name or api_token.name
        svc = db.query(models.Service).filter(models.Service.name == svc_name).first()
        if svc and svc.log_formats:
            if payload.log_type == 0:
                # 일반 로그 — task_type 없는 첫 번째 포맷
                fmt = next(
                    (f for f in svc.log_formats if not f.task_type), None
                ) or svc.log_formats[0]
                resolved_format_id = fmt.id
            elif payload.log_type in _LOG_TYPE_TO_TASK:
                task_type = _LOG_TYPE_TO_TASK[payload.log_type]
                fmt = next(
                    (f for f in svc.log_formats if f.task_type == task_type), None
                )
                if fmt:
                    resolved_format_id = fmt.id
                # run_type도 자동 설정 (payload에서 명시한 경우 우선)
                if resolved_run_type is None:
                    resolved_run_type = _LOG_TYPE_TO_RUN_TYPE[payload.log_type]

    # Accept either `level` (preferred) or legacy `severity` from the payload.
    level_val = payload.level or payload.severity or "info"

    # Normalize number_entry values so the stored shape is always
    # {value, error, variant, raw}.  Other custom field types pass through.
    fmt_fields_def = []
    if resolved_format_id:
        fmt = db.query(models.LogFormat).filter(models.LogFormat.id == resolved_format_id).first()
        if fmt and fmt.fields_json:
            try: fmt_fields_def = json.loads(fmt.fields_json)
            except Exception: fmt_fields_def = []
    normalized = normalize_format_fields(payload.format_fields or {}, fmt_fields_def)

    # Service/system push with an unchanged run_number → accumulate values into
    # the existing log's number_entry 'multiple' field(s) (append a slot) rather
    # than creating a new row. Only applies when the format has such a field.
    multiple_keys = {
        f["key"] for f in fmt_fields_def
        if isinstance(f, dict) and f.get("field_type") == "number_entry" and f.get("variant") == "multiple"
    }
    if is_auto and resolved_format_id and payload.run_number is not None and multiple_keys and normalized:
        existing = (
            db.query(models.LogEntry)
              .filter(models.LogEntry.format_id == resolved_format_id,
                      models.LogEntry.run_number == payload.run_number,
                      models.LogEntry.source == source,
                      models.LogEntry.is_deleted == False)            # noqa: E712
              .order_by(models.LogEntry.id.desc())
              .first()
        )
        if existing:
            try: cur = json.loads(existing.format_fields_json or "{}")
            except Exception: cur = {}
            for k, newval in normalized.items():
                if k in multiple_keys:
                    ex = cur.get(k) if isinstance(cur.get(k), dict) else {}
                    ex_vals = list((ex.get("raw") or {}).get("values") or [])
                    nv = (newval.get("raw") or {}) if isinstance(newval, dict) else {}
                    add = nv.get("values")
                    if add is None:
                        add = [newval.get("value")] if isinstance(newval, dict) else [newval]
                    ex_vals.extend(v for v in add if v is not None)
                    cur[k] = normalize_number_entry({"values": ex_vals}, "multiple")
                else:
                    cur[k] = newval
            existing.format_fields_json = json.dumps(cur)
            existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit(); db.refresh(existing)
            _audit(db, "update", "log_entry", existing.id, "<service:accumulate>")
            return _entry_to_detail(existing, db)

    # Per-experiment auto-increment (no race-proof, but good enough for the
    # write rate we expect — uvicorn workers serialize via SQLite anyway).
    from database import next_log_index as _next_log_index
    next_log_index = _next_log_index(db)

    # If no run_type was given but a run number is present, derive it from the
    # run state (between Start and End → Running, after End → IDLE).
    if resolved_run_type is None and payload.run_number is not None:
        resolved_run_type = _compute_run_type(db, payload.run_number)

    # IDLE logs carry the last-set run number when none was provided.
    run_number_final = payload.run_number
    if run_number_final is None and (resolved_run_type in ("IDLE", "A")):
        last_run = (
            db.query(models.LogEntry.run_number)
              .filter(models.LogEntry.run_number.isnot(None),
                      models.LogEntry.run_number_type == "single",
                      models.LogEntry.is_deleted == False)   # noqa: E712
              .order_by(models.LogEntry.id.desc()).first()
        )
        if last_run:
            run_number_final = last_run[0]

    # Phase 5: per-run sequential counter. Only when this log has a numeric
    # run_number (text variants like "1-5,7" don't participate). The COUNT
    # uses the same run_number as a filter so it's correct across all run_types.
    next_run_log_index = None
    if run_number_final is not None and (payload.run_number_type or "single") == "single":
        prior = db.query(func.count(models.LogEntry.id)).filter(
            models.LogEntry.run_number == run_number_final,
            models.LogEntry.run_number_type == "single",
            models.LogEntry.is_deleted == False,        # noqa: E712
        ).scalar() or 0
        next_run_log_index = prior + 1

    # Sticky beam/target: a non-empty value on this log sets a new one; else
    # inherit the most recent prior log's value.
    def _inherit(field):
        prior = (db.query(getattr(models.LogEntry, field))
                   .filter(getattr(models.LogEntry, field).isnot(None),
                           getattr(models.LogEntry, field) != "",
                           models.LogEntry.is_deleted == False)   # noqa: E712
                   .order_by(models.LogEntry.id.desc()).first())
        return prior[0] if prior else None
    beam_val = (payload.beam or "").strip() or _inherit("beam")
    target_val = (payload.target or "").strip() or _inherit("target")

    entry = models.LogEntry(
        log_index=next_log_index,
        run_log_index=next_run_log_index,
        title=payload.title,
        body=payload.body,
        author_id=author_id,
        author_name=author_name,
        category=payload.category,
        run_number=run_number_final,
        run_number_type=payload.run_number_type or "single",
        run_number_text=payload.run_number_text,
        level=level_val,
        run_type=resolved_run_type,
        beam=beam_val,
        target=target_val,
        source=source,
        is_auto=is_auto,
        metadata_json=payload.metadata_json,
        format_id=resolved_format_id,
        format_fields_json=json.dumps(normalized) if normalized else None,
    )
    entry.tags = _get_or_create_tags(db, payload.tags)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    _audit(db, "create", "log_entry", entry.id, author_name)
    _notify_webhooks(entry, db)
    _notify_community_chat(entry, db)
    try:
        from routes.infography import auto_sync_if_enabled
        auto_sync_if_enabled()
    except Exception:
        pass

    # Phase 6: if this is a parent task log (Start/End/Monitoring run via the
    # canonical system format), spawn an empty child task log for every
    # subsystem-owned sibling format. Each child can later be filled by a
    # webhook (Phase 7) or by a shifter, after which it gets the
    # "confirmation required" tag.
    if entry.format_id:
        parent_fmt = (
            db.query(models.LogFormat)
              .filter(models.LogFormat.id == entry.format_id)
              .first()
        )
        children = spawn_task_logs(entry, parent_fmt, db)
        if children:
            db.commit()
            for c in children:
                _audit(db, "create", "log_entry", c.id, "<system:task_spawn>")
            # Phase 7: kick off webhook fills for service-backed tasks. Runs
            # in background threads so the create-log request returns fast;
            # each task gets its own DB session.
            fire_webhook_fills([c.id for c in children])

        # Per-format task template: spawn the configured task logs so they hang
        # off this freshly-filed log as its tasks.
        tmpl_children = spawn_template_tasks(entry, parent_fmt, db)
        if tmpl_children:
            db.commit()
            for c in tmpl_children:
                _audit(db, "create", "log_entry", c.id, "<system:task_template>")

    return _entry_to_detail(entry, db)


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/logs/{log_id}", response_model=schemas.LogEntryDetail)
def update_log(
    log_id: int,
    payload: schemas.LogEntryUpdate,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    entry = db.query(models.LogEntry).filter(
        models.LogEntry.id == log_id, models.LogEntry.is_deleted == False,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    # System-spawned task logs have author_id=None; any authenticated user may
    # fill them (the whole point of the pending→filled "Go" flow).
    if (current_user.role != "manager" and entry.author_id is not None
            and entry.author_id != current_user.id):
        raise HTTPException(status_code=403, detail="Cannot edit another user's entry")

    for field in ("title", "body", "category", "run_number", "run_number_type",
                  "run_number_text", "run_type", "format_id"):
        val = getattr(payload, field, None)
        if val is not None:
            setattr(entry, field, val)
    # `level` (renamed from `severity`) accepts either key
    level_val = payload.level or payload.severity
    if level_val is not None:
        entry.level = level_val
    # is_notice can be toggled only by managers
    if payload.is_notice is not None:
        if current_user.role != "manager":
            raise HTTPException(status_code=403, detail="Only managers can set is_notice")
        entry.is_notice = payload.is_notice
    if payload.format_fields is not None:
        # Re-normalize on update so number_entry values stay canonical.
        fmt_fields_def = []
        fmt_id = payload.format_id or entry.format_id
        if fmt_id:
            fmt = db.query(models.LogFormat).filter(models.LogFormat.id == fmt_id).first()
            if fmt and fmt.fields_json:
                try: fmt_fields_def = json.loads(fmt.fields_json)
                except Exception: fmt_fields_def = []
        normalized = normalize_format_fields(payload.format_fields, fmt_fields_def)
        entry.format_fields_json = json.dumps(normalized) if normalized else None
    if payload.tags is not None:
        entry.tags = _get_or_create_tags(db, payload.tags)
    if payload.beam is not None:
        entry.beam = payload.beam.strip() or None
    if payload.target is not None:
        entry.target = payload.target.strip() or None

    # A pending task log becomes 'filled' once a human edits & saves it ("Go").
    # Tag it #filled and #<username> so it's clear who completed it.
    if entry.task_status == "pending":
        entry.task_status = "filled"
        for tg in _get_or_create_tags(db, ["filled", current_user.username]):
            if tg not in entry.tags:
                entry.tags.append(tg)

    entry.updated_by = current_user.username
    entry.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(entry)
    _audit(db, "update", "log_entry", entry.id, current_user.username)
    return _entry_to_detail(entry, db)


# ── Delete / Restore ──────────────────────────────────────────────────────────

@router.delete("/logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(log_id: int, current_user: models.User = Depends(require_auth), db: Session = Depends(get_db)):
    entry = db.query(models.LogEntry).filter(models.LogEntry.id == log_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    # Soft delete: managers can delete anything, users only their own entries
    # (needed so cancelling a new-log draft can clean up the empty entry).
    if current_user.role != "manager" and entry.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's entry")
    entry.is_deleted = True
    entry.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    entry.deleted_by = current_user.username
    db.commit()
    _audit(db, "delete", "log_entry", entry.id, current_user.username)


@router.post("/logs/{log_id}/restore", response_model=schemas.LogEntryDetail)
def restore_log(log_id: int, current_user: models.User = Depends(require_manager), db: Session = Depends(get_db)):
    entry = db.query(models.LogEntry).filter(models.LogEntry.id == log_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    entry.is_deleted = False
    entry.deleted_at = None
    entry.deleted_by = None
    db.commit()
    db.refresh(entry)
    _audit(db, "restore", "log_entry", entry.id, current_user.username)
    return _entry_to_detail(entry, db)


# ── Log management (summary + bulk delete by range) ─────────────────────────

@router.get("/logs/management/summary")
def logs_summary(
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Aggregate stats for the Log Management settings panel."""
    L = models.LogEntry
    active_q = db.query(L).filter(L.is_deleted == False)            # noqa: E712

    total_active  = active_q.count()
    total_deleted = db.query(L).filter(L.is_deleted == True).count()  # noqa: E712
    min_idx = db.query(func.min(L.log_index)).filter(L.is_deleted == False).scalar()  # noqa: E712
    max_idx = db.query(func.max(L.log_index)).filter(L.is_deleted == False).scalar()  # noqa: E712

    auto_count   = active_q.filter(L.is_auto == True).count()        # noqa: E712
    human_count  = total_active - auto_count
    task_count   = active_q.filter(L.parent_log_id.isnot(None)).count()

    # Count by level
    by_level = dict(
        db.query(L.level, func.count(L.id))
          .filter(L.is_deleted == False)                            # noqa: E712
          .group_by(L.level).all()
    )
    # Count by source (top 10)
    by_source = [
        {"source": s or "—", "count": c}
        for s, c in db.query(L.source, func.count(L.id))
                       .filter(L.is_deleted == False)               # noqa: E712
                       .group_by(L.source)
                       .order_by(func.count(L.id).desc())
                       .limit(10).all()
    ]

    return {
        "total_active":  total_active,
        "total_deleted": total_deleted,
        "min_log_index": min_idx,
        "max_log_index": max_idx,
        "auto_count":    auto_count,
        "human_count":   human_count,
        "task_count":    task_count,
        "by_level":      by_level,
        "by_source":     by_source,
    }


class BulkDeletePayload(_PydanticBase):
    start: Optional[int] = None       # inclusive log_index lower bound
    end: Optional[int] = None         # inclusive log_index upper bound
    ids: Optional[list[int]] = None   # explicit log_index list (alternative to range)


@router.post("/logs/management/bulk-delete")
def bulk_delete_logs(
    payload: BulkDeletePayload,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Soft-delete logs by a log_index range (inclusive) or an explicit list.
    Reversible — entries are marked is_deleted and can be restored."""
    L = models.LogEntry
    q = db.query(L).filter(L.is_deleted == False)                   # noqa: E712

    if payload.ids:
        q = q.filter(L.log_index.in_(payload.ids))
    else:
        if payload.start is None and payload.end is None:
            raise HTTPException(status_code=400, detail="Provide a range (start/end) or ids.")
        if payload.start is not None:
            q = q.filter(L.log_index >= payload.start)
        if payload.end is not None:
            q = q.filter(L.log_index <= payload.end)

    entries = q.all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for e in entries:
        e.is_deleted = True
        e.deleted_at = now
        e.deleted_by = current_user.username
    db.commit()
    for e in entries:
        _audit(db, "delete", "log_entry", e.id, current_user.username)
    return {"deleted": len(entries), "log_indices": sorted(e.log_index for e in entries if e.log_index is not None)}


@router.post("/logs/management/bulk-restore")
def bulk_restore_logs(
    payload: BulkDeletePayload,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Restore soft-deleted logs by range or explicit list."""
    L = models.LogEntry
    q = db.query(L).filter(L.is_deleted == True)                    # noqa: E712
    if payload.ids:
        q = q.filter(L.log_index.in_(payload.ids))
    else:
        if payload.start is None and payload.end is None:
            raise HTTPException(status_code=400, detail="Provide a range (start/end) or ids.")
        if payload.start is not None:
            q = q.filter(L.log_index >= payload.start)
        if payload.end is not None:
            q = q.filter(L.log_index <= payload.end)
    entries = q.all()
    for e in entries:
        e.is_deleted = False
        e.deleted_at = None
        e.deleted_by = None
    db.commit()
    for e in entries:
        _audit(db, "restore", "log_entry", e.id, current_user.username)
    return {"restored": len(entries)}


# ── Phase 6: Confirm a task log ──────────────────────────────────────────────

@router.post("/logs/{log_id}/confirm", response_model=schemas.LogEntryDetail)
def confirm_log(
    log_id: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Mark a task log as reviewed: remove the `confirmation required` tag
    and add `confirmed by <username>` in its place."""
    entry = (
        db.query(models.LogEntry)
          .filter(models.LogEntry.id         == log_id,
                  models.LogEntry.is_deleted == False)                # noqa: E712
          .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")

    confirm_log_entry(entry, current_user, db)
    db.commit()
    db.refresh(entry)
    _audit(db, "confirm", "log_entry", entry.id, current_user.username)
    return _entry_to_detail(entry, db)


# ── Phase 6: Mark a log as needing confirmation (used by Phase 7 webhook) ────

@router.post("/logs/{log_id}/needs-confirmation", response_model=schemas.LogEntryDetail)
def mark_needs_confirmation(
    log_id: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Attach the `confirmation required` tag. Normally called by the webhook
    layer after a system task is auto-filled, but exposed on the API so
    managers / scripts can trigger it manually for now."""
    entry = (
        db.query(models.LogEntry)
          .filter(models.LogEntry.id         == log_id,
                  models.LogEntry.is_deleted == False)                # noqa: E712
          .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    add_confirmation_required(entry, db)
    db.commit()
    db.refresh(entry)
    _audit(db, "needs-confirmation", "log_entry", entry.id, current_user.username)
    return _entry_to_detail(entry, db)


# ── Tags ──────────────────────────────────────────────────────────────────────

# Real DB tags the system manages — cannot be renamed / deleted / merged.
BUILTIN_TAGS = {"confirmation required", "confirmed", "reported", "filled"}
# Synthetic tags (derived from log fields, not assigned) — color-only config.
SYSTEM_TAG_NAMES = ["pending", "auto", "task", "confirm",
                    "init", "start", "running", "end", "idle"]
PROTECTED_TAGS = BUILTIN_TAGS | set(SYSTEM_TAG_NAMES)


@router.get("/tags", response_model=list[schemas.TagOut])
def list_tags(db: Session = Depends(get_db)):
    return db.query(models.Tag).order_by(models.Tag.name).all()


@router.get("/tags/system-counts")
def system_tag_counts(db: Session = Depends(get_db)):
    """Usage counts for synthetic system tags (derived from log fields)."""
    L = models.LogEntry
    base = db.query(func.count(L.id)).filter(L.is_deleted == False)   # noqa: E712
    def c(*crit):
        q = base
        for k in crit:
            q = q.filter(k)
        return q.scalar() or 0
    confirm_n = (db.query(func.count(L.id))
                   .join(L.tags).filter(models.Tag.name == "confirmation required",
                                        L.is_deleted == False).scalar() or 0)  # noqa: E712
    return {
        "auto":    c(L.is_auto == True),                                   # noqa: E712
        "task":    c(L.parent_log_id.isnot(None)),
        "pending": c(L.task_status == "pending", L.task_service_id.is_(None), L.task_module.is_(None)),
        "confirm": confirm_n,
        "init":    c(L.run_type == "I"),
        "start":   c(L.run_type == "S"),
        "running": c(L.run_type == "R"),
        "end":     c(L.run_type == "E"),
        "idle":    c(L.run_type.in_(["IDLE", "A"])),
    }


@router.get("/tags/colors")
def tag_colors(db: Session = Depends(get_db)):
    """name → {color, border, text} map for tags that have any custom styling."""
    rows = (db.query(models.Tag)
              .filter((models.Tag.color.isnot(None)) | (models.Tag.border_color.isnot(None))
                      | (models.Tag.text_color.isnot(None)))
              .all())
    return {t.name: {"color": t.color, "border": t.border_color, "text": t.text_color} for t in rows}


@router.put("/tags/system/{name}")
def set_system_tag_color(
    name: str,
    payload: schemas.TagUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Set the color of a synthetic system tag (auto/task/pending/confirm).
    Upserts a Tag row to hold the color; these rows are not user-assignable."""
    name = name.strip().lower()
    if name not in SYSTEM_TAG_NAMES:
        raise HTTPException(status_code=400, detail="Not a system tag")
    tag = db.query(models.Tag).filter(models.Tag.name == name).first()
    if tag is None:
        tag = models.Tag(name=name)
        db.add(tag)
        db.flush()
    if payload.color is not None:
        tag.color = payload.color.strip() or None
    if payload.border_color is not None:
        tag.border_color = payload.border_color.strip() or None
    if payload.text_color is not None:
        tag.text_color = payload.text_color.strip() or None
    db.commit()
    return {"name": name, "color": tag.color, "border": tag.border_color, "text": tag.text_color}


@router.get("/tags/manage", response_model=list[schemas.TagManageOut])
def list_tags_manage(db: Session = Depends(get_db)):
    """All tags with usage counts + builtin flag, for the management UI."""
    rows = db.query(models.Tag).order_by(models.Tag.name).all()
    # One aggregate over the association table instead of hydrating every
    # LogEntry per tag just to count it.
    counts = dict(
        db.query(models.log_tags.c.tag_id, func.count())
          .group_by(models.log_tags.c.tag_id)
          .all()
    )
    return [
        schemas.TagManageOut(
            id=t.id, name=t.name, color=t.color, border_color=t.border_color, text_color=t.text_color,
            count=counts.get(t.id, 0),
            builtin=t.name in BUILTIN_TAGS,
        )
        for t in rows
        if t.name not in SYSTEM_TAG_NAMES   # synthetic rows shown separately
    ]


@router.put("/tags/{tag_id}", response_model=schemas.TagManageOut)
def update_tag(
    tag_id: int,
    payload: schemas.TagUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if payload.name is not None:
        new_name = payload.name.strip().lower()
        if not new_name:
            raise HTTPException(status_code=400, detail="Tag name cannot be empty")
        if tag.name in PROTECTED_TAGS:
            raise HTTPException(status_code=400, detail="Built-in tags cannot be renamed")
        if new_name != tag.name:
            clash = db.query(models.Tag).filter(models.Tag.name == new_name,
                                                models.Tag.id != tag_id).first()
            if clash:
                raise HTTPException(status_code=409, detail=f"A tag named '{new_name}' already exists")
            tag.name = new_name
    if payload.color is not None:
        tag.color = payload.color.strip() or None
    if payload.border_color is not None:
        tag.border_color = payload.border_color.strip() or None
    if payload.text_color is not None:
        tag.text_color = payload.text_color.strip() or None
    db.commit()
    db.refresh(tag)
    n_logs = (
        db.query(func.count())
          .select_from(models.log_tags)
          .filter(models.log_tags.c.tag_id == tag.id)
          .scalar()
    )
    return schemas.TagManageOut(id=tag.id, name=tag.name, color=tag.color, border_color=tag.border_color,
                                text_color=tag.text_color, count=n_logs, builtin=tag.name in BUILTIN_TAGS)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(
    tag_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if tag.name in PROTECTED_TAGS:
        raise HTTPException(status_code=400, detail="Built-in tags cannot be deleted")
    for log in list(tag.log_entries):
        log.tags.remove(tag)
    db.delete(tag)
    db.commit()


@router.post("/tags/{tag_id}/merge-into/{target_id}")
def merge_tags(
    tag_id: int,
    target_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    src = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    dst = db.query(models.Tag).filter(models.Tag.id == target_id).first()
    if not src or not dst:
        raise HTTPException(status_code=404, detail="Tag not found")
    if src.id == dst.id:
        raise HTTPException(status_code=400, detail="Cannot merge a tag into itself")
    if src.name in PROTECTED_TAGS:
        raise HTTPException(status_code=400, detail="Built-in tags cannot be merged")
    for log in list(src.log_entries):
        if dst not in log.tags:
            log.tags.append(dst)
        log.tags.remove(src)
    db.delete(src)
    db.commit()
    return {"merged": src.name, "into": dst.name}


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[str])
def list_categories(db: Session = Depends(get_db)):
    rows = (
        db.query(models.LogEntry.category)
        .filter(models.LogEntry.category != None, models.LogEntry.is_deleted == False)
        .distinct().order_by(models.LogEntry.category).all()
    )
    return [r[0] for r in rows if r[0]]


# ── Experiment info ───────────────────────────────────────────────────────────

@router.get("/info")
def get_info():
    return {
        "experiment":    EXPERIMENT,
        "launcher_port": int(os.environ.get("LAUNCHER_PORT", 8010)),
    }


def _port_alive(port: int) -> bool:
    """포트가 실제로 열려 있는지 0.5초 안에 확인."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


@router.get("/experiments")
def list_experiments():
    """실험 목록과 각각의 실행 중인 포트(있을 때)를 반환합니다."""
    if not os.path.isdir(DATA_ROOT):
        return [{"name": EXPERIMENT, "port": None}]

    result = []
    for d in sorted(os.listdir(DATA_ROOT)):
        if not os.path.isdir(os.path.join(DATA_ROOT, d)):
            continue
        port = None
        port_file = os.path.join(DATA_ROOT, d, ".port")
        if os.path.isfile(port_file):
            try:
                candidate = int(open(port_file).read().strip())
                if _port_alive(candidate):
                    port = candidate
                else:
                    # stale 파일 삭제 — 이미 죽은 서버
                    os.remove(port_file)
            except Exception:
                pass
        result.append({"name": d, "port": port})

    return result or [{"name": EXPERIMENT, "port": None}]


@router.post("/experiments/{name}", status_code=status.HTTP_201_CREATED)
def create_experiment(
    name: str,
    current_user: models.User = Depends(require_manager),
):
    """새 실험 데이터 폴더를 생성합니다. 생성 후 ./elog.sh -e <name> 으로 전환하세요."""
    if not re.match(r'^[A-Za-z0-9_-]{1,64}$', name):
        raise HTTPException(status_code=400, detail="실험 이름은 영문자, 숫자, -, _만 사용 가능합니다.")
    exp_dir = os.path.join(DATA_ROOT, name)
    if os.path.exists(exp_dir):
        raise HTTPException(status_code=409, detail=f"실험 '{name}'이 이미 존재합니다.")
    os.makedirs(os.path.join(exp_dir, "uploads"), exist_ok=True)
    return {"created": name, "start_command": f"./elog.sh -e {name}"}


@router.post("/experiments/{name}/start-server")
def start_experiment_server(
    name: str,
    current_user: models.User = Depends(require_manager),
):
    """오프라인 실험의 서버를 시작합니다. 빈 포트를 자동 할당하고 포트 번호를 반환합니다."""
    exp_dir = os.path.join(DATA_ROOT, name)
    if not os.path.exists(exp_dir):
        raise HTTPException(status_code=404, detail=f"실험 '{name}'이 존재하지 않습니다.")

    # 이미 실행 중이면 기존 포트 반환 (실제로 살아있을 때만)
    port_file = os.path.join(exp_dir, ".port")
    if os.path.isfile(port_file):
        try:
            existing_port = int(open(port_file).read().strip())
            if _port_alive(existing_port):
                return {"port": existing_port, "already_running": True}
            # 죽은 서버의 stale 파일 제거 후 재시작
            os.remove(port_file)
        except Exception:
            pass

    # 빈 포트 찾기
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        port = s.getsockname()[1]

    # 포트 파일 먼저 기록
    os.makedirs(exp_dir, exist_ok=True)
    with open(port_file, "w") as f:
        f.write(str(port))

    # uvicorn 백그라운드 실행
    backend_dir = os.path.dirname(os.path.abspath(__file__))  # routes/
    backend_dir = os.path.dirname(backend_dir)                 # backend/
    env = {**os.environ, "ELOG_EXPERIMENT": name}
    subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", "0.0.0.0", "--port", str(port), "--workers", "1"],
        cwd=backend_dir,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    return {"port": port, "already_running": False}


# ── Community system notification ────────────────────────────────────────────

def _notify_community_chat(entry, db: Session) -> None:
    """Post a system message to the community chat when a log is created.
    Only fires when the log's format has notify_community=True."""
    if not entry.format_id:
        return
    try:
        fmt = db.query(models.LogFormat).filter(models.LogFormat.id == entry.format_id).first()
        if not fmt or not fmt.notify_community:
            return
        title = (entry.title or "").strip() or "(제목 없음)"
        body = f"새 로그 등록: #{entry.id} {title}"
        msg = models.ChatMessage(
            author_id=None,
            author_name="system",
            body=body,
            log_id=entry.id,
            log_title=entry.title,
            is_cross_posted=True,
            is_system=True,
        )
        db.add(msg)
        db.commit()
    except Exception:
        pass  # 알림 실패가 로그 저장에 영향을 주지 않도록


# ── Audit ─────────────────────────────────────────────────────────────────────

def _audit(db: Session, action: str, entity_type: str, entity_id: int, actor: str):
    ev = models.AuditEvent(action=action, entity_type=entity_type, entity_id=entity_id, actor=actor)
    db.add(ev)
    db.commit()
