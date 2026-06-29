"""
LILAK Elog Launcher — port 8010
앱 진입점: 빌드된 React 프론트엔드(프로젝트 페이지 포함)를 직접 서빙하고,
프로젝트 서버 생성/관리 + 역프록시를 담당한다.
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
# Default elog backend for experiment-less `/api/*` calls (login, /auth/me, …).
# Mirrors Vite's `/api` → ELOG_BACKEND proxy so the React app works when the
# launcher serves it directly.
DEFAULT_BACKEND    = os.environ.get("ELOG_BACKEND", f"http://127.0.0.1:{PROJECT_PORT_START}")

app = FastAPI(title="LILAK Elog Launcher")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── `/launcher` 프리픽스 제거 ───────────────────────────────────────────────────
# The React app (api.js) addresses the launcher as `/launcher/api/...` and
# `/launcher/p/<name>/...` (Vite strips the prefix in dev). When the launcher
# serves the app itself, strip `/launcher` here before routing so the same calls
# resolve to the launcher's own `/api/*` and `/p/*` routes.
@app.middleware("http")
async def _strip_launcher_prefix(request: Request, call_next):
    p = request.scope.get("path", "")
    if p == "/launcher" or p.startswith("/launcher/"):
        new = p[len("/launcher"):] or "/"
        request.scope["path"] = new
        request.scope["raw_path"] = new.encode("utf-8")
    return await call_next(request)


# Central portal accounts: `/api/auth/*` is handled HERE (not proxied to a
# service). Included before the generic `/api/*` proxy so these specific auth
# routes win; everything else under `/api/*` still forwards to a service.
from portal_auth import router as portal_router
app.include_router(portal_router)

# Portal service registry + per-account permissions + access requests
# (`/api/services`, `/api/access-requests`, `/api/admin/*`).
from portal_services import router as portal_services_router
app.include_router(portal_services_router)

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
        if name.startswith("_"):     # reserved/internal (e.g. _portal) — not a service
            continue
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
    except subprocess.CalledProcessError:
        pids = []
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    # The elog backend runs a background refresh loop, so graceful shutdown can
    # lag and the port stays bound for a while — which looks like "Stop didn't
    # work". Wait briefly for the port to free, then SIGKILL whatever's left so
    # Stop is reliable (the listening port is the source of truth for "running").
    for _ in range(10):                       # up to ~2s
        if not _port_alive(port):
            break
        time.sleep(0.2)
    if _port_alive(port):
        for pid in pids:
            try:
                os.kill(int(pid), signal.SIGKILL)
            except ProcessLookupError:
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




# ── 기본 백엔드 프록시 ─────────────────────────────────────────────────────────
# The React app talks to a "default" elog backend via `/api/*` when no experiment
# is selected (login, /auth/me, …). Vite proxies this to ELOG_BACKEND in dev; when
# the launcher serves the app we forward it the same way. Registered AFTER the
# launcher's own `/api/projects*` routes, so those still win for project calls;
# everything else under `/api/*` is proxied to the default backend.
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
               include_in_schema=False)
async def default_api_proxy(path: str, request: Request):
    from starlette.concurrency import run_in_threadpool
    from fastapi import Response
    body = await request.body()
    qs = request.url.query
    target = f"{DEFAULT_BACKEND}/api/{path}" + (f"?{qs}" if qs else "")
    fwd = {}
    for h in ("authorization", "content-type", "accept"):
        if h in request.headers:
            fwd[h] = request.headers[h]
    status, content, ctype = await run_in_threadpool(_do_proxy, request.method, target, fwd, body)
    return Response(content=content, status_code=status, media_type=ctype)


# ── React 프론트엔드(SPA) 서빙 ──────────────────────────────────────────────────
# The launcher IS the app's entry point: it serves the built React bundle and
# falls back to index.html for client-side routes (`/`, `/projects`, `/logs/…`),
# so `./start.sh` lands on the React Projects page (not a hand-written cover).
# Registered last — `/api/*` and `/p/*` routes above take precedence.
_FRONTEND_DIST = _ROOT / "frontend" / "dist"
_INDEX_HTML    = _FRONTEND_DIST / "index.html"
if _FRONTEND_DIST.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        from fastapi import Response
        # Serve a real built file (assets, lilak.svg, …) when it exists …
        try:
            if path:
                candidate = (_FRONTEND_DIST / path).resolve()
                if candidate.is_file() and str(candidate).startswith(str(_FRONTEND_DIST.resolve())):
                    return FileResponse(str(candidate))
        except Exception:
            pass
        # … otherwise hand back index.html and let React Router take over.
        if _INDEX_HTML.is_file():
            return FileResponse(str(_INDEX_HTML))
        return Response(status_code=404)
