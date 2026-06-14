"""
Infography — graph/chart building from log "metric" variables, plus a
run-number-centric spreadsheet view.

Variables available for plotting:
  • run_number  — always
  • time        — always (log created_at)
  • any custom format field flagged  "metric": true  (number / number_entry)
  • module fields flagged metric (e.g. net_speed.response_ms)

Data points are aggregated BY RUN NUMBER: all logs sharing a run_number
contribute their metric values, which are averaged into a single point.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
import schemas
from auth import require_auth, require_manager
from database import get_db
from module_runner import REGISTRY

router = APIRouter(tags=["infography"])

BUILTIN_VARIABLES = [
    {"key": "run_number", "label": "Run number", "source": "builtin", "unit": ""},
    {"key": "time",       "label": "Time",       "source": "builtin", "unit": ""},
]


def _collect_variables(db: Session) -> list[dict]:
    """All plottable variables: builtins + metric-flagged format/module fields."""
    out = {v["key"]: dict(v) for v in BUILTIN_VARIABLES}

    # Format metric fields
    for fmt in db.query(models.LogFormat).all():
        try:
            fields = json.loads(fmt.fields_json or "[]")
        except Exception:
            continue
        for f in fields:
            if not isinstance(f, dict):
                continue
            if not f.get("metric"):
                continue
            ftype = f.get("field_type") or f.get("custom_type")
            if ftype not in ("number", "number_entry"):
                continue
            key = f.get("key")
            if key and key not in out:
                out[key] = {"key": key, "label": f.get("label") or key,
                            "source": "format", "unit": f.get("unit", "")}

    # Module metric fields
    for cls in REGISTRY:
        for f in getattr(cls, "fields", []) or []:
            if not f.get("metric"):
                continue
            key = f.get("key")
            if key and key not in out:
                out[key] = {"key": key, "label": f.get("label") or key,
                            "source": "module", "unit": f.get("unit", "")}

    result = list(out.values())
    # Assign short references v1, v2, … for use in y expressions.
    for i, v in enumerate(result):
        v["ref"] = f"v{i + 1}"
    return result


def _ref_to_key_map(db: Session) -> dict:
    return {v["ref"]: v["key"] for v in _collect_variables(db)}


@router.get("/infography/variables")
def list_variables(db: Session = Depends(get_db)):
    return _collect_variables(db)


def _extract(log: models.LogEntry, key: str):
    if key == "run_number":
        return float(log.run_number) if log.run_number is not None else None
    if key == "time":
        return log.created_at.timestamp() if log.created_at else None
    try:
        ffj = json.loads(log.format_fields_json or "{}")
    except Exception:
        return None
    v = ffj.get(key)
    if v is None:
        return None
    if isinstance(v, dict):
        v = v.get("value")
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


import ast as _ast
_BINOPS = {
    _ast.Add: lambda a, b: a + b, _ast.Sub: lambda a, b: a - b,
    _ast.Mult: lambda a, b: a * b, _ast.Div: lambda a, b: (a / b if b else None),
}
_UNOPS = {_ast.USub: lambda a: -a, _ast.UAdd: lambda a: a}


def _eval_ast(node, resolve):
    if isinstance(node, _ast.Expression):
        return _eval_ast(node.body, resolve)
    if isinstance(node, _ast.Constant):
        return float(node.value) if isinstance(node.value, (int, float)) else None
    if isinstance(node, _ast.Name):
        return resolve(node.id)
    if isinstance(node, _ast.BinOp) and type(node.op) in _BINOPS:
        a = _eval_ast(node.left, resolve); b = _eval_ast(node.right, resolve)
        if a is None or b is None:
            return None
        try:
            return _BINOPS[type(node.op)](a, b)
        except Exception:
            return None
    if isinstance(node, _ast.UnaryOp) and type(node.op) in _UNOPS:
        a = _eval_ast(node.operand, resolve)
        return None if a is None else _UNOPS[type(node.op)](a)
    raise ValueError("unsupported expression")


import re as _re


def _eval_y(expr: str, log, known_keys, ref_to_key=None) -> Optional[float]:
    """A plain variable → its value; otherwise a +-*/ expression of variables
    and constants, evaluated per log. Variable refs are written in braces:
    {v1}, {v2}, … (so they never clash with real variable names).
    Returns None if any referenced value is missing."""
    if expr in known_keys:
        return _extract(log, expr)
    ref_to_key = ref_to_key or {}
    # {v3} → its variable key (an identifier); unknown refs stay → resolve to None.
    substituted = _re.sub(r"\{(\w+)\}", lambda m: ref_to_key.get(m.group(1), "__missing__"), expr)
    def resolve(name):
        return None if name == "__missing__" else _extract(log, name)
    try:
        return _eval_ast(_ast.parse(substituted, mode="eval"), resolve)
    except Exception:
        return None


def make_run_filter(spec: Optional[str]):
    """Build a predicate from a run spec like "1:80, 94:105, !77".
      • comma separates terms
      • a:b is an inclusive range
      • !x or !a:b excludes
    Returns a function run_number -> bool. No spec → always True.
    """
    if not spec or not spec.strip():
        return lambda r: True
    inc, exc = [], []
    for tok in spec.split(","):
        tok = tok.strip()
        if not tok:
            continue
        neg = tok.startswith("!")
        if neg:
            tok = tok[1:].strip()
        try:
            if ":" in tok:
                a, b = tok.split(":", 1)
                lo, hi = int(a), int(b)
                rng = (min(lo, hi), max(lo, hi))
            else:
                v = int(tok)
                rng = (v, v)
        except ValueError:
            continue
        (exc if neg else inc).append(rng)

    def match(r):
        if r is None:
            return False
        if inc and not any(lo <= r <= hi for lo, hi in inc):
            return False
        if any(lo <= r <= hi for lo, hi in exc):
            return False
        return True
    return match


def _aggregate_by_run(db: Session, keys: list[str], run_filter=None) -> dict[int, dict]:
    """For every run_number, average each requested variable across its logs."""
    logs = (
        db.query(models.LogEntry)
          .filter(models.LogEntry.is_deleted == False,         # noqa: E712
                  models.LogEntry.run_number.isnot(None))
          .all()
    )
    buckets: dict[int, dict[str, list]] = {}
    for log in logs:
        run = log.run_number
        if run_filter and not run_filter(run):
            continue
        b = buckets.setdefault(run, {})
        for k in keys:
            val = _extract(log, k)
            if val is not None:
                b.setdefault(k, []).append(val)
    result: dict[int, dict] = {}
    for run, b in buckets.items():
        row = {"run_number": run}
        for k in keys:
            vals = b.get(k)
            row[k] = (sum(vals) / len(vals)) if vals else None
        result[run] = row
    return result


def _sum_over_logs(db: Session, keys: list[str], run_filter=None) -> dict[str, float]:
    """Sum each variable's values over every (non-deleted) log = event."""
    logs = db.query(models.LogEntry).filter(models.LogEntry.is_deleted == False).all()  # noqa: E712
    totals = {k: 0.0 for k in keys}
    for log in logs:
        if run_filter and not run_filter(log.run_number):
            continue
        for k in keys:
            v = _extract(log, k)
            if v is not None:
                totals[k] += v
    return totals


@router.get("/infography/data")
def graph_data(x: str, y: Optional[str] = None, runs: Optional[str] = None, db: Session = Depends(get_db)):
    """Flexible data endpoint. `x` and `y` are comma-separated variable keys.

    Modes:
      • multi-x, no y  → 'hist_sum'  : one bar per x variable = Σ over logs
      • single-x, no y → 'hist'      : per-run x values (client bins them)
      • single-x + y   → 'xy'        : line graph; y may be multiple series
    """
    xs = [k for k in (x or "").split(",") if k]
    ys = [k for k in (y or "").split(",") if k] if y else []
    rf = make_run_filter(runs)
    _vars = _collect_variables(db)
    known_keys = {v["key"] for v in _vars}
    ref_to_key = {v["ref"]: v["key"] for v in _vars}

    # multi-x histogram → summed bars (each x var is a bin)
    if len(xs) > 1 and not ys:
        totals = _sum_over_logs(db, xs, rf)
        # labels from variable metadata (reuse the list collected above)
        var_label = {v["key"]: v["label"] for v in _vars}
        bins = [{"label": var_label.get(k, k), "value": totals.get(k, 0.0)} for k in xs]
        return {"mode": "hist_sum", "bins": bins}

    xkey = xs[0] if xs else None
    x2key = xs[1] if len(xs) > 1 else None   # secondary x-axis (e.g. run_number)
    if not xkey:
        return {"mode": "empty", "points": []}

    # Per-log data — no run aggregation. With a run spec, only matching runs;
    # without one, every log (including run-less module/service logs).
    logs = (
        db.query(models.LogEntry)
          .filter(models.LogEntry.is_deleted == False)            # noqa: E712
          .order_by(models.LogEntry.created_at.asc())
          .all()
    )
    logs = [lg for lg in logs if rf(lg.run_number)]

    # single-x histogram → each log's x value
    if not ys:
        values = [v for v in (_extract(lg, xkey) for lg in logs) if v is not None]
        return {"mode": "hist", "x": xkey, "values": values}

    # xy graph — one point per log that has x and at least one y value.
    # A second x var (x2) becomes a secondary axis aligned to the primary x.
    points = []
    for lg in logs:
        xv = _extract(lg, xkey)
        if xv is None:
            continue
        pt = {"run": lg.run_number, "x": xv}
        if x2key:
            pt["x2"] = _extract(lg, x2key)
        ys_present = False
        for yk in ys:
            yv = _eval_y(yk, lg, known_keys, ref_to_key)
            if yv is not None:
                pt[yk] = yv
                ys_present = True
        if ys_present:
            points.append(pt)
    points.sort(key=lambda p: p["x"])
    return {"mode": "xy", "x": xkey, "x2": x2key, "y_vars": ys, "points": points}


def _fmt_cell(key, val):
    """Readable cell value — epoch 'time' → "YYYY-MM-DD HH:MM"."""
    if val is None:
        return ""
    if key == "time":
        from datetime import datetime
        try:
            return datetime.fromtimestamp(val).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return val
    return val


def _build_sheet(db: Session):
    """Return (variables, keys, header, rows) for the run-centric table."""
    variables = _collect_variables(db)
    keys = [v["key"] for v in variables]
    agg = _aggregate_by_run(db, [k for k in keys if k != "run_number"])
    header = [v["label"] for v in variables]
    rows = []
    for run in sorted(agg.keys()):
        r = agg[run]
        rows.append([_fmt_cell(k, r.get(k)) for k in keys])
    return variables, keys, header, rows


@router.get("/infography/sheet")
def sheet(db: Session = Depends(get_db)):
    """Run-number-centric table: one row per run, one column per variable."""
    variables = _collect_variables(db)
    keys = [v["key"] for v in variables if v["key"] != "run_number"]
    agg = _aggregate_by_run(db, keys)
    rows = []
    for run in sorted(agg.keys()):
        r = dict(agg[run])
        r["time"] = _fmt_cell("time", r.get("time"))
        rows.append(r)
    return {"columns": variables, "rows": rows}


@router.get("/infography/sheet.csv")
def sheet_csv(db: Session = Depends(get_db)):
    _, _, header, rows = _build_sheet(db)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for row in rows:
        w.writerow(row)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=infography_sheet.csv"})


# ── Infograph CRUD ────────────────────────────────────────────────────────────

class InfographPayload(BaseModel):
    title: str
    kind: str = "graph"            # 'graph' | 'histogram'
    x_vars: list[str] = []
    y_vars: list[str] = []
    n_bins: Optional[int] = None
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    image_filename: Optional[str] = None
    tags: list[str] = []
    run: Optional[int] = None
    run_spec: Optional[str] = None
    source: Optional[str] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None


def _info_out(ig: models.Infograph) -> dict:
    return {
        "id": ig.id, "infograph_index": ig.infograph_index, "title": ig.title, "kind": ig.kind,
        "x_vars": json.loads(ig.x_vars) if ig.x_vars else ([ig.x_var] if ig.x_var else []),
        "y_vars": json.loads(ig.y_vars) if ig.y_vars else ([ig.y_var] if ig.y_var else []),
        "n_bins": ig.n_bins, "x_min": ig.x_min, "x_max": ig.x_max,
        "image_filename": ig.image_filename,
        "tags": json.loads(ig.tags) if ig.tags else [],
        "run": ig.run, "run_spec": ig.run_spec, "source": ig.source,
        "y_min": ig.y_min, "y_max": ig.y_max,
        "author_name": ig.author_name, "created_by": ig.created_by,
        "created_at": ig.created_at, "updated_at": ig.updated_at,
    }


def _apply_payload(ig: models.Infograph, payload: InfographPayload):
    ig.title = payload.title
    ig.kind = payload.kind
    ig.x_vars = json.dumps(payload.x_vars)
    ig.y_vars = json.dumps(payload.y_vars)
    ig.n_bins = payload.n_bins
    ig.x_min = payload.x_min
    ig.x_max = payload.x_max
    ig.image_filename = payload.image_filename
    ig.tags = json.dumps([t.strip() for t in (payload.tags or []) if t.strip()]) or None
    ig.run = payload.run
    ig.run_spec = (payload.run_spec or "").strip() or None
    ig.source = (payload.source or "").strip() or None
    ig.y_min = payload.y_min
    ig.y_max = payload.y_max
    # keep legacy single columns roughly in sync
    ig.x_var = payload.x_vars[0] if payload.x_vars else None
    ig.y_var = payload.y_vars[0] if payload.y_vars else None


@router.get("/infographs")
def list_infographs(db: Session = Depends(get_db)):
    rows = db.query(models.Infograph).order_by(models.Infograph.id.desc()).all()
    return [_info_out(r) for r in rows]


@router.post("/infographs")
def create_infograph(payload: InfographPayload,
                     current_user: models.User = Depends(require_auth),
                     db: Session = Depends(get_db)):
    from sqlalchemy import func
    next_idx = (db.query(func.coalesce(func.max(models.Infograph.infograph_index), 0)).scalar() or 0) + 1
    ig = models.Infograph(
        infograph_index=next_idx,
        created_by=current_user.username,
        author_name=current_user.display_name or current_user.username,
    )
    _apply_payload(ig, payload)
    db.add(ig); db.commit(); db.refresh(ig)
    return _info_out(ig)


@router.put("/infographs/{ig_id}")
def update_infograph(ig_id: int, payload: InfographPayload,
                     current_user: models.User = Depends(require_auth),
                     db: Session = Depends(get_db)):
    ig = db.query(models.Infograph).filter(models.Infograph.id == ig_id).first()
    if not ig:
        raise HTTPException(status_code=404, detail="Infograph not found")
    _apply_payload(ig, payload)
    db.commit(); db.refresh(ig)
    return _info_out(ig)


@router.delete("/infographs/{ig_id}", status_code=204)
def delete_infograph(ig_id: int,
                     current_user: models.User = Depends(require_auth),
                     db: Session = Depends(get_db)):
    ig = db.query(models.Infograph).filter(models.Infograph.id == ig_id).first()
    if not ig:
        raise HTTPException(status_code=404, detail="Infograph not found")
    db.delete(ig); db.commit()


# ── Infograph comments ────────────────────────────────────────────────────────

class CommentPayload(BaseModel):
    body: str


@router.get("/infographs/{ig_id}/comments")
def list_comments(ig_id: int, db: Session = Depends(get_db)):
    rows = (db.query(models.InfographComment)
              .filter(models.InfographComment.infograph_id == ig_id)
              .order_by(models.InfographComment.created_at.asc()).all())
    return [{"id": c.id, "author_name": c.author_name, "body": c.body,
             "created_at": c.created_at} for c in rows]


@router.post("/infographs/{ig_id}/comments")
def add_comment(ig_id: int, payload: CommentPayload,
                current_user: models.User = Depends(require_auth),
                db: Session = Depends(get_db)):
    ig = db.query(models.Infograph).filter(models.Infograph.id == ig_id).first()
    if not ig:
        raise HTTPException(status_code=404, detail="Infograph not found")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")
    c = models.InfographComment(
        infograph_id=ig_id, author_id=current_user.id,
        author_name=current_user.display_name or current_user.username,
        body=body,
    )
    db.add(c)

    # Cross-post to community chat (same behavior as log-entry comments).
    try:
        label = f"&{ig.infograph_index}" if ig.infograph_index else f"infograph {ig.id}"
        db.add(models.ChatMessage(
            author_id=current_user.id,
            author_name=current_user.display_name or current_user.username,
            body=f"[인포그래프 댓글] {current_user.username} on {label} {ig.title or ''}: {body}",
            is_cross_posted=True,
        ))
    except Exception:
        pass

    db.commit(); db.refresh(c)
    return {"id": c.id, "author_name": c.author_name, "body": c.body, "created_at": c.created_at}


@router.delete("/infographs/{ig_id}/comments/{comment_id}", status_code=204)
def delete_comment(ig_id: int, comment_id: int,
                   current_user: models.User = Depends(require_auth),
                   db: Session = Depends(get_db)):
    c = (db.query(models.InfographComment)
           .filter(models.InfographComment.id == comment_id,
                   models.InfographComment.infograph_id == ig_id).first())
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.author_id != current_user.id and current_user.role != "manager":
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(c); db.commit()


# ── Google Sheets sync ────────────────────────────────────────────────────────

class GSheetConfigPayload(BaseModel):
    credentials_json: Optional[str] = None   # service account key (omit to keep existing)
    spreadsheet: str                          # URL or ID
    worksheet: Optional[str] = "elog"
    auto_sync: bool = False


def _gsheet_row(db: Session) -> "models.GSheetConfig | None":
    return db.query(models.GSheetConfig).first()


def _gsheet_status(cfg) -> dict:
    if not cfg:
        return {"connected": False}
    return {
        "connected": bool(cfg.enabled),
        "spreadsheet_id": cfg.spreadsheet_id,
        "worksheet": cfg.worksheet,
        "auto_sync": cfg.auto_sync,
        "connected_email": cfg.connected_email,
        "last_synced_at": cfg.last_synced_at,
    }


@router.get("/infography/gsheet/config")
def gsheet_get(db: Session = Depends(get_db)):
    return _gsheet_status(_gsheet_row(db))


@router.put("/infography/gsheet/config")
def gsheet_set(payload: GSheetConfigPayload,
               current_user: models.User = Depends(require_manager),
               db: Session = Depends(get_db)):
    from utils_gsheet import extract_spreadsheet_id, validate_and_describe, GSheetError

    cfg = _gsheet_row(db) or models.GSheetConfig()
    creds = payload.credentials_json or cfg.credentials_json
    if not creds:
        raise HTTPException(status_code=400, detail="Service account credentials JSON required")

    sid = extract_spreadsheet_id(payload.spreadsheet)
    if not sid:
        raise HTTPException(status_code=400, detail="Spreadsheet ID/URL required")

    try:
        info = validate_and_describe(creds, sid, payload.worksheet or "elog")
    except GSheetError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cfg.credentials_json = creds
    cfg.spreadsheet_id = sid
    cfg.worksheet = payload.worksheet or "elog"
    cfg.auto_sync = payload.auto_sync
    cfg.enabled = True
    cfg.connected_email = info.get("email")
    if cfg.id is None:
        db.add(cfg)
    db.commit()
    return {**_gsheet_status(cfg), "spreadsheet_title": info.get("title")}


@router.delete("/infography/gsheet/config", status_code=204)
def gsheet_disconnect(current_user: models.User = Depends(require_manager),
                      db: Session = Depends(get_db)):
    cfg = _gsheet_row(db)
    if cfg:
        db.delete(cfg); db.commit()


@router.post("/infography/gsheet/sync")
def gsheet_sync(current_user: models.User = Depends(require_auth),
                db: Session = Depends(get_db)):
    from datetime import datetime, timezone
    from utils_gsheet import push_table, GSheetError

    cfg = _gsheet_row(db)
    if not cfg or not cfg.enabled or not cfg.credentials_json:
        raise HTTPException(status_code=400, detail="Google Sheets not connected")
    _, _, header, rows = _build_sheet(db)
    try:
        push_table(cfg.credentials_json, cfg.spreadsheet_id, cfg.worksheet, header, rows)
    except GSheetError as e:
        raise HTTPException(status_code=400, detail=str(e))
    cfg.last_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"ok": True, "rows": len(rows), "last_synced_at": cfg.last_synced_at}


def auto_sync_if_enabled() -> None:
    """Best-effort background push after a new log is created. Own DB session."""
    import threading

    def _worker():
        from database import SessionLocal
        from utils_gsheet import push_table
        from datetime import datetime, timezone
        db = SessionLocal()
        try:
            cfg = db.query(models.GSheetConfig).first()
            if not cfg or not cfg.enabled or not cfg.auto_sync or not cfg.credentials_json:
                return
            _, _, header, rows = _build_sheet(db)
            push_table(cfg.credentials_json, cfg.spreadsheet_id, cfg.worksheet, header, rows)
            cfg.last_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
        except Exception:
            pass
        finally:
            db.close()

    threading.Thread(target=_worker, daemon=True).start()
