"""
Phase 7 — webhook fetcher for service-backed task logs.

Service contract (as documented in the Experiment-tab Manual modal):

  POST  <service.request_url>
    body: {format_id, format_name, task_log_id, requested_at, mode}
  response (success):
    {fields: {<key>: <value | {value,error,…}>, …}, title?: str, body?: str}

Failure modes (timeout, non-200, non-JSON, malformed) raise WebhookError. The
caller decides how to record the error — typically by writing a comment on
the related task log and leaving it for a shifter to fill manually.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

import models
from utils_fields import normalize_format_fields
from utils_tasks  import add_confirmation_required


WEBHOOK_TIMEOUT_SEC = 5.0
USER_AGENT = "lilak-elog-webhook/1.0 (+https://github.com/)"


class WebhookError(Exception):
    """Raised when a service webhook call fails for any reason."""


# ── Low-level fetch ──────────────────────────────────────────────────────────

def fetch_service(
    svc: models.Service,
    format_id: Optional[int],
    format_name: str = "",
    task_log_id: Optional[int] = None,
    mode: str = "task",
    run_number: Optional[int] = None,
    timeout: float = WEBHOOK_TIMEOUT_SEC,
) -> dict:
    """POST the elog → service request envelope and return parsed JSON.

    `mode` ∈ {"task", "snapshot", "realtime"} per the manual.
    `run_number` is the run elog is asking about (the task's run for task fills,
    the current run otherwise); the service may use it to scope its reply or
    ignore it. Always returns a dict on success. Raises WebhookError otherwise.
    """
    if not svc or not svc.request_url:
        raise WebhookError("service has no request_url")

    envelope = {
        "format_id":    format_id,
        "format_name":  format_name,
        "task_log_id":  task_log_id,
        "run_number":   run_number,
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "mode":         mode,
    }
    body = json.dumps(envelope).encode("utf-8")

    req = urllib.request.Request(
        svc.request_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept":       "application/json",
            "User-Agent":   USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                raise WebhookError(f"HTTP {resp.status}")
            raw = resp.read()
    except urllib.error.HTTPError as he:
        try:
            err_text = he.read(512).decode("utf-8", errors="replace")
        except Exception:
            err_text = ""
        raise WebhookError(f"HTTP {he.code}: {err_text}") from he
    except urllib.error.URLError as ue:
        raise WebhookError(f"URL error: {ue.reason}") from ue
    except (TimeoutError, OSError) as e:
        raise WebhookError(f"timeout / network: {e}") from e

    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise WebhookError(f"invalid JSON response: {e}") from e
    if not isinstance(data, dict):
        raise WebhookError("response is not a JSON object")
    return data


# ── Apply response → entry ───────────────────────────────────────────────────

def apply_response_to_log(entry: models.LogEntry, response: dict, db: Session) -> None:
    """Mutate the entry in place using a webhook response. `fields` are
    normalized so number_entry values come out canonical."""
    fields = dict(response.get("fields") or {})   # mutable copy

    # Title / body can come either as top-level keys or inside `fields`.
    if "title" in response and response["title"]:
        entry.title = response["title"]
    elif "title" in fields and fields["title"]:
        entry.title = fields.pop("title")

    if "body" in response and response["body"]:
        entry.body = response["body"]
    elif "body" in fields and fields["body"]:
        entry.body = fields.pop("body")

    if fields:
        fmt_fields_def = []
        if entry.format_id:
            fmt = db.query(models.LogFormat).filter(
                models.LogFormat.id == entry.format_id).first()
            if fmt and fmt.fields_json:
                try:
                    fmt_fields_def = json.loads(fmt.fields_json)
                except Exception:
                    pass
        normalized = normalize_format_fields(fields, fmt_fields_def)
        entry.format_fields_json = json.dumps(normalized) if normalized else None


# ── High-level: fill a task log via webhook (success → confirm-tag) ──────────

def fill_task_via_webhook(task_log: models.LogEntry, svc: models.Service,
                          db: Session) -> tuple[bool, str]:
    """Attempt to fill `task_log` by calling `svc.request_url`.

    On success: applies response, tags `confirmation required`, returns
                (True, "ok").
    On failure: posts a comment on the task log with the error message,
                leaves the log empty for manual fill, returns (False, msg).
    """
    if not svc or not svc.request_url:
        return False, "no request_url"

    fmt_name = ""
    if task_log.format_id:
        fmt = db.query(models.LogFormat).filter(
            models.LogFormat.id == task_log.format_id).first()
        fmt_name = fmt.name if fmt else ""

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    try:
        response = fetch_service(
            svc, task_log.format_id, format_name=fmt_name,
            task_log_id=task_log.id, mode="task", run_number=task_log.run_number,
        )
    except WebhookError as we:
        # Record the failure as a comment so the shifter sees what happened.
        try:
            db.add(models.Comment(
                log_id=task_log.id,
                author_id=None,
                author_name=f"<webhook:{svc.name}>",
                body=f"⚠ Webhook fetch failed: {we}",
            ))
            svc.last_request_at = now
            db.commit()
        except Exception:
            db.rollback()
        return False, str(we)

    try:
        apply_response_to_log(task_log, response, db)
        add_confirmation_required(task_log, db)
        svc.last_request_at = now
        db.commit()
        return True, "ok"
    except Exception as e:
        db.rollback()
        return False, f"apply failed: {e}"
