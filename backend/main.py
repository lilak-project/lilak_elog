"""
Lab ELog — FastAPI application entry point.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import init_db
from routes import logs, users, attachments, export, api_tokens, formats, comments, notifications, notices, community, webhooks, ai_bots, schedule, services, tasks, infography
from routes import modules as modules_router
from module_runner import start_module_runner


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    await start_module_runner()
    yield


app = FastAPI(
    title="Lab ELog",
    description="Electronic Logbook for experimental physics labs",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow all origins in dev; restrict in production via ELOG_ALLOWED_ORIGINS env var
allowed_origins = os.environ.get("ELOG_ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routes ─────────────────────────────────────────────────────────────────
app.include_router(logs.router,         prefix="/api")
app.include_router(users.router,        prefix="/api")
app.include_router(attachments.router,  prefix="/api")
app.include_router(export.router,       prefix="/api")
app.include_router(api_tokens.router,      prefix="/api")
app.include_router(formats.router,         prefix="/api")
app.include_router(comments.router,        prefix="/api")
app.include_router(notifications.router,   prefix="/api")
app.include_router(notices.router,         prefix="/api")
app.include_router(community.router,       prefix="/api")
app.include_router(webhooks.router,        prefix="/api")
app.include_router(ai_bots.router,         prefix="/api")
app.include_router(schedule.router,        prefix="/api")
app.include_router(services.router,        prefix="/api")
app.include_router(modules_router.router,  prefix="/api")
app.include_router(tasks.router,           prefix="/api")
app.include_router(infography.router,      prefix="/api")

# ── Serve built React frontend (SPA catch-all) ────────────────────────────────
_FRONTEND = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
)

if os.path.isdir(_FRONTEND):
    # /assets/ — Vite 빌드 결과물 (JS/CSS, 콘텐츠 해시 포함)
    _assets = os.path.join(_FRONTEND, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    # 그 외 모든 경로: 실제 파일이면 그 파일, 없으면 index.html (SPA 라우팅)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # public 폴더 파일 (logo.svg, favicon.ico 등)
        candidate = os.path.join(_FRONTEND, full_path)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        # 나머지 모두 React Router 에게 위임
        index = os.path.join(_FRONTEND, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Not Found")
