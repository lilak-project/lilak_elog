"""
LILAK Elog Launcher — port 8010
커버 페이지 + 프로젝트 서버 생성/관리 전담.
개별 프로젝트 elog 는 8011-8019 에서 실행.

포트 배정 방식:
- config.json 없음. 포트는 Start 시점에 동적으로 배정.
- 실행 중인 서버는 data/{name}/.port 파일로 추적 (종료 시 삭제).
- 다른 서버에서 data/ 폴더를 복사해도 그냥 동작.
"""
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── 경로 ─────────────────────────────────────────────────────────────────────
_HERE     = Path(__file__).parent
_ROOT     = _HERE.parent
DATA_ROOT = Path(os.environ.get("ELOG_DATA_ROOT", _ROOT / "data"))
LAUNCHER_PORT      = int(os.environ.get("LAUNCHER_PORT", 8010))
PROJECT_PORT_START = 8011
PROJECT_PORT_END   = 8019

app = FastAPI(title="LILAK Elog Launcher")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── 유틸 ─────────────────────────────────────────────────────────────────────
def _port_alive(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def _read_port_file(name: str) -> int | None:
    f = DATA_ROOT / name / ".port"
    if not f.exists():
        return None
    try:
        port = int(f.read_text().strip())
        if _port_alive(port):
            return port
        f.unlink(missing_ok=True)
    except Exception:
        f.unlink(missing_ok=True)
    return None


def _write_port_file(name: str, port: int):
    (DATA_ROOT / name / ".port").write_text(str(port))


def _pick_free_port() -> int:
    for port in range(PROJECT_PORT_START, PROJECT_PORT_END + 1):
        if not _port_alive(port):
            return port
    raise HTTPException(500, "프로젝트 슬롯 부족 (8011-8019 모두 사용 중)")


# ── Per-project metadata (icon/color) — stored WITH the data so it travels ──────
# Lives at data/<name>/project.json, so copying the data folder to another
# machine carries the experiment's icon/colour along with its logs.
def _meta_file(name: str) -> Path:
    return DATA_ROOT / name / "project.json"


def _read_meta(name: str) -> dict:
    f = _meta_file(name)
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text())
    except Exception:
        return {}


def _write_meta(name: str, meta: dict):
    _meta_file(name).write_text(json.dumps(meta, ensure_ascii=False, indent=2))


def _list_projects() -> list[dict]:
    if not DATA_ROOT.is_dir():
        return []
    result = []
    for d in sorted(DATA_ROOT.iterdir()):
        if not d.is_dir():
            continue
        name = d.name
        port = _read_port_file(name)
        meta = _read_meta(name)
        result.append({
            "name":    name,
            "port":    port,
            "running": port is not None,
            "url":     f"http://localhost:{port}" if port else None,
            "icon":    meta.get("icon"),
            "color":   meta.get("color"),
        })
    return result


# ── API ───────────────────────────────────────────────────────────────────────
@app.get("/api/projects")
def api_projects():
    return _list_projects()


class NewProject(BaseModel):
    name: str
    icon: str | None = None
    color: str | None = None


@app.post("/api/projects", status_code=201)
def api_create(body: NewProject):
    name = body.name.strip()
    if not re.match(r'^[A-Za-z0-9_-]{1,64}$', name):
        raise HTTPException(400, "영문자·숫자·_·- 만 가능합니다 (1~64자)")
    proj_dir = DATA_ROOT / name
    if proj_dir.exists():
        raise HTTPException(409, f"'{name}' 이미 존재합니다")
    proj_dir.mkdir(parents=True)
    (proj_dir / "uploads").mkdir()
    _write_meta(name, {"icon": body.icon, "color": body.color})
    return {"name": name, "icon": body.icon, "color": body.color}


# ── Export / Import — a project's whole data dir as a single .zip ───────────────
# Export zips data/<name>/ (DB + uploads + project.json), excluding the runtime
# .port file. Import unzips an exported file into a NEW project, so a project can
# be moved between servers as one file (drag-and-drop in the UI).
@app.get("/api/projects/{name}/export")
def api_export(name: str):
    import io, zipfile
    proj_dir = DATA_ROOT / name
    if not proj_dir.exists():
        raise HTTPException(404, f"'{name}' 없음")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(proj_dir.rglob("*")):
            if f.is_file() and f.name != ".port":   # .port is runtime-only
                z.write(f, f.relative_to(proj_dir))
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'},
    )


@app.post("/api/projects/import", status_code=201)
async def api_import(file: UploadFile = File(...), name: str | None = Form(None)):
    import io, zipfile
    raw = await file.read()
    proj_name = (name or Path(file.filename or "imported").stem).strip()
    if not re.match(r'^[A-Za-z0-9_-]{1,64}$', proj_name):
        raise HTTPException(400, "이름은 영문자·숫자·_·- 만 가능합니다 (1~64자)")
    proj_dir = DATA_ROOT / proj_name
    if proj_dir.exists():
        raise HTTPException(409, f"'{proj_name}' 이미 존재합니다")
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(400, "올바른 .zip 파일이 아닙니다")
    proj_dir.mkdir(parents=True)
    root = proj_dir.resolve()
    for member in zf.namelist():
        dest = (proj_dir / member).resolve()
        if not str(dest).startswith(str(root)):   # zip-slip guard
            continue
        if member.endswith("/"):
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(member))
    (proj_dir / "uploads").mkdir(exist_ok=True)
    (proj_dir / ".port").unlink(missing_ok=True)   # never import a stale port
    return {"name": proj_name}


@app.post("/api/projects/{name}/start")
def api_start(name: str):
    proj_dir = DATA_ROOT / name
    if not proj_dir.exists():
        raise HTTPException(404, f"'{name}' 없음")

    port = _read_port_file(name)
    if port:
        return {"name": name, "port": port, "url": f"http://localhost:{port}", "already_running": True}

    port = _pick_free_port()
    _write_port_file(name, port)

    venv_python = str(_ROOT / ".venv" / "bin" / "python")
    if not Path(venv_python).exists():
        venv_python = sys.executable

    env = {
        **os.environ,
        "ELOG_EXPERIMENT": name,
        "ELOG_DATA_ROOT":  str(DATA_ROOT),
        "LAUNCHER_PORT":   str(LAUNCHER_PORT),
    }
    subprocess.Popen(
        [venv_python, "-m", "uvicorn", "main:app",
         "--host", "0.0.0.0", "--port", str(port), "--workers", "1"],
        cwd=str(_HERE),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    for _ in range(16):
        time.sleep(0.5)
        if _port_alive(port):
            return {"name": name, "port": port, "url": f"http://localhost:{port}", "started": True}

    (DATA_ROOT / name / ".port").unlink(missing_ok=True)
    raise HTTPException(500, f"서버 시작 실패 (port {port})")


@app.post("/api/projects/{name}/stop")
def api_stop(name: str):
    port = _read_port_file(name)
    if not port:
        return {"stopped": False, "reason": "not running"}
    try:
        pids = subprocess.check_output(
            ["lsof", "-ti", f":{port}", "-sTCP:LISTEN"],
            stderr=subprocess.DEVNULL
        ).decode().split()
        for pid in pids:
            try:
                os.kill(int(pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
    except subprocess.CalledProcessError:
        pass
    (DATA_ROOT / name / ".port").unlink(missing_ok=True)
    return {"stopped": True, "port": port}


@app.delete("/api/projects/{name}")
def api_delete(name: str):
    import shutil
    proj_dir = DATA_ROOT / name
    if not proj_dir.exists():
        raise HTTPException(404, f"'{name}' 없음")
    shutil.rmtree(proj_dir)
    return {"deleted": name}


# ── Reverse proxy: /p/{name}/... → that project's elog backend ────────────────
# Gives external services/systems a SINGLE stable entry point (this launcher
# port). They save `http://<host>:8010/p/<project>` as their elog_url, so the
# project's internal port can change freely without breaking pushes.
def _ensure_running(name: str) -> int:
    proj_dir = DATA_ROOT / name
    if not proj_dir.exists():
        raise HTTPException(404, f"'{name}' not found")
    port = _read_port_file(name)
    if port:
        return port
    started = api_start(name)          # boots the project, waits for the port
    return started["port"]


def _do_proxy(method: str, url: str, headers: dict, body: bytes):
    import urllib.request, urllib.error
    req = urllib.request.Request(url, data=body if body else None, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "application/json")
    except Exception as e:
        return 502, json.dumps({"detail": f"proxy error: {e}"}).encode(), "application/json"


@app.api_route("/p/{name}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def project_proxy(name: str, path: str, request: Request):
    from starlette.concurrency import run_in_threadpool
    from fastapi import Response
    port = _ensure_running(name)
    body = await request.body()
    qs = request.url.query
    target = f"http://127.0.0.1:{port}/{path}" + (f"?{qs}" if qs else "")
    fwd = {}
    for h in ("authorization", "content-type", "accept"):
        if h in request.headers:
            fwd[h] = request.headers[h]
    status, content, ctype = await run_in_threadpool(_do_proxy, request.method, target, fwd, body)
    return Response(content=content, status_code=status, media_type=ctype)


# ── 커버 페이지 ───────────────────────────────────────────────────────────────
COVER_HTML = r"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LILAK Elog</title>
<style>
/* ── Reset ── */
*{box-sizing:border-box;margin:0;padding:0}

/* ── Design tokens ── */
:root,[data-theme="lowcontrast"]{
  --app-bg:#ede8dc;
  --surface:#f5f0e6;
  --surface-2:#e8e0ce;
  --surface-3:#dac9a0;
  --border-default:#cec5af;
  --border-subtle:#dfd8c8;
  --text-primary:#2c2618;
  --text-secondary:#5a5040;
  --text-muted:#998c78;
  --text-emphasis:#1a1408;
  --success-bg:#cce0c0;
  --success-text:#3a5028;
  --danger-bg:#e8c8c0;
  --danger-text:#8a3020;
  --btn-primary-bg:#8a6040;
  --btn-primary-hover:#7a5030;
  --btn-primary-text:#fdf8f0;
  --input-bg:#f5f0e6;
  --input-border:#cec5af;
  --input-focus-border:#8a6040;
  --input-placeholder:#998c78;
  --nav-bg:#2c2618;
  --nav-text:#f5f0e6;
  --nav-text-muted:#998c78;
  --nav-accent:#3c3428;
  --overlay:rgba(60,40,20,0.5);
  --scrollbar-thumb:#cec5af;
}
[data-theme="dark"]{
  --app-bg:#0f172a;
  --surface:#1e293b;
  --surface-2:#162032;
  --surface-3:#334155;
  --border-default:#334155;
  --border-subtle:#243347;
  --text-primary:#e2e8f0;
  --text-secondary:#94a3b8;
  --text-muted:#64748b;
  --text-emphasis:#f8fafc;
  --success-bg:rgba(16,185,129,0.18);
  --success-text:#34d399;
  --danger-bg:rgba(127,29,29,0.35);
  --danger-text:#fca5a5;
  --btn-primary-bg:#3b82f6;
  --btn-primary-hover:#2563eb;
  --btn-primary-text:#ffffff;
  --input-bg:#1e293b;
  --input-border:#334155;
  --input-focus-border:#60a5fa;
  --input-placeholder:#64748b;
  --nav-bg:#070d1a;
  --nav-text:#e2e8f0;
  --nav-text-muted:#64748b;
  --nav-accent:#1e3a5a;
  --overlay:rgba(0,0,0,0.6);
  --scrollbar-thumb:#475569;
}
[data-theme="bright"]{
  --app-bg:#f8fafc;
  --surface:#ffffff;
  --surface-2:#f1f5f9;
  --surface-3:#e2e8f0;
  --border-default:#e2e8f0;
  --border-subtle:#f1f5f9;
  --text-primary:#1e293b;
  --text-secondary:#475569;
  --text-muted:#94a3b8;
  --text-emphasis:#0f172a;
  --success-bg:#d1fae5;
  --success-text:#065f46;
  --danger-bg:#fee2e2;
  --danger-text:#b91c1c;
  --btn-primary-bg:#2563eb;
  --btn-primary-hover:#1d4ed8;
  --btn-primary-text:#ffffff;
  --input-bg:#ffffff;
  --input-border:#cbd5e1;
  --input-focus-border:#3b82f6;
  --input-placeholder:#94a3b8;
  --nav-bg:#18181b;
  --nav-text:#f4f4f5;
  --nav-text-muted:#a1a1aa;
  --nav-accent:#3f3f46;
  --overlay:rgba(15,23,42,0.4);
  --scrollbar-thumb:#cbd5e1;
}

/* ── Base ── */
body{
  font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
  background:var(--app-bg);
  color:var(--text-primary);
  min-height:100vh;
  font-size:14px;
  line-height:1.5;
}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:3px}

/* ── Nav ── */
nav{
  background:var(--nav-bg);
  height:40px;
  display:flex;
  align-items:center;
  padding:0 16px;
  gap:10px;
  position:sticky;top:0;z-index:50;
  border-bottom:1px solid #1a2440;
}
.nav-logo{
  display:flex;align-items:center;gap:8px;
  font-weight:700;font-size:.875rem;color:var(--nav-text);
  text-decoration:none;
}
.nav-logo svg{width:18px;height:18px;color:var(--nav-text)}
.nav-spacer{flex:1}
.nav-chip{
  height:28px;display:flex;align-items:center;gap:6px;
  padding:0 10px;border-radius:6px;font-size:.75rem;font-weight:500;
  color:var(--nav-text-muted);cursor:default;
  border:1px solid #1a2440;
}

/* ── Page layout ── */
.page{max-width:900px;margin:0 auto;padding:36px 24px}
.page-header{
  display:flex;align-items:flex-end;justify-content:space-between;
  margin-bottom:28px;gap:12px;flex-wrap:wrap;
}
.page-title{font-size:1.25rem;font-weight:700;color:var(--text-emphasis);letter-spacing:-.02em}
.page-sub{font-size:.8rem;color:var(--text-muted);margin-top:2px}

/* ── Button ── */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  box-sizing:border-box;
  border:1px solid transparent;border-radius:8px;font-size:.9rem;font-weight:500;
  padding:9px 20px;cursor:pointer;transition:background .15s,opacity .15s;
  white-space:nowrap;line-height:1;vertical-align:middle;
}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-primary{background:var(--btn-primary-bg);color:var(--btn-primary-text)}
.btn-primary:hover:not(:disabled){background:var(--btn-primary-hover)}
.btn-ghost{background:transparent;color:var(--text-secondary);border-color:var(--border-default)}
.btn-ghost:hover:not(:disabled){background:var(--surface-2)}
.btn-danger{background:transparent;color:var(--danger-text)}
.btn-danger:hover:not(:disabled){background:var(--danger-bg)}
.btn-success{background:var(--success-bg);color:var(--success-text);border-color:var(--success-text);border-opacity:.3}
.btn-success:hover:not(:disabled){filter:brightness(.92)}
.btn-sm{height:32px;padding:0 16px;font-size:.83rem;border-radius:7px}

/* ── Grid ── */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}

/* ── Card ── */
.card{
  background:var(--surface);
  border:1px solid var(--border-default);
  border-radius:12px;
  padding:18px 20px;
  transition:border-color .2s,box-shadow .2s;
  display:flex;flex-direction:column;gap:14px;
  min-height:170px;
}
.card:hover{border-color:var(--text-muted);box-shadow:0 4px 24px rgba(0,0,0,.15)}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.card-name{
  font-family:'JetBrains Mono','Fira Code',monospace;
  font-size:1.1rem;font-weight:700;color:var(--text-emphasis);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.badge{
  display:inline-flex;align-items:center;gap:4px;
  font-size:.68rem;font-weight:600;padding:2px 8px;
  border-radius:20px;white-space:nowrap;flex-shrink:0;
}
.badge-on{background:rgba(16,185,129,.15);color:var(--success-text);border:1px solid rgba(52,211,153,.25)}
.badge-off{background:var(--surface-2);color:var(--text-muted);border:1px solid var(--border-default)}
.card-meta{font-size:.75rem;color:var(--text-muted);font-family:monospace;min-height:1em}
.card-actions{display:flex;align-items:center;gap:6px;margin-top:auto}
.card-actions .spacer{flex:1}

/* ── Spinner ── */
.spin{
  width:12px;height:12px;border:2px solid rgba(255,255,255,.2);
  border-top-color:currentColor;border-radius:50%;
  animation:spin .6s linear infinite;flex-shrink:0;
}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Empty state ── */
.empty{
  grid-column:1/-1;text-align:center;padding:60px 24px;
  color:var(--text-muted);
}
.empty-icon{font-size:2.5rem;margin-bottom:12px;opacity:.4}
.empty-title{font-size:1rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px}
.empty-sub{font-size:.8rem}

/* ── Divider ── */
.divider{height:1px;background:var(--border-subtle);margin:8px 0}

/* ── Modal ── */
.modal-backdrop{
  display:none;position:fixed;inset:0;background:var(--overlay);
  z-index:200;align-items:center;justify-content:center;
  backdrop-filter:blur(2px);
}
.modal-backdrop.open{display:flex}
.modal{
  background:var(--surface);border:1px solid var(--border-default);
  border-radius:16px;padding:28px;width:100%;max-width:420px;
  box-shadow:0 20px 60px rgba(0,0,0,.5);
}
.modal-title{font-size:1rem;font-weight:700;color:var(--text-emphasis);margin-bottom:20px}
.modal-label{font-size:.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:6px;display:block}
.modal-input{
  width:100%;background:var(--input-bg);border:1px solid var(--input-border);
  border-radius:8px;color:var(--text-primary);
  padding:8px 12px;font-size:.875rem;outline:none;
  transition:border-color .15s;font-family:monospace;
}
.modal-input:focus{border-color:var(--input-focus-border)}
.modal-input::placeholder{color:var(--input-placeholder)}
.modal-hint{font-size:.72rem;color:var(--text-muted);margin-top:5px}
.modal-err{font-size:.75rem;color:var(--danger-text);min-height:1.2em;margin-top:6px}
.modal-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}

/* ── Toast ── */
#toast{
  position:fixed;bottom:24px;right:24px;z-index:300;
  display:flex;flex-direction:column;gap:8px;pointer-events:none;
}
.toast-item{
  background:var(--surface);border:1px solid var(--border-default);
  border-radius:10px;padding:10px 16px;font-size:.8rem;
  color:var(--text-primary);box-shadow:0 4px 20px rgba(0,0,0,.4);
  animation:slideIn .2s ease;max-width:300px;
}
.toast-item.err{border-color:var(--danger-text);color:var(--danger-text)}
@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:none;opacity:1}}
</style>
</head>
<body>

<!-- Nav -->
<nav>
  <a class="nav-logo" href="/">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      <line x1="9" y1="9" x2="15" y2="9"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="12" y2="17"/>
    </svg>
    <span>LILAK Elog</span>
  </a>
  <div class="nav-spacer"></div>
  <div class="nav-chip" id="nav-status">
    <span id="nav-dot" style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);flex-shrink:0"></span>
    <span id="nav-label">로딩 중</span>
  </div>
  <button class="nav-chip" id="btn-theme" onclick="cycleTheme()" title="테마 변경" style="cursor:pointer;border:none;background:var(--nav-accent)">
    <span id="theme-icon">🌥</span>
  </button>
</nav>

<!-- Page -->
<div class="page">
  <div class="page-header">
    <div>
      <div class="page-title">프로젝트</div>
      <div class="page-sub">프로젝트를 선택하거나 새로 만드세요</div>
    </div>
    <button class="btn btn-primary" onclick="openNew()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      새 프로젝트
    </button>
  </div>

  <div class="grid" id="grid">
    <div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">로딩 중…</div></div>
  </div>
</div>

<!-- Modal -->
<div class="modal-backdrop" id="modal" onclick="closeNew(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-title">새 프로젝트 만들기</div>
    <label class="modal-label" for="new-name">프로젝트 이름</label>
    <input class="modal-input" id="new-name"
           placeholder="my_experiment"
           autocomplete="off" spellcheck="false"
           onkeydown="if(event.key==='Enter')createProject()">
    <div class="modal-hint">영문자·숫자·_·- 만 사용 가능 (1–64자)</div>
    <div class="modal-err" id="new-err"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeNew()">취소</button>
      <button class="btn btn-primary" id="btn-create" onclick="createProject()">만들기</button>
    </div>
  </div>
</div>

<!-- Toast container -->
<div id="toast"></div>

<script>
let projects = [];
let busy = new Set();

// ── toast ──────────────────────────────────────────────────────────────────
function toast(msg, isErr=false){
  const el = document.createElement('div');
  el.className = 'toast-item' + (isErr?' err':'');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

// ── fetch ──────────────────────────────────────────────────────────────────
async function fetchProjects(){
  try {
    const r = await fetch('/api/projects');
    projects = await r.json();
    render();
    updateNavStatus();
  } catch(e){ /* silent */ }
}

function updateNavStatus(){
  const running = projects.filter(p=>p.running).length;
  const dot   = document.getElementById('nav-dot');
  const label = document.getElementById('nav-label');
  if(running){
    dot.style.background = '#34d399';
    label.textContent = `${projects.length}개 프로젝트 · ${running}개 실행 중`;
  } else {
    dot.style.background = 'var(--text-muted)';
    label.textContent = `${projects.length}개 프로젝트`;
  }
}

// ── render ─────────────────────────────────────────────────────────────────
function render(){
  const grid = document.getElementById('grid');
  if(!projects.length){
    grid.innerHTML = `<div class="empty">
      <div class="empty-icon">📂</div>
      <div class="empty-title">프로젝트가 없습니다</div>
      <div class="empty-sub">오른쪽 위 "새 프로젝트"로 시작하세요</div>
    </div>`;
    return;
  }
  grid.innerHTML = projects.map(p => {
    const isBusy = busy.has(p.name);
    const runBadge = p.running
      ? `<span class="badge badge-on"><span style="width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0"></span>실행 중</span>`
      : `<span class="badge badge-off">중지됨</span>`;
    const portInfo = p.port ? `:${p.port}` : '';
    const openBtn  = `<button class="btn btn-success btn-sm" onclick="openProject('${esc(p.url)}')">열기</button>`;
    const stopBtn  = `<button class="btn btn-ghost btn-sm"${isBusy?' disabled':''}  onclick="stopProject('${esc(p.name)}')">${isBusy?'<span class="spin"></span>':''}종료</button>`;
    const startBtn = `<button class="btn btn-primary btn-sm"${isBusy?' disabled':''} onclick="startProject('${esc(p.name)}')">${isBusy?'<span class="spin"></span>시작 중…':'시작'}</button>`;
    const actions  = p.running ? openBtn + stopBtn : startBtn;
    return `<div class="card">
      <div class="card-head">
        <span class="card-name" title="${esc(p.name)}">${esc(p.name)}</span>
        ${runBadge}
      </div>
      <div class="card-meta">${portInfo}</div>
      <div class="divider"></div>
      <div class="card-actions">
        ${actions}
        <div class="spacer"></div>
        <button class="btn btn-danger btn-sm" onclick="deleteProject('${esc(p.name)}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── actions ────────────────────────────────────────────────────────────────
function openProject(url){ window.location.href = url; }

async function startProject(name){
  busy.add(name); render();
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(name)}/start`, {method:'POST'});
    const d = await r.json();
    if(!r.ok){ toast(d.detail||'시작 실패', true); busy.delete(name); await fetchProjects(); return; }
    window.location.href = d.url || `http://localhost:${d.port}`;
    return;
  } catch(e){ toast('오류: '+e.message, true); }
  busy.delete(name);
  await fetchProjects();
}

async function stopProject(name){
  if(!confirm(`'${name}' 서버를 종료하시겠습니까?`)) return;
  busy.add(name); render();
  try {
    await fetch(`/api/projects/${encodeURIComponent(name)}/stop`, {method:'POST'});
    toast(`'${name}' 종료됨`);
  } catch(e){ toast('종료 중 오류', true); }
  busy.delete(name);
  await fetchProjects();
}

async function deleteProject(name){
  if(!confirm(`'${name}' 프로젝트를 삭제하시겠습니까?\n\n⚠ 로그·첨부파일 등 모든 데이터가 영구 삭제됩니다.`)) return;
  await fetch(`/api/projects/${encodeURIComponent(name)}/stop`, {method:'POST'}).catch(()=>{});
  const r = await fetch(`/api/projects/${encodeURIComponent(name)}`, {method:'DELETE'}).catch(()=>null);
  if(r?.ok) toast(`'${name}' 삭제됨`);
  else toast('삭제 실패', true);
  await fetchProjects();
}

// ── modal ──────────────────────────────────────────────────────────────────
function openNew(){
  document.getElementById('modal').classList.add('open');
  document.getElementById('new-name').value='';
  document.getElementById('new-err').textContent='';
  setTimeout(()=>document.getElementById('new-name').focus(), 60);
}
function closeNew(e){
  if(!e || e.target===document.getElementById('modal'))
    document.getElementById('modal').classList.remove('open');
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeNew(); });

async function createProject(){
  const name = document.getElementById('new-name').value.trim();
  const errEl = document.getElementById('new-err');
  errEl.textContent = '';
  if(!name){ errEl.textContent = '이름을 입력하세요'; return; }
  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  try {
    const r = await fetch('/api/projects', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name})
    });
    const d = await r.json();
    if(!r.ok){ errEl.textContent = d.detail||'오류'; return; }
    closeNew();
    toast(`'${name}' 생성됨`);
    await fetchProjects();
  } catch(e){ errEl.textContent = '오류: '+e.message; }
  finally { btn.disabled = false; }
}

// ── theme ──────────────────────────────────────────────────────────────────
const THEMES = ['lowcontrast','bright','dark'];
const THEME_ICONS = {lowcontrast:'🌥', bright:'☀️', dark:'🌙'};
let currentTheme = localStorage.getItem('launcher_theme') || 'lowcontrast';

function applyTheme(t){
  currentTheme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('launcher_theme', t);
  document.getElementById('theme-icon').textContent = THEME_ICONS[t] || '🌥';
}
function cycleTheme(){
  const idx = THEMES.indexOf(currentTheme);
  applyTheme(THEMES[(idx+1) % THEMES.length]);
}
applyTheme(currentTheme);

// ── init ───────────────────────────────────────────────────────────────────
fetchProjects();
setInterval(fetchProjects, 3000);
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def cover():
    return COVER_HTML


# ── 프로젝트 서버가 서빙하는 빌드 결과물의 정적 파일도 공유 (logo 등) ──────
_FRONTEND_DIST = _ROOT / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    async def static_assets(path: str):
        candidate = _FRONTEND_DIST / path
        if candidate.is_file():
            return FileResponse(str(candidate))
        from fastapi import Response
        return Response(status_code=404)
