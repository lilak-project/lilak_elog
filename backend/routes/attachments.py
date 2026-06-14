"""
File upload / download / delete routes.
Files are stored under UPLOAD_DIR/{log_id}/{safe_filename}.
"""

import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from typing import Optional

import models
import schemas
from auth import get_current_user_optional, require_auth
from database import UPLOAD_DIR, get_db

router = APIRouter(tags=["attachments"])

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


def _safe_filename(name: str) -> str:
    """Strip path components and replace unsafe characters."""
    name = os.path.basename(name)
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name)
    return safe or "file"


def _attachment_dir(log_id: int) -> Path:
    d = Path(UPLOAD_DIR) / str(log_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── List all attachments (file browser / gallery) ────────────────────────────

@router.get("/attachments", response_model=schemas.AttachmentListResponse)
def list_attachments(
    images_only: bool = Query(False),
    q: Optional[str] = Query(None),           # search by original filename
    run_number: Optional[int] = Query(None),
    tag: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """파일 브라우저 / 갤러리용: 전체 첨부파일 목록 (로그 정보 포함)."""
    # Base filter query (no eager load — used for count)
    base_q = (
        db.query(models.Attachment)
        .join(models.LogEntry, models.Attachment.log_id == models.LogEntry.id)
        .filter(models.LogEntry.is_deleted == False)
    )

    if images_only:
        base_q = base_q.filter(models.Attachment.content_type.like("image/%"))
    if q:
        base_q = base_q.filter(models.Attachment.original_filename.ilike(f"%{q}%"))
    if run_number is not None:
        base_q = base_q.filter(models.LogEntry.run_number == run_number)
    if tag:
        base_q = (
            base_q.join(models.LogEntry.tags)
            .filter(models.Tag.name == tag.lower().strip())
        )

    total = base_q.count()

    # Fetch page with eager loading to avoid N+1
    attachments = (
        base_q
        .options(
            joinedload(models.Attachment.log_entry)
            .joinedload(models.LogEntry.tags)
        )
        .order_by(models.Attachment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = [
        schemas.AttachmentWithLog(
            id=a.id,
            log_id=a.log_id,
            filename=a.filename,
            original_filename=a.original_filename,
            content_type=a.content_type,
            size=a.size,
            created_at=a.created_at,
            log_title=a.log_entry.title or '',
            log_author=a.log_entry.author_name,
            log_run_number=a.log_entry.run_number,
            log_run_number_type=a.log_entry.run_number_type or "single",
            log_run_number_text=a.log_entry.run_number_text,
            log_created_at=a.log_entry.created_at,
            log_tags=[schemas.TagOut(id=t.id, name=t.name) for t in a.log_entry.tags],
            log_level=a.log_entry.level or "info",
        )
        for a in attachments
    ]

    return schemas.AttachmentListResponse(items=items, total=total, page=page, page_size=page_size)


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/logs/{log_id}/attachments", response_model=list[schemas.AttachmentOut], status_code=status.HTTP_201_CREATED)
async def upload_attachments(
    log_id: int,
    files: list[UploadFile] = File(...),
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    entry = db.query(models.LogEntry).filter(
        models.LogEntry.id == log_id,
        models.LogEntry.is_deleted == False,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")

    # Permission: owner or manager
    if current_user.role != "manager" and entry.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot attach to another user's entry")

    saved = []
    dest_dir = _attachment_dir(log_id)

    for upload in files:
        content = await upload.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail=f"File {upload.filename} exceeds 100 MB limit")

        safe = _safe_filename(upload.filename or "upload")
        stem, ext = os.path.splitext(safe)
        stored_name = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
        dest = dest_dir / stored_name
        dest.write_bytes(content)

        ct = upload.content_type or mimetypes.guess_type(upload.filename or "")[0] or "application/octet-stream"

        att = models.Attachment(
            log_id=log_id,
            filename=stored_name,
            original_filename=upload.filename or stored_name,
            content_type=ct,
            size=len(content),
        )
        db.add(att)
        db.flush()
        saved.append(att)

    db.commit()
    for a in saved:
        db.refresh(a)

    return [
        schemas.AttachmentOut(
            id=a.id,
            log_id=a.log_id,
            filename=a.filename,
            original_filename=a.original_filename,
            content_type=a.content_type,
            size=a.size,
            created_at=a.created_at,
        )
        for a in saved
    ]


# ── Download ──────────────────────────────────────────────────────────────────

@router.get("/attachments/{attachment_id}")
def download_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
):
    att = db.query(models.Attachment).filter(models.Attachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    path = Path(UPLOAD_DIR) / str(att.log_id) / att.filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(path),
        media_type=att.content_type or "application/octet-stream",
        filename=att.original_filename,
    )


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: int,
    current_user: models.User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    att = db.query(models.Attachment).filter(models.Attachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    entry = att.log_entry
    if current_user.role != "manager" and entry.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Permission denied")

    # Remove file from disk
    path = Path(UPLOAD_DIR) / str(att.log_id) / att.filename
    if path.exists():
        path.unlink()

    db.delete(att)
    db.commit()
