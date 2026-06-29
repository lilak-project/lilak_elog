"""
Portal service registry, per-account permissions, and access requests.

The portal lists *services* (elog projects today; other apps later). Each service
has a kind ("elog", …) and a visibility tier:

  1  private   — visible only to accounts granted permission; hidden otherwise.
  2  protected — visible to everyone (logged in); only permitted accounts may
                 enter, others can request access.            ← default for new
  3  admin     — visible to admins only; hidden from everyone else.

Admins (portal role "manager") see and enter everything. Permissions and access
requests live in the portal DB (same engine as the accounts), keyed by name so
they survive a service being stopped/restarted.

This module owns:
  • the data model (Service / ServicePermission / AccessRequest),
  • `annotate_services()` — turn the launcher's raw project list into a
    per-user, filtered + flagged list,
  • `GET /api/services` (the portal-facing list),
  • `POST /api/access-requests` (a user asks for access),
  • `/api/admin/*` endpoints (set visibility, grant/revoke, list users/requests)
    that the admin UI (a later phase) will drive.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint
from sqlalchemy.orm import declarative_base, Session

import models
from portal_auth import _engine, get_portal_db, require_portal_user

PortalBase = declarative_base()

VIS_PRIVATE, VIS_PROTECTED, VIS_ADMIN = 1, 2, 3
DEFAULT_VISIBILITY = VIS_PROTECTED


class Service(PortalBase):
    __tablename__ = "portal_services"
    name       = Column(String(128), primary_key=True)
    kind       = Column(String(32), nullable=False, default="elog")
    visibility = Column(Integer, nullable=False, default=DEFAULT_VISIBILITY)


class ServicePermission(PortalBase):
    __tablename__ = "portal_permissions"
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, nullable=False, index=True)
    service_name = Column(String(128), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("user_id", "service_name", name="uq_user_service"),)


class AccessRequest(PortalBase):
    __tablename__ = "portal_access_requests"
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, nullable=False, index=True)
    service_name = Column(String(128), nullable=False, index=True)
    status       = Column(String(16), nullable=False, default="pending")  # pending|approved|rejected
    created_at   = Column(DateTime, default=datetime.utcnow)


PortalBase.metadata.create_all(bind=_engine)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_admin(user: models.User) -> bool:
    return user.role == "manager"


def get_or_create_service(db: Session, name: str, kind: str = "elog") -> Service:
    svc = db.query(Service).filter(Service.name == name).first()
    if svc is None:
        svc = Service(name=name, kind=kind, visibility=DEFAULT_VISIBILITY)
        db.add(svc)
        db.flush()
    return svc


def has_permission(db: Session, user_id: int, name: str) -> bool:
    return db.query(ServicePermission).filter(
        ServicePermission.user_id == user_id,
        ServicePermission.service_name == name,
    ).first() is not None


def _pending(db: Session, user_id: int, name: str) -> bool:
    return db.query(AccessRequest).filter(
        AccessRequest.user_id == user_id,
        AccessRequest.service_name == name,
        AccessRequest.status == "pending",
    ).first() is not None


def annotate_services(db: Session, user: models.User, raw: list[dict]) -> list[dict]:
    """Filter + flag the launcher's raw project list for `user`."""
    admin = _is_admin(user)
    out: list[dict] = []
    for p in raw:
        svc = get_or_create_service(db, p["name"])
        vis = svc.visibility
        if admin:
            can_enter, can_request = True, False
        elif vis == VIS_ADMIN:
            continue                                  # hidden from non-admins
        elif vis == VIS_PRIVATE:
            if not has_permission(db, user.id, p["name"]):
                continue                              # hidden unless permitted
            can_enter, can_request = True, False
        else:                                         # VIS_PROTECTED
            perm = has_permission(db, user.id, p["name"])
            can_enter, can_request = perm, (not perm)
        out.append({
            **p,
            "kind": svc.kind,
            "visibility": vis,
            "can_enter": can_enter,
            "can_request": can_request,
            "requested": _pending(db, user.id, p["name"]) if can_request else False,
        })
    db.commit()
    return out


def require_portal_admin(user: models.User = Depends(require_portal_user)) -> models.User:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return user


# ── Routes ────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["portal-services"])


@router.get("/api/services")
def list_services(
    user: models.User = Depends(require_portal_user),
    db: Session = Depends(get_portal_db),
):
    # Lazy import avoids a circular import at module load (launcher imports us).
    from launcher import _list_projects
    return annotate_services(db, user, _list_projects())


class AccessRequestBody(BaseModel):
    service: str


@router.post("/api/access-requests", status_code=201)
def create_access_request(
    body: AccessRequestBody,
    user: models.User = Depends(require_portal_user),
    db: Session = Depends(get_portal_db),
):
    name = body.service
    svc = get_or_create_service(db, name)
    if svc.visibility == VIS_ADMIN and not _is_admin(user):
        raise HTTPException(status_code=404, detail="서비스를 찾을 수 없습니다.")
    if has_permission(db, user.id, name):
        return {"requested": False, "reason": "already_permitted"}
    if not _pending(db, user.id, name):
        db.add(AccessRequest(user_id=user.id, service_name=name))
        db.commit()
    return {"requested": True}


# ── Admin endpoints (the permission-management UI, a later phase, drives these) ──

class ServiceMetaBody(BaseModel):
    visibility: Optional[int] = None
    kind: Optional[str] = None


@router.get("/api/admin/services")
def admin_list_services(
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    from launcher import _list_projects
    rows = {s.name: s for s in db.query(Service).all()}
    out = []
    for p in _list_projects():
        s = rows.get(p["name"]) or get_or_create_service(db, p["name"])
        out.append({"name": p["name"], "running": p["running"], "kind": s.kind, "visibility": s.visibility})
    db.commit()
    return out


@router.put("/api/admin/services/{name}")
def admin_set_service(
    name: str, body: ServiceMetaBody,
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    svc = get_or_create_service(db, name)
    if body.visibility is not None:
        if body.visibility not in (VIS_PRIVATE, VIS_PROTECTED, VIS_ADMIN):
            raise HTTPException(status_code=400, detail="visibility must be 1, 2 or 3")
        svc.visibility = body.visibility
    if body.kind is not None:
        svc.kind = body.kind
    db.commit()
    return {"name": svc.name, "kind": svc.kind, "visibility": svc.visibility}


@router.get("/api/admin/users")
def admin_list_users(
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    return [
        {"id": u.id, "username": u.username, "email": u.email, "role": u.role,
         "display_name": u.display_name}
        for u in db.query(models.User).order_by(models.User.id.asc()).all()
    ]


class PermissionBody(BaseModel):
    user_id: int
    service: str


@router.post("/api/admin/permissions", status_code=201)
def admin_grant(
    body: PermissionBody,
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    if not has_permission(db, body.user_id, body.service):
        db.add(ServicePermission(user_id=body.user_id, service_name=body.service))
    # Granting fulfils any pending request.
    for r in db.query(AccessRequest).filter(
        AccessRequest.user_id == body.user_id,
        AccessRequest.service_name == body.service,
        AccessRequest.status == "pending",
    ).all():
        r.status = "approved"
    db.commit()
    return {"granted": True}


@router.delete("/api/admin/permissions")
def admin_revoke(
    body: PermissionBody,
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    db.query(ServicePermission).filter(
        ServicePermission.user_id == body.user_id,
        ServicePermission.service_name == body.service,
    ).delete()
    db.commit()
    return {"granted": False}


@router.get("/api/admin/permissions")
def admin_list_permissions(
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    return [{"user_id": p.user_id, "service": p.service_name}
            for p in db.query(ServicePermission).all()]


@router.get("/api/admin/access-requests")
def admin_list_requests(
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    rows = db.query(AccessRequest).filter(AccessRequest.status == "pending").all()
    users = {u.id: u for u in db.query(models.User).all()}
    return [
        {"id": r.id, "user_id": r.user_id,
         "username": users[r.user_id].username if r.user_id in users else None,
         "service": r.service_name, "created_at": r.created_at.isoformat() if r.created_at else None}
        for r in rows
    ]


class ResolveBody(BaseModel):
    action: str   # "approve" | "reject"


@router.post("/api/admin/access-requests/{rid}")
def admin_resolve_request(
    rid: int, body: ResolveBody,
    _: models.User = Depends(require_portal_admin),
    db: Session = Depends(get_portal_db),
):
    r = db.query(AccessRequest).filter(AccessRequest.id == rid).first()
    if not r:
        raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다.")
    if body.action == "approve":
        if not has_permission(db, r.user_id, r.service_name):
            db.add(ServicePermission(user_id=r.user_id, service_name=r.service_name))
        r.status = "approved"
    elif body.action == "reject":
        r.status = "rejected"
    else:
        raise HTTPException(status_code=400, detail="action must be approve or reject")
    db.commit()
    return {"id": rid, "status": r.status}
