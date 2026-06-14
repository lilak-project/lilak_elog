"""
Comment routes — POST/GET comments on a log entry, with notifications.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import require_auth
from database import get_db
from models import ChatMessage, Comment, LogEntry, Notification
from schemas import CommentCreate, CommentOut

REPORTED_TAG = "reported"

router = APIRouter(tags=["comments"])


@router.get("/logs/{log_id}/comments", response_model=list[CommentOut])
def list_comments(log_id: int, db: Session = Depends(get_db)):
    log = db.query(LogEntry).filter(LogEntry.id == log_id).first()
    if not log:
        raise HTTPException(404, "Log not found")
    return (
        db.query(Comment)
        .filter(Comment.log_id == log_id)
        .order_by(Comment.created_at)
        .all()
    )


@router.post("/logs/{log_id}/comments", response_model=CommentOut)
def create_comment(
    log_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    body = payload.body.strip()
    if not body:
        raise HTTPException(400, "Comment body cannot be empty")

    log = db.query(LogEntry).filter(LogEntry.id == log_id).first()
    if not log:
        raise HTTPException(404, "Log not found")

    comment = Comment(
        log_id=log_id,
        author_id=current_user.id,
        author_name=current_user.username,
        body=body,
    )
    db.add(comment)
    db.flush()  # get comment.id before notification

    # Report flow: drop 'confirmation required', then tag #reported + #<user>.
    if payload.report:
        from utils_tasks import _get_or_create_tag, remove_confirmation_required
        remove_confirmation_required(log, db)
        for name in (REPORTED_TAG, current_user.username):
            tag = _get_or_create_tag(name, db)
            if tag not in log.tags:
                log.tags.append(tag)

    # Notify log author — skip self-notification
    if log.author_id and log.author_id != current_user.id:
        notif = Notification(
            user_id=log.author_id,
            from_user_name=current_user.username,
            log_id=log_id,
            log_title=log.title,
            comment_id=comment.id,
            comment_excerpt=body[:200],
            notif_type="comment",
        )
        db.add(notif)

    # Cross-post to community chat (reference the log by its display index "_N")
    log_ref = f"_{log.log_index}" if log.log_index else f"#{log_id}"
    prefix = "[⚠ 리포트]" if payload.report else "[댓글]"
    chat_body = f"{prefix} {current_user.username} on {log_ref} {log.title or ''}: {body}"
    chat_msg = ChatMessage(
        author_id=current_user.id,
        author_name=current_user.username,
        body=chat_body,
        log_id=log_id,
        log_title=log.title,
        comment_id=comment.id,
        is_cross_posted=True,
    )
    db.add(chat_msg)

    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/logs/{log_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    log_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    comment = db.query(Comment).filter(
        Comment.id == comment_id,
        Comment.log_id == log_id,
    ).first()
    if not comment:
        raise HTTPException(404, "Comment not found")
    # Only author or manager may delete
    if comment.author_id != current_user.id and current_user.role != "manager":
        raise HTTPException(403, "Not allowed")
    db.delete(comment)
    db.commit()
