"""
Notice board — managers write, everyone reads.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import require_auth, require_manager
from database import get_db
from models import Notice
from schemas import NoticeCreate, NoticeOut, NoticeUpdate

router = APIRouter(tags=["notices"])


@router.get("/notices", response_model=list[NoticeOut])
def list_notices(db: Session = Depends(get_db)):
    return (
        db.query(Notice)
        .order_by(Notice.is_pinned.desc(), Notice.created_at.desc())
        .all()
    )


@router.post("/notices", response_model=NoticeOut)
def create_notice(
    payload: NoticeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    notice = Notice(
        title=payload.title.strip(),
        body=payload.body,
        author_id=current_user.id,
        author_name=current_user.username,
        is_pinned=payload.is_pinned,
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return notice


@router.put("/notices/{notice_id}", response_model=NoticeOut)
def update_notice(
    notice_id: int,
    payload: NoticeUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    notice = db.query(Notice).filter(Notice.id == notice_id).first()
    if not notice:
        raise HTTPException(404, "Notice not found")
    if payload.title is not None:
        notice.title = payload.title.strip()
    if payload.body is not None:
        notice.body = payload.body
    if payload.is_pinned is not None:
        notice.is_pinned = payload.is_pinned
    db.commit()
    db.refresh(notice)
    return notice


@router.delete("/notices/{notice_id}", status_code=204)
def delete_notice(
    notice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    notice = db.query(Notice).filter(Notice.id == notice_id).first()
    if not notice:
        raise HTTPException(404, "Notice not found")
    db.delete(notice)
    db.commit()
