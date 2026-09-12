"""
Experiment-tab Service routes.

A `Service` is an external data source (HV module, vacuum gauge, beam DAQ
subsystem, etc.) that fills task logs on request or — for subsystems —
pushes them on its own.

Phase 1b ships only the data layer:
    • CRUD (read for everyone, mutate for managers)
    • The "request now" / "real-time" / scheduled-fetch actions are stubbed
      and will be wired in Phases 6/7.
"""

from datetime import datetime
from typing import Optional

import secrets as _secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel as _BaseModel
from sqlalchemy.orm import Session

import models
import portal_peer
import schemas
from auth import require_auth, require_manager
from audit_log import record as _audit
from database import get_db
from seed_formats import (
    sync_system_formats, detach_system_formats,
    sync_subsystem_formats, detach_subsystem_formats,
    link_main_system_formats, unlink_main_system_formats,
    unlink_named_system_formats,
)
from utils_webhook import fetch_service, apply_response_to_log, WebhookError
from utils_tasks   import add_confirmation_required, inherit_context
from sqlalchemy import func
import json


router = APIRouter(tags=["services"])

HANDSHAKE_TIMEOUT_SEC = 5.0


def _to_out(svc: models.Service) -> schemas.ServiceOut:
    return schemas.ServiceOut(
        id=svc.id,
        name=svc.name,
        description=svc.description,
        ip=svc.ip,
        hostname=svc.hostname,
        directory=svc.directory,
        request_url=svc.request_url,
        is_system=svc.is_system,
        is_subsystem=svc.is_subsystem,
        is_main_system=svc.is_main_system,
        max_interval_sec=svc.max_interval_sec,
        realtime_interval_sec=svc.realtime_interval_sec,
        request_required=svc.request_required if svc.request_required is not None else True,
        realtime_enabled=svc.realtime_enabled,
        is_active=svc.is_active,
        last_request_at=svc.last_request_at,
        next_request_at=svc.next_request_at,
        created_at=svc.created_at,
        updated_at=svc.updated_at,
        created_by=svc.created_by,
        format_ids=[f.id for f in svc.log_formats],
        format_names=[f.name for f in svc.log_formats],
    )


def _resolve_formats(db: Session, ids: list[int]) -> list[models.LogFormat]:
    if not ids:
        return []
    fmts = db.query(models.LogFormat).filter(models.LogFormat.id.in_(ids)).all()
    found = {f.id for f in fmts}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown format ids: {missing}")
    return fmts


# ── Handshake discover ──────────────────────────────────────────────────────

def _do_handshake(url: str, elog_url: str) -> dict:
    """POST the elog_handshake envelope to `url` and return parsed dict.
    Raises WebhookError on any failure.

    `url` may be `portal://<service>/<path>` — a portal-managed service has no
    fixed port, so Discover accepts the scheme and resolves it here, exactly as
    every later data request will.
    """
    import urllib.request, urllib.error
    try:
        url = portal_peer.resolve(url)
    except portal_peer.PortalPeerError as pe:
        raise WebhookError(str(pe)) from pe
    envelope = json.dumps({
        "event":    "elog_handshake",
        "elog_url": elog_url,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=envelope,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HANDSHAKE_TIMEOUT_SEC) as resp:
            raw = resp.read()
    except Exception as e:
        raise WebhookError(str(e)) from e
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise WebhookError(f"invalid JSON: {e}") from e
    if not isinstance(data, dict):
        raise WebhookError("response is not a JSON object")
    return data


class _DiscoverReq(_BaseModel):
    url:      str
    elog_url: Optional[str] = None   # caller (frontend) supplies window.location.origin


@router.post("/services/discover")
def discover_service(
    payload: _DiscoverReq,
    current_user: models.User = Depends(require_auth),
):
    """Attempt the elog_handshake with the given URL.
    Returns the registration info on success, or {ok:false, error:...} on failure."""
    import os
    elog_url = payload.elog_url or os.environ.get("ELOG_PUBLIC_URL", "http://localhost:8000")
    try:
        data = _do_handshake(payload.url, elog_url)
    except WebhookError as we:
        return {"ok": False, "error": str(we)}
    return {"ok": True, "data": data}


class _TestConnReq(_BaseModel):
    url: str


@router.post("/services/test-connection")
def test_connection(
    payload: _TestConnReq,
    current_user: models.User = Depends(require_auth),
):
    """Lightweight reachability check for a web service URL — server-side so it
    isn't blocked by browser CORS. No side effects: just opens the connection
    and reports whether the server responded. An HTTP error code still counts
    as 'reachable' (the host answered); only connect/timeout failures are down."""
    import urllib.request, urllib.error, time
    url = (payload.url or "").strip()
    if not url:
        return {"ok": False, "error": "URL이 비어 있습니다"}
    # portal:// 은 여기서도 풀어줘야 [연결 테스트]가 등록과 같은 곳을 봅니다.
    try:
        url = portal_peer.resolve(url)
    except portal_peer.PortalPeerError as pe:
        return {"ok": False, "error": str(pe)}
    t0 = time.time()
    try:
        req = urllib.request.Request(
            url, method="GET",
            headers={"Accept": "*/*", "User-Agent": "lilak-elog/connection-test"},
        )
        with urllib.request.urlopen(req, timeout=HANDSHAKE_TIMEOUT_SEC) as resp:
            code = resp.status
        return {"ok": True, "status": code, "ms": round((time.time() - t0) * 1000)}
    except urllib.error.HTTPError as e:
        return {"ok": True, "status": e.code, "ms": round((time.time() - t0) * 1000),
                "detail": f"HTTP {e.code}"}
    except Exception as e:
        return {"ok": False, "error": str(e), "ms": round((time.time() - t0) * 1000)}


def _send_credentials(command_url: str, elog_url: str, token: str) -> None:
    """command_url로 elog_credentials 이벤트를 전송합니다. 실패 시 예외를 던집니다.

    command_url은 portal://<service>/<path> 형식도 됩니다 (portal_peer 참고).
    """
    import urllib.request
    try:
        command_url = portal_peer.resolve(command_url)
    except portal_peer.PortalPeerError as pe:
        raise WebhookError(str(pe)) from pe
    envelope = json.dumps({
        "event":      "elog_credentials",
        "elog_url":   elog_url,
        "elog_token": token,
    }).encode("utf-8")
    req = urllib.request.Request(
        command_url, data=envelope,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HANDSHAKE_TIMEOUT_SEC) as resp:
            if resp.status not in (200, 201, 204):
                raise WebhookError(f"HTTP {resp.status}")
    except WebhookError:
        raise
    except Exception as e:
        raise WebhookError(str(e)) from e


def _fields_signature(fields_list: list[dict]) -> frozenset:
    """Canonical fingerprint of a field list for duplicate detection.
    Order-independent; uses (key, field_type, builtin_id) tuples."""
    return frozenset(
        (f.get("key"), f.get("field_type"), f.get("builtin_id"))
        for f in fields_list
    )


def _auto_create_log_format(
    svc: models.Service,
    log_fields: list[schemas.DiscoverField],
    db: Session,
) -> Optional[models.LogFormat]:
    """Find-or-create a log format from the handshake log_fields and link it to `svc`.
    If a format with the same name and same field signature already exists,
    reuse it instead of creating a duplicate."""
    if not log_fields:
        return None

    BUILTIN_TYPES = {"body", "title", "tags", "level"}

    format_name = f"{svc.name} log"

    fields_list = []
    for i, lf in enumerate(log_fields):
        if lf.type in BUILTIN_TYPES:
            fields_list.append({
                "key":        lf.key,
                "label":      lf.label,
                "field_type": "builtin",
                "builtin_id": lf.type,
                "required":   False,
                "order":      i,
            })
        else:
            fields_list.append({
                "key":        lf.key,
                "label":      lf.label,
                "field_type": lf.type,
                "variant":    "single" if lf.type == "number_entry" else None,
                "unit":       getattr(lf, "unit", None),
                # number / number_entry fields can be flagged as Infography metrics
                "metric":     bool(getattr(lf, "metric", False)) and lf.type in ("number", "number_entry"),
                # A service may declare a `select` too, so a handshake-registered
                # format offers the same dropdown a hand-made one does.
                "options":    list(getattr(lf, "options", None) or []) if lf.type == "select" else None,
                "accumulate": bool(getattr(lf, "accumulate", True)),
                "required":   False,
                "order":      i,
            })

    new_sig = _fields_signature(fields_list)

    # Look for an existing format with the same name and same field signature
    existing = (
        db.query(models.LogFormat)
        .filter(models.LogFormat.name == format_name)
        .all()
    )
    for candidate in existing:
        try:
            candidate_fields = json.loads(candidate.fields_json or "[]")
        except Exception:
            continue
        if _fields_signature(candidate_fields) == new_sig:
            # Reuse — just make sure svc is linked
            if candidate not in svc.log_formats:
                svc.log_formats.append(candidate)
            return candidate

    # Nothing matched — create a new format
    fmt = models.LogFormat(
        name=format_name,
        fields_json=json.dumps(fields_list),
        format_type="system",
        task_type=None,
        is_default=False,
        system_id=svc.id if svc.is_system else None,
    )
    db.add(fmt)
    db.flush()
    svc.log_formats.append(fmt)
    return fmt


class _CredsReq(_BaseModel):
    pass


@router.post("/services/{svc_id}/rehandshake")
def rehandshake(
    svc_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Ask a registered service to describe itself again, and adopt the answer.

    A service's field list is not frozen. MTE declares the channels its CURRENT
    profile reads, so choosing a different profile changes what it has to say
    about itself. Registration used to be the only moment elog ever asked, which
    left deleting the service and adding it back as the only way to pick a
    change up — taking its task template, its schedule and its history of
    settings with it.

    The superseded format is unlinked, not deleted: logs already written against
    it still need their field definitions to render their own labels.
    """
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if not svc.request_url:
        raise HTTPException(status_code=400, detail="This service has no request URL")

    try:
        data = _do_handshake(svc.request_url, portal_peer.self_url(""))
    except WebhookError as we:
        return {"ok": False, "error": str(we)}

    raw_fields = data.get("log_fields") or []
    if not raw_fields:
        return {"ok": True, "changed": False, "fields": 0,
                "detail": "이 서비스는 log_fields 를 선언하지 않습니다."}

    try:
        parsed = [schemas.DiscoverField.model_validate(f) for f in raw_fields]
    except Exception as err:                                   # noqa: BLE001
        return {"ok": False, "error": f"log_fields 를 읽을 수 없습니다: {err}"}

    linked_before = {f.id for f in svc.log_formats}
    fmt = _auto_create_log_format(svc, parsed, db)
    if fmt is None:
        return {"ok": True, "changed": False, "fields": len(parsed)}

    # One service holding two formats of the same name makes _pick_format_id a
    # coin toss, and the loser is whichever one the next push happens to land in.
    superseded = [f for f in svc.log_formats if f.id != fmt.id and f.name == fmt.name]
    for old in superseded:
        svc.log_formats.remove(old)

    db.commit()
    db.refresh(svc)
    _audit(db, "rehandshake", "service", svc.id, current_user.username, svc.name)
    return {
        "ok": True,
        "changed": fmt.id not in linked_before or bool(superseded),
        "format_id": fmt.id,
        "format_name": fmt.name,
        "fields": len(parsed),
        "reused": fmt.id in linked_before,
        "superseded": [{"id": f.id, "name": f.name} for f in superseded],
    }


@router.post("/services/{svc_id}/send-credentials")
def resend_credentials(
    svc_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Send this system its elog URL + API token again.

    Done here rather than from the browser. The browser cannot do it for a
    portal-managed system at all -- that service listens on loopback only, so
    a fetch from someone's laptop never reaches it -- and it does not know the
    address to hand back either (see portal_peer.self_url).
    """
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if not svc.is_system:
        raise HTTPException(status_code=400, detail="Only a system receives credentials")
    if not svc.request_url:
        raise HTTPException(status_code=400, detail="This system has no command URL")

    token = (db.query(models.ApiToken)
               .filter(models.ApiToken.source_name == svc.name,
                       models.ApiToken.is_active == True)      # noqa: E712
               .order_by(models.ApiToken.id.desc())
               .first())
    if not token:
        raise HTTPException(status_code=404,
                            detail="This system has no active token; re-register it")

    elog_url = portal_peer.self_url("")
    try:
        _send_credentials(svc.request_url, elog_url, token.token)
    except WebhookError as we:
        return {"ok": False, "elog_url": elog_url, "error": str(we)}
    return {"ok": True, "elog_url": elog_url}


# ── List / detail ────────────────────────────────────────────────────────────

@router.get("/services", response_model=list[schemas.ServiceOut])
def list_services(
    is_subsystem: Optional[bool] = None,
    is_system: Optional[bool] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    """Public list — anyone can see services / systems."""
    q = db.query(models.Service)
    # Support both query params; is_system takes priority
    filter_flag = is_system if is_system is not None else is_subsystem
    if filter_flag is not None:
        q = q.filter(models.Service.is_system == filter_flag)
    if not include_inactive:
        q = q.filter(models.Service.is_active == True)
    rows = q.order_by(models.Service.is_system.desc(),
                      models.Service.name).all()
    return [_to_out(s) for s in rows]


@router.get("/services/{svc_id}", response_model=schemas.ServiceOut)
def get_service(svc_id: int, db: Session = Depends(get_db)):
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return _to_out(svc)


# ── Create / update / delete (manager only) ──────────────────────────────────

@router.post("/services", response_model=schemas.ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(
    payload: schemas.ServiceCreate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if db.query(models.Service).filter(models.Service.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Service name already in use")

    # Only one main system is allowed at a time.
    effective_is_main = bool(payload.is_main_system) and (payload.is_system or payload.is_subsystem)
    if effective_is_main:
        existing_main = db.query(models.Service).filter(
            models.Service.is_main_system == True
        ).first()
        if existing_main:
            raise HTTPException(status_code=400, detail="A main system already exists")

    # Resolve is_system: prefer the new field, fall back to legacy is_subsystem
    effective_is_system = payload.is_system or payload.is_subsystem
    svc = models.Service(
        name=payload.name,
        description=payload.description,
        ip=payload.ip,
        hostname=payload.hostname,
        directory=payload.directory,
        request_url=payload.request_url,
        is_system=effective_is_system,
        is_subsystem=effective_is_system,   # keep in sync
        is_main_system=effective_is_main,
        max_interval_sec=payload.max_interval_sec,
        realtime_interval_sec=payload.realtime_interval_sec,
        request_required=payload.request_required,
        is_active=payload.is_active,
        created_by=current_user.username,
    )
    svc.log_formats = _resolve_formats(db, payload.format_ids or [])
    db.add(svc)
    db.flush()                                # need svc.id before sync
    # Main system → link global Init/Start/End/Monitoring formats (no named copies).
    # Subsystem → create named Start of {Name} run formats.
    if effective_is_main:
        # Drop any S/E/M run-type formats the client may have pre-selected;
        # a main system uses only the global run-log formats.
        svc.log_formats = [
            f for f in svc.log_formats
            if f.task_type not in ("init_of_run", "start_of_run", "end_of_run", "monitoring_run")
        ]
        link_main_system_formats(svc, db)
    elif svc.is_system:
        sync_system_formats(svc, db)
    # Auto-create log format from handshake log_fields if provided.
    if payload.log_fields:
        _auto_create_log_format(svc, payload.log_fields, db)
    db.commit()
    db.refresh(svc)
    _audit(db, "register", "service", svc.id, current_user.username, svc.name)

    # ── 시스템: token 자동발급 + credentials 자동전송 ─────────────────────────
    token_str = None
    cred_sent = None
    cred_error = None
    if svc.is_system:
        # Revoke all previous tokens for this service so old credentials stop working.
        db.query(models.ApiToken).filter(
            models.ApiToken.source_name == svc.name
        ).delete(synchronize_session=False)
        token_str = "elog_" + _secrets.token_urlsafe(32)
        api_token = models.ApiToken(
            name=svc.name,
            token=token_str,
            source_name=svc.name,
        )
        db.add(api_token)
        db.commit()

        # command_url(request_url)이 있으면 credentials 전송 시도
        if svc.request_url:
            # NOT the browser's origin, which is the PORTAL's -- a system posting
            # to <origin>/api/logs would hit the portal, and going through the
            # portal proxy needs a portal session the system does not have.
            # self_url() hands back the address the system can actually reach.
            elog_url = portal_peer.self_url(payload.elog_url or "")
            try:
                _send_credentials(svc.request_url, elog_url, token_str)
                cred_sent = True
            except Exception as e:
                cred_sent = False
                cred_error = str(e)

    out = _to_out(svc)
    out.token = token_str
    out.credentials_sent = cred_sent
    out.credentials_error = cred_error
    return out


@router.put("/services/{svc_id}", response_model=schemas.ServiceOut)
def update_service(
    svc_id: int,
    payload: schemas.ServiceUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")

    # Reject duplicate name (other row owns it)
    if payload.name and payload.name != svc.name:
        conflict = db.query(models.Service).filter(
            models.Service.name == payload.name,
            models.Service.id != svc_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Service name already in use")

    was_system = svc.is_system
    was_main = svc.is_main_system
    old_name = svc.name

    for field in ("name", "description", "ip", "hostname", "directory", "request_url",
                  "max_interval_sec", "realtime_interval_sec",
                  "realtime_enabled", "request_required", "is_active"):
        val = getattr(payload, field, None)
        if val is not None:
            setattr(svc, field, val)

    # Resolve is_system: prefer the new field, fall back to legacy is_subsystem
    if payload.is_system is not None:
        svc.is_system = payload.is_system
        svc.is_subsystem = payload.is_system
    elif payload.is_subsystem is not None:
        svc.is_system = payload.is_subsystem
        svc.is_subsystem = payload.is_subsystem

    # is_main_system transition
    if payload.is_main_system is not None:
        new_main = bool(payload.is_main_system) and svc.is_system
        if new_main and not was_main:
            # Check no other main system exists
            other_main = db.query(models.Service).filter(
                models.Service.is_main_system == True,
                models.Service.id != svc_id,
            ).first()
            if other_main:
                raise HTTPException(status_code=400, detail="A main system already exists")
        svc.is_main_system = new_main

    if payload.format_ids is not None:
        svc.log_formats = _resolve_formats(db, payload.format_ids)

    # System / main-system flag transitions
    now_main = svc.is_main_system
    if now_main:
        # Main system: unlink any named S/E/M formats, then link the globals.
        unlink_named_system_formats(svc, db)
        detach_system_formats(svc, db)
        link_main_system_formats(svc, db)
    elif svc.is_system:
        # Regular subsystem
        if was_main:
            # Demoted from main → unlink global formats, create named ones
            unlink_main_system_formats(svc, db)
        sync_system_formats(svc, db)
    elif was_system and not svc.is_system:
        if was_main:
            unlink_main_system_formats(svc, db)
        detach_system_formats(svc, db)

    # ── The token has to follow the service ──────────────────────────────────
    # An API token carries a COPY of the service name (create_log resolves a
    # pusher by api_token.source_name), and one was only ever minted at
    # registration. Two ways that broke, both silent:
    #
    #   • a rename left the token pointing at a name no service has any more, so
    #     send-credentials found nothing and a push resolved to no service;
    #   • a service PROMOTED to system here never got a token at all — a system
    #     that can never be handed credentials, and therefore never pushes a
    #     single run boundary. It just quietly says nothing forever.
    if svc.is_system:
        if old_name != svc.name:
            db.query(models.ApiToken).filter(
                models.ApiToken.source_name == old_name
            ).update({"source_name": svc.name, "name": svc.name},
                     synchronize_session=False)
        has_token = (db.query(models.ApiToken)
                       .filter(models.ApiToken.source_name == svc.name,
                               models.ApiToken.is_active == True)          # noqa: E712
                       .first())
        if not has_token:
            token_str = "elog_" + _secrets.token_urlsafe(32)
            db.add(models.ApiToken(name=svc.name, token=token_str, source_name=svc.name))
            db.commit()
            if svc.request_url:
                # A stopped system is the ordinary case, not an error — the
                # credentials can be resent from the connector tab.
                try:
                    _send_credentials(svc.request_url, portal_peer.self_url(""), token_str)
                except WebhookError:
                    pass

    db.commit()
    db.refresh(svc)
    return _to_out(svc)


@router.delete("/services/{svc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    svc_id: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    # Auto-formats outlive the service so existing logs keep their schema;
    # they're just unlinked.
    if svc.is_system:
        detach_system_formats(svc, db)
    db.delete(svc)
    db.commit()


# ── Phase 7: action endpoints ────────────────────────────────────────────────

def _current_run_number(db: Session) -> Optional[int]:
    """The run elog tells a service about on a manual/realtime request.

    Delegates to routes.logs so there is one definition of "the current run".
    This used to be MAX(run_number) over every log, which answered a different
    question and lost to any named system whose own counter ran ahead — every
    monitoring log came back stamped with MTE's run number instead of the
    experiment's."""
    from routes.logs import current_run_number
    return current_run_number(db)


def _pick_format_id(svc: models.Service, requested_format_id: Optional[int]) -> Optional[int]:
    """Pick which format to send when the caller didn't specify one.
    Prefers a system format on the service; falls back to the first linked
    format, or None when the service has no formats wired up."""
    if requested_format_id:
        return requested_format_id
    if not svc.log_formats:
        return None
    system_fmt = next((f for f in svc.log_formats if f.format_type == "system"), None)
    return (system_fmt or svc.log_formats[0]).id


@router.post("/services/{svc_id}/request-now", status_code=status.HTTP_200_OK)
def request_now(
    svc_id: int,
    format_id: Optional[int] = None,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """One-shot fetch — returns the service's raw JSON response so the UI can
    show it in a quick-look modal. Does NOT write any logs."""
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if not svc.request_url:
        raise HTTPException(status_code=400, detail="service has no request_url")
    fid = _pick_format_id(svc, format_id)
    fname = ""
    if fid:
        fmt = db.query(models.LogFormat).filter(models.LogFormat.id == fid).first()
        fname = fmt.name if fmt else ""
    try:
        data = fetch_service(svc, fid, format_name=fname, mode="snapshot", run_number=_current_run_number(db))
    except WebhookError as we:
        raise HTTPException(status_code=502, detail=f"Webhook failed: {we}")
    svc.last_request_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "format_id": fid, "response": data}


@router.post("/services/{svc_id}/request-log", response_model=schemas.LogEntryDetail)
def request_log(
    svc_id: int,
    format_id: Optional[int] = None,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Fetch the service NOW and create a new log from the response. The
    resulting log is tagged `confirmation required` so a shifter reviews it."""
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if not svc.request_url:
        raise HTTPException(status_code=400, detail="service has no request_url")

    fid = _pick_format_id(svc, format_id)
    fname = ""
    if fid:
        fmt = db.query(models.LogFormat).filter(models.LogFormat.id == fid).first()
        fname = fmt.name if fmt else ""

    try:
        data = fetch_service(svc, fid, format_name=fname, mode="task", run_number=_current_run_number(db))
    except WebhookError as we:
        raise HTTPException(status_code=502, detail=f"Webhook failed: {we}")

    # Build an empty log, apply the response, then commit.
    from database import next_log_index
    from utils_tasks import system_run_number
    next_log_idx = next_log_index(db)
    # Stamp the run this log is ABOUT. It was left blank, so a manual request
    # produced an entry with no run at all — even when its own title said
    # "Run 142 running" — and it could not be found by a run search or grouped
    # with the rest of that run. Same rule the task chain uses: a named system's
    # format carries that system's own counter, everything else the experiment's.
    fmt_obj = db.query(models.LogFormat).filter(models.LogFormat.id == fid).first() if fid else None
    own_run = bool(fmt_obj and (fmt_obj.system_id is not None or fmt_obj.subsystem_id is not None))
    run_no = system_run_number(fmt_obj, db) if own_run else _current_run_number(db)
    ctx_beam, ctx_target = inherit_context(db)
    entry = models.LogEntry(
        log_index=next_log_idx,
        title=svc.name,
        body="",
        beam=ctx_beam,
        target=ctx_target,
        author_id=None,
        author_name=f"<service:{svc.name}>",
        level="info",
        run_type=None,
        run_number=run_no,
        run_number_type="single",
        source=f"service:{svc.name}",
        is_auto=True,
        format_id=fid,
    )
    db.add(entry)
    db.flush()

    apply_response_to_log(entry, data, db)
    add_confirmation_required(entry, db)
    svc.last_request_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)

    # Use the logs serializer for consistency.
    from routes.logs import _entry_to_detail
    return _entry_to_detail(entry, db)


@router.post("/services/{svc_id}/realtime")
def toggle_realtime(
    svc_id: int,
    enable: bool,
    interval_sec: Optional[float] = None,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Toggle the realtime-monitoring flag. Persists state; the actual
    polling loop is driven from the client (Experiment-tab page) calling
    /request-now on the cadence configured here. A server-side scheduler
    can replace the client loop later without changing this API."""
    svc = db.query(models.Service).filter(models.Service.id == svc_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    svc.realtime_enabled = enable
    if interval_sec is not None and interval_sec > 0:
        svc.realtime_interval_sec = interval_sec
    db.commit()
    return {"ok": True, "realtime_enabled": svc.realtime_enabled,
            "interval_sec": svc.realtime_interval_sec}
