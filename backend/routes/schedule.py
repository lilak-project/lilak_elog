"""
Schedule routes — events (experiments / shifts) and shift patterns.
Also derives run spans from log entries with Start/End of Run formats.
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

import models
import schemas
from auth import require_auth, require_manager
from database import get_db

router = APIRouter(tags=["schedule"])


# ── Shift patterns ────────────────────────────────────────────────────────────

def _pattern_to_out(p: models.ShiftPattern) -> schemas.ShiftPatternOut:
    try:
        slots = [schemas.ShiftSlot(**s) for s in json.loads(p.slots_json)]
    except Exception:
        slots = []
    try:
        roles = list(json.loads(p.roles_json))
    except Exception:
        roles = []
    return schemas.ShiftPatternOut(
        id=p.id, name=p.name, slots=slots, roles=roles,
        effective_from=p.effective_from, effective_to=p.effective_to,
        is_active=p.is_active, created_at=p.created_at, created_by=p.created_by,
    )


@router.get("/schedule/shift-patterns", response_model=list[schemas.ShiftPatternOut])
def list_patterns(db: Session = Depends(get_db)):
    rows = db.query(models.ShiftPattern).order_by(models.ShiftPattern.created_at).all()
    return [_pattern_to_out(p) for p in rows]


@router.post("/schedule/shift-patterns", response_model=schemas.ShiftPatternOut,
             status_code=status.HTTP_201_CREATED)
def create_pattern(
    payload: schemas.ShiftPatternCreate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = models.ShiftPattern(
        name=payload.name,
        slots_json=json.dumps([s.model_dump() for s in payload.slots]),
        roles_json=json.dumps(payload.roles),
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        is_active=payload.is_active,
        created_by=current_user.username,
    )
    db.add(p); db.commit(); db.refresh(p)
    return _pattern_to_out(p)


@router.put("/schedule/shift-patterns/{pid}", response_model=schemas.ShiftPatternOut)
def update_pattern(
    pid: int,
    payload: schemas.ShiftPatternUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.query(models.ShiftPattern).filter(models.ShiftPattern.id == pid).first()
    if not p:
        raise HTTPException(404, "Pattern not found")
    if payload.name is not None:
        p.name = payload.name
    if payload.slots is not None:
        p.slots_json = json.dumps([s.model_dump() for s in payload.slots])
    if payload.roles is not None:
        p.roles_json = json.dumps(payload.roles)
    if payload.effective_from is not None:
        p.effective_from = payload.effective_from or None
    if payload.effective_to is not None:
        p.effective_to = payload.effective_to or None
    if payload.is_active is not None:
        p.is_active = payload.is_active
    db.commit(); db.refresh(p)
    return _pattern_to_out(p)


@router.delete("/schedule/shift-patterns/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pattern(
    pid: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.query(models.ShiftPattern).filter(models.ShiftPattern.id == pid).first()
    if not p:
        raise HTTPException(404, "Pattern not found")
    try:
        # Defensively clear any references in shift events (FK is SET NULL, but
        # SQLite doesn't enforce FKs by default — do it explicitly).
        db.query(models.ScheduleEvent)\
          .filter(models.ScheduleEvent.shift_pattern_id == pid)\
          .update({"shift_pattern_id": None}, synchronize_session=False)
        db.delete(p)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Delete failed: {e}")


# ── Schedule events ───────────────────────────────────────────────────────────

@router.get("/schedule/events", response_model=list[schemas.ScheduleEventOut])
def list_events(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    event_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.ScheduleEvent)
    if start:
        q = q.filter(models.ScheduleEvent.end_at >= start)
    if end:
        q = q.filter(models.ScheduleEvent.start_at <= end)
    if event_type:
        q = q.filter(models.ScheduleEvent.event_type == event_type)
    return q.order_by(models.ScheduleEvent.start_at).all()


@router.post("/schedule/events", response_model=schemas.ScheduleEventOut,
             status_code=status.HTTP_201_CREATED)
def create_event(
    payload: schemas.ScheduleEventCreate,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if payload.end_at < payload.start_at:
        raise HTTPException(400, "end_at must be after start_at")
    if payload.event_type not in ("experiment", "shift", "other"):
        raise HTTPException(400, "Invalid event_type")

    ev = models.ScheduleEvent(
        title=payload.title,
        description=payload.description,
        start_at=payload.start_at,
        end_at=payload.end_at,
        event_type=payload.event_type,
        color=payload.color,
        data_type=payload.data_type,
        shift_pattern_id=payload.shift_pattern_id,
        shift_slot_label=payload.shift_slot_label,
        shift_role=payload.shift_role,
        assigned_user_id=payload.assigned_user_id,
        assigned_user_name=payload.assigned_user_name,
        created_by=current_user.username,
    )
    db.add(ev); db.commit(); db.refresh(ev)
    return ev


@router.put("/schedule/events/{eid}", response_model=schemas.ScheduleEventOut)
def update_event(
    eid: int,
    payload: schemas.ScheduleEventUpdate,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    ev = db.query(models.ScheduleEvent).filter(models.ScheduleEvent.id == eid).first()
    if not ev:
        raise HTTPException(404, "Event not found")
    # Permission: creator, assigned user, or manager
    if (current_user.role != "manager"
        and ev.created_by != current_user.username
        and ev.assigned_user_id != current_user.id):
        raise HTTPException(403, "Not allowed")

    for f in ("title", "description", "start_at", "end_at", "event_type", "color",
              "data_type", "shift_pattern_id", "shift_slot_label", "shift_role",
              "assigned_user_id", "assigned_user_name"):
        v = getattr(payload, f, None)
        if v is not None:
            setattr(ev, f, v)
    if ev.end_at < ev.start_at:
        raise HTTPException(400, "end_at must be after start_at")
    db.commit(); db.refresh(ev)
    return ev


@router.delete("/schedule/events/{eid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    eid: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    ev = db.query(models.ScheduleEvent).filter(models.ScheduleEvent.id == eid).first()
    if not ev:
        raise HTTPException(404, "Event not found")
    if (current_user.role != "manager"
        and ev.created_by != current_user.username
        and ev.assigned_user_id != current_user.id):
        raise HTTPException(403, "Not allowed")
    db.delete(ev); db.commit()


# ── Run spans (derived from log entries) ──────────────────────────────────────

def _format_id_by_name(db: Session, name: str) -> Optional[int]:
    fmt = db.query(models.LogFormat).filter(models.LogFormat.name == name).first()
    return fmt.id if fmt else None


# ── Active shift pattern ──────────────────────────────────────────────────────

@router.get("/schedule/active-pattern", response_model=Optional[schemas.ShiftPatternOut])
def get_active_pattern(db: Session = Depends(get_db)):
    """Return the (single) currently active shift pattern, or null."""
    p = (db.query(models.ShiftPattern)
            .filter(models.ShiftPattern.is_active == True)
            .order_by(models.ShiftPattern.created_at.desc())
            .first())
    return _pattern_to_out(p) if p else None


@router.post("/schedule/active-pattern/{pid}", response_model=schemas.ShiftPatternOut)
def set_active_pattern(
    pid: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Make a pattern the single active one (deactivates all others)."""
    p = db.query(models.ShiftPattern).filter(models.ShiftPattern.id == pid).first()
    if not p:
        raise HTTPException(404, "Pattern not found")
    db.query(models.ShiftPattern).update({"is_active": False})
    p.is_active = True
    db.commit(); db.refresh(p)
    return _pattern_to_out(p)


# ── Free users ────────────────────────────────────────────────────────────────

@router.get("/schedule/free-users", response_model=list[schemas.FreeUserOut])
def list_free_users(db: Session = Depends(get_db)):
    return (db.query(models.FreeUser)
              .order_by(models.FreeUser.display_order, models.FreeUser.created_at)
              .all())


@router.post("/schedule/free-users", response_model=schemas.FreeUserOut,
             status_code=status.HTTP_201_CREATED)
def create_free_user(
    payload: schemas.FreeUserCreate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    fu = models.FreeUser(
        name=payload.name.strip(),
        display_order=payload.display_order,
        created_by=current_user.username,
    )
    db.add(fu); db.commit(); db.refresh(fu)
    return fu


@router.put("/schedule/free-users/{fid}", response_model=schemas.FreeUserOut)
def update_free_user(
    fid: int,
    payload: schemas.FreeUserUpdate,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    fu = db.query(models.FreeUser).filter(models.FreeUser.id == fid).first()
    if not fu:
        raise HTTPException(404, "Free user not found")
    if payload.name is not None:
        fu.name = payload.name.strip()
    if payload.display_order is not None:
        fu.display_order = payload.display_order
    db.commit(); db.refresh(fu)
    return fu


@router.delete("/schedule/free-users/{fid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_free_user(
    fid: int,
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    fu = db.query(models.FreeUser).filter(models.FreeUser.id == fid).first()
    if not fu:
        raise HTTPException(404, "Free user not found")
    db.delete(fu); db.commit()


@router.post("/schedule/free-users/{fid}/claim", response_model=schemas.FreeUserOut)
def claim_free_user(
    fid: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """A logged-in user claims a free user (linking their assignments)."""
    fu = db.query(models.FreeUser).filter(models.FreeUser.id == fid).first()
    if not fu:
        raise HTTPException(404, "Free user not found")
    if fu.claimed_by_id and fu.claimed_by_id != current_user.id:
        raise HTTPException(400, "Already claimed by someone else")
    fu.claimed_by_id = current_user.id
    fu.claimed_at = datetime.utcnow()
    # Migrate assignments: free_user_id → user_id
    rows = db.query(models.ShiftAssignment).filter(models.ShiftAssignment.free_user_id == fid).all()
    for a in rows:
        a.user_id = current_user.id
        a.user_name = current_user.username
    db.commit(); db.refresh(fu)
    return fu


@router.post("/schedule/free-users/{fid}/unclaim", response_model=schemas.FreeUserOut)
def unclaim_free_user(
    fid: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    fu = db.query(models.FreeUser).filter(models.FreeUser.id == fid).first()
    if not fu:
        raise HTTPException(404, "Free user not found")
    if fu.claimed_by_id != current_user.id and current_user.role != "manager":
        raise HTTPException(403, "Not allowed")
    fu.claimed_by_id = None
    fu.claimed_at = None
    db.commit(); db.refresh(fu)
    return fu


# ── Shift assignments (grid cells) ────────────────────────────────────────────

@router.get("/schedule/assignments", response_model=list[schemas.ShiftAssignmentOut])
def list_assignments(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.ShiftAssignment)
    if date_from:
        q = q.filter(models.ShiftAssignment.date >= date_from)
    if date_to:
        q = q.filter(models.ShiftAssignment.date <= date_to)
    return q.order_by(models.ShiftAssignment.date, models.ShiftAssignment.slot_label).all()


@router.post("/schedule/assignments", response_model=schemas.ShiftAssignmentOut,
             status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: schemas.ShiftAssignmentCreate,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if not payload.user_id and not payload.free_user_id:
        raise HTTPException(400, "user_id or free_user_id required")
    # Permission: if assigning a real user, must be that user or manager
    if payload.user_id and payload.user_id != current_user.id and current_user.role != "manager":
        raise HTTPException(403, "Can only sign up yourself unless you are a manager")
    # Free users: only manager can assign
    if payload.free_user_id and current_user.role != "manager":
        # Check if this free user is claimed by current user
        fu = db.query(models.FreeUser).filter(models.FreeUser.id == payload.free_user_id).first()
        if not fu or fu.claimed_by_id != current_user.id:
            raise HTTPException(403, "Only manager can assign unclaimed free users")
    # Prevent duplicate (same date+slot+user)
    existing = db.query(models.ShiftAssignment).filter(
        models.ShiftAssignment.date == payload.date,
        models.ShiftAssignment.slot_label == payload.slot_label,
        models.ShiftAssignment.user_id == payload.user_id,
        models.ShiftAssignment.free_user_id == payload.free_user_id,
    ).first()
    if existing:
        raise HTTPException(400, "Assignment already exists")

    a = models.ShiftAssignment(
        date=payload.date,
        slot_label=payload.slot_label,
        user_id=payload.user_id,
        free_user_id=payload.free_user_id,
        user_name=payload.user_name,
        role=payload.role,
        created_by=current_user.username,
    )
    db.add(a); db.commit(); db.refresh(a)
    return a


@router.delete("/schedule/assignments/{aid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    aid: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    a = db.query(models.ShiftAssignment).filter(models.ShiftAssignment.id == aid).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    # Permission: owner or manager
    is_owner = (a.user_id == current_user.id) or (a.created_by == current_user.username)
    # Free user assignments are editable by their claimed user
    if a.free_user_id:
        fu = db.query(models.FreeUser).filter(models.FreeUser.id == a.free_user_id).first()
        if fu and fu.claimed_by_id == current_user.id:
            is_owner = True
    if not is_owner and current_user.role != "manager":
        raise HTTPException(403, "Not allowed")
    db.delete(a); db.commit()


@router.delete("/schedule/assignments", status_code=status.HTTP_200_OK)
def clear_all_assignments(
    current_user: models.User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Manager-only: delete every shift assignment. Returns count removed."""
    n = db.query(models.ShiftAssignment).delete()
    db.commit()
    return {"deleted": int(n)}


# ── User logs during shift windows (for markers) ──────────────────────────────

@router.get("/schedule/author-logs", response_model=list[schemas.ShiftAuthorLog])
def list_author_logs(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return all non-deleted log entries in the date range, with author info.
    Frontend matches these to shift assignments by author_name + time overlap."""
    q = db.query(models.LogEntry).filter(models.LogEntry.is_deleted == False)
    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
            q = q.filter(models.LogEntry.created_at >= df)
        except Exception: pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            q = q.filter(models.LogEntry.created_at <= dt)
        except Exception: pass
    rows = q.order_by(models.LogEntry.created_at).all()
    return [schemas.ShiftAuthorLog(
        log_id=e.id, title=e.title, user_name=e.author_name, created_at=e.created_at,
    ) for e in rows]


@router.get("/schedule/runs", response_model=list[schemas.RunSpan])
def list_runs(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
):
    """Pair Start of Run / End of Run logs by run_number.

    A run that has only a Start log is treated as still running (end_at=None).
    """
    start_fid = _format_id_by_name(db, "Start of Run")
    end_fid   = _format_id_by_name(db, "End of Run")

    # Get all start/end logs (don't filter by run_number=None — formats might
    # use run_number as builtin which sets it)
    starts_q = db.query(models.LogEntry).filter(
        models.LogEntry.is_deleted == False,
        models.LogEntry.format_id == start_fid,
    ) if start_fid else db.query(models.LogEntry).filter(False)

    ends_q = db.query(models.LogEntry).filter(
        models.LogEntry.is_deleted == False,
        models.LogEntry.format_id == end_fid,
    ) if end_fid else db.query(models.LogEntry).filter(False)

    if start:
        starts_q = starts_q.filter(models.LogEntry.created_at >= start)
        ends_q   = ends_q.filter(models.LogEntry.created_at >= start)
    if end:
        starts_q = starts_q.filter(models.LogEntry.created_at <= end)
        ends_q   = ends_q.filter(models.LogEntry.created_at <= end)

    starts = starts_q.all()
    ends   = ends_q.all()

    # Build a map: run_number → end_log (earliest end after each start)
    ends_by_run: dict[int, list[models.LogEntry]] = {}
    for e in ends:
        if e.run_number is not None:
            ends_by_run.setdefault(e.run_number, []).append(e)
    for k in ends_by_run:
        ends_by_run[k].sort(key=lambda x: x.created_at)

    result: list[schemas.RunSpan] = []
    for s in starts:
        if s.run_number is None:
            continue
        # Find the first end log after this start
        end_log = None
        for cand in ends_by_run.get(s.run_number, []):
            if cand.created_at >= s.created_at:
                end_log = cand
                break

        # Try to extract data_type from start log's custom fields
        data_type = None
        if s.format_fields_json:
            try:
                data_type = json.loads(s.format_fields_json).get("data_type")
            except Exception:
                pass

        result.append(schemas.RunSpan(
            run_number=s.run_number,
            title=s.title,
            start_at=s.created_at,
            end_at=end_log.created_at if end_log else None,
            start_log_id=s.id,
            end_log_id=end_log.id if end_log else None,
            data_type=data_type,
        ))

    result.sort(key=lambda r: r.start_at)
    return result
