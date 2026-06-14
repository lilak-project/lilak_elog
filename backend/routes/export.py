"""
Export routes: JSON, Markdown, HTML.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
import json

import models
from database import get_db
from audit_log import record as _audit
from auth import get_current_user_optional
from sqlalchemy.orm import Session

router = APIRouter(tags=["export"])


def _query_entries(
    db: Session,
    include_deleted: bool,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    category: Optional[str],
):
    q = db.query(models.LogEntry)
    if not include_deleted:
        q = q.filter(models.LogEntry.is_deleted == False)
    if date_from:
        q = q.filter(models.LogEntry.created_at >= date_from)
    if date_to:
        q = q.filter(models.LogEntry.created_at <= date_to)
    if category:
        q = q.filter(models.LogEntry.category == category)
    return q.order_by(models.LogEntry.created_at.desc()).all()


def _entry_dict(e: models.LogEntry) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "body": e.body,
        "author_name": e.author_name,
        "category": e.category,
        "run_number": e.run_number,
        "level": e.level,
        "source": e.source,
        "is_auto": e.is_auto,
        "tags": [t.name for t in e.tags],
        "metadata": json.loads(e.metadata_json) if e.metadata_json else None,
        "attachments": [
            {"id": a.id, "original_filename": a.original_filename, "content_type": a.content_type, "size": a.size}
            for a in e.attachments
        ],
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
        "updated_by": e.updated_by,
        "is_deleted": e.is_deleted,
    }


@router.get("/export/json")
def export_json(
    include_deleted: bool = Query(False),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    category: Optional[str] = Query(None),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if include_deleted and not (current_user and current_user.role == "manager"):
        include_deleted = False

    entries = _query_entries(db, include_deleted, date_from, date_to, category)
    data = [_entry_dict(e) for e in entries]
    json_bytes = json.dumps(data, indent=2, ensure_ascii=False).encode()

    if current_user:
        _audit(db, "export", "logs", None, current_user.username, f"json ({len(data)})")

    return StreamingResponse(
        iter([json_bytes]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=elog_export.json"},
    )


@router.get("/export/markdown", response_class=PlainTextResponse)
def export_markdown(
    include_deleted: bool = Query(False),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    category: Optional[str] = Query(None),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if include_deleted and not (current_user and current_user.role == "manager"):
        include_deleted = False

    entries = _query_entries(db, include_deleted, date_from, date_to, category)
    lines = [f"# Lab ELog Export\n\nExported: {datetime.utcnow().isoformat()}Z\n\n---\n"]

    for e in entries:
        lines.append(f"## [{e.id}] {e.title}\n")
        lines.append(f"- **Author:** {e.author_name}")
        lines.append(f"- **Date:** {e.created_at.isoformat() if e.created_at else '?'}")
        if e.category:
            lines.append(f"- **Category:** {e.category}")
        if e.run_number is not None:
            lines.append(f"- **Run:** {e.run_number}")
        if e.tags:
            lines.append(f"- **Tags:** {', '.join(t.name for t in e.tags)}")
        lines.append(f"- **Level:** {e.level}")
        if e.source != "human":
            lines.append(f"- **Source:** {e.source}")
        lines.append("")
        if e.body:
            lines.append(e.body)
        lines.append("\n---\n")

    return "\n".join(lines)


@router.get("/export/html", response_class=HTMLResponse)
def export_html(
    include_deleted: bool = Query(False),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    category: Optional[str] = Query(None),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if include_deleted and not (current_user and current_user.role == "manager"):
        include_deleted = False

    entries = _query_entries(db, include_deleted, date_from, date_to, category)

    rows = []
    for e in entries:
        tags_html = " ".join(f'<span class="tag">{t.name}</span>' for t in e.tags)
        body_escaped = (e.body or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        rows.append(f"""
        <div class="entry {'auto-entry' if e.is_auto else ''}">
          <h2>[{e.id}] {e.title}</h2>
          <div class="meta">
            <span>👤 {e.author_name}</span>
            <span>🕐 {e.created_at.isoformat() if e.created_at else '?'}</span>
            {"<span>🗂 " + e.category + "</span>" if e.category else ""}
            {"<span>🏃 Run " + str(e.run_number) + "</span>" if e.run_number is not None else ""}
            <span>⚡ {e.level}</span>
            {tags_html}
          </div>
          <pre class="body">{body_escaped}</pre>
        </div>
        """)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Lab ELog Export</title>
<style>
  body {{ font-family: sans-serif; max-width: 900px; margin: 40px auto; color: #222; }}
  .entry {{ border: 1px solid #ddd; border-radius: 6px; padding: 16px; margin-bottom: 20px; }}
  .auto-entry {{ border-left: 4px solid #6366f1; background: #f5f5ff; }}
  .meta {{ font-size: 0.85em; color: #666; margin-bottom: 10px; }}
  .meta span {{ margin-right: 12px; }}
  .tag {{ background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; }}
  .body {{ white-space: pre-wrap; font-size: 0.9em; background: #f8f8f8; padding: 12px; border-radius: 4px; }}
  h2 {{ margin-top: 0; font-size: 1.1em; }}
</style>
</head><body>
<h1>Lab ELog Export</h1>
<p>Exported: {datetime.utcnow().isoformat()}Z — {len(entries)} entries</p>
{"".join(rows)}
</body></html>"""

    return HTMLResponse(content=html, headers={"Content-Disposition": "attachment; filename=elog_export.html"})
