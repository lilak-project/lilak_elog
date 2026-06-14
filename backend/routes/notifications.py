"""
Notification routes — fetch & mark-read for the current user.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_auth
from database import get_db
from models import Notification
from schemas import NotificationOut

router = APIRouter(tags=["notifications"])


@router.get("/notifications/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)
        .count()
    )
    return {"count": count}


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    return (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )


@router.post("/notifications/read-all", status_code=204)
def read_all(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()


@router.post("/notifications/{notif_id}/read", status_code=204)
def read_one(
    notif_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    notif = (
        db.query(Notification)
        .filter(Notification.id == notif_id, Notification.user_id == current_user.id)
        .first()
    )
    if notif:
        notif.is_read = True
        db.commit()
