"""
Community chat routes — messages, image upload, log cross-posting, AI bot responses.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import require_auth, require_manager
from database import get_db, DATA_ROOT, EXPERIMENT
from models import AiBot, ChatMessage, Comment, CommunityBridge, LogEntry, Notification, User
from schemas import (
    ChatMessageCreate, ChatMessageOut,
    CommunityBridgeCreate, CommunityBridgeOut, CommunityBridgeUpdate,
)

# Matches @username (letters, digits, underscore)
_MENTION_RE = re.compile(r'@([A-Za-z0-9_]+)')

router = APIRouter(tags=["community"])

UPLOADS_DIR = os.path.join(DATA_ROOT, EXPERIMENT, "uploads")


# ── Messages ──────────────────────────────────────────────────────────────────

@router.get("/community/messages", response_model=list[ChatMessageOut])
def list_messages(
    after_id: int = Query(default=0),
    before_id: int = Query(default=0),
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
):
    """Fetch chat messages.
       • `after_id`  → messages newer than this id, chronological order (polling)
       • `before_id` → messages older than this id, chronological order (history scroll-up)
       • neither    → oldest N messages, chronological order
    """
    q = db.query(ChatMessage)
    if before_id:
        # Older-than: take the last N below before_id, then flip to chronological.
        rows = (
            q.filter(ChatMessage.id < before_id)
             .order_by(ChatMessage.created_at.desc())
             .limit(limit)
             .all()
        )
        return list(reversed(rows))
    if after_id:
        q = q.filter(ChatMessage.id > after_id)
    return q.order_by(ChatMessage.created_at.asc()).limit(limit).all()


@router.get("/community/messages/latest", response_model=list[ChatMessageOut])
def latest_messages(
    limit: int = Query(default=60, le=200),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ChatMessage)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(rows))


@router.post("/community/messages", response_model=ChatMessageOut)
def post_message(
    payload: ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    body = payload.body.strip()
    if not body:
        raise HTTPException(400, "Message cannot be empty")

    log_title = None
    if payload.log_id:
        log = db.query(LogEntry).filter(LogEntry.id == payload.log_id).first()
        if log:
            log_title = log.title

    # Reply: fetch excerpt from the original message
    reply_to_author = None
    reply_to_body   = None
    if payload.reply_to_id:
        orig = db.query(ChatMessage).filter(ChatMessage.id == payload.reply_to_id).first()
        if orig:
            reply_to_author = orig.author_name
            reply_to_body   = (orig.body or "")[:200]

    msg = ChatMessage(
        author_id=current_user.id,
        author_name=current_user.username,
        body=body,
        log_id=payload.log_id,
        log_title=log_title,
        is_cross_posted=False,
        reply_to_id=payload.reply_to_id if payload.reply_to_id else None,
        reply_to_author=reply_to_author,
        reply_to_body=reply_to_body,
    )
    db.add(msg)
    db.flush()

    # Cross-post: community message linking a log → add comment on that log
    if payload.log_id and not msg.is_cross_posted:
        log = db.query(LogEntry).filter(LogEntry.id == payload.log_id).first()
        if log:
            comment_body = f"[커뮤니티] {current_user.username}: {body}"
            comment = Comment(
                log_id=payload.log_id,
                author_id=current_user.id,
                author_name=current_user.username,
                body=comment_body,
            )
            db.add(comment)
            db.flush()
            msg.comment_id = comment.id

    # ── @mentions → notifications ────────────────────────────────────────────
    mentioned = set(_MENTION_RE.findall(body))
    if mentioned:
        # Resolve to active users; exclude the author (no self-pings)
        users = (
            db.query(User)
            .filter(
                User.username.in_(mentioned),
                User.is_active == True,
                User.id != current_user.id,
            )
            .all()
        )
        for u in users:
            db.add(Notification(
                user_id=u.id,
                from_user_name=current_user.username,
                log_id=payload.log_id,
                log_title=log_title,
                comment_excerpt=body[:200],
                notif_type='mention',
            ))

    db.commit()
    db.refresh(msg)

    # ── Trigger AI bots for any @mentioned bot names ─────────────────────────
    if mentioned and not msg.is_ai_response:
        _trigger_ai_bots(mentioned, msg.id, msg.author_name, body, db)

    # ── Broadcast to external bridges (Dooray / Discord) ──────────────────────
    # Skip if this message itself came from an external source (loop prevention)
    # — but here the post comes from a real user, so external_source is None.
    _broadcast_to_bridges(msg, db)

    return msg


@router.delete("/community/messages/{msg_id}", status_code=204)
def delete_message(
    msg_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    msg = db.query(ChatMessage).filter(ChatMessage.id == msg_id).first()
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg.author_id != current_user.id and current_user.role != "manager":
        raise HTTPException(403, "Not allowed")
    db.delete(msg)
    db.commit()


# ── Image upload ──────────────────────────────────────────────────────────────

@router.post("/community/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    current_user=Depends(require_auth),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted")

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or ".png"
    filename = f"comm_{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOADS_DIR, filename)

    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    # NOTE: served by the GET /community/images/{filename} route below,
    # NOT /attachments/{id} (which expects an integer attachment row).
    return {"filename": filename, "url": f"/api/community/images/{filename}"}


_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


@router.get("/community/images/{filename}")
def get_community_image(filename: str):
    """Serve a community-uploaded image (pasted in a chat message)."""
    # Defend against ../ traversal — only allow our own [a-zA-Z0-9._-] filenames
    if not _SAFE_NAME_RE.fullmatch(filename):
        raise HTTPException(400, "Invalid filename")
    path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Image not found")
    # Guess content type from extension
    ext = os.path.splitext(filename)[1].lower()
    ctype = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
    }.get(ext, "application/octet-stream")
    return FileResponse(path=path, media_type=ctype, filename=filename)


# ── AI bot trigger ─────────────────────────────────────────────────────────────

def _trigger_ai_bots(mentioned: set, trigger_msg_id: int,
                     trigger_author: str, trigger_body: str,
                     db: Session) -> None:
    """Check if any mentioned names match enabled AI bots; fire async response."""
    # Case-insensitive: bot names are stored lowercase
    mentioned_lower = {m.lower() for m in mentioned}
    bots = (
        db.query(AiBot)
        .filter(AiBot.name.in_(mentioned_lower), AiBot.enabled == True)
        .all()
    )
    print(f"[AI] mentioned={mentioned_lower}, bots found={[b.name for b in bots]}", flush=True)
    for bot in bots:
        _fire_bot(bot.name, bot.provider, bot.api_key, bot.model,
                  bot.system_prompt, bot.context_count,
                  trigger_msg_id, trigger_author, trigger_body)


def _fire_bot(bot_name: str, provider: str, api_key: str, model: str,
              system_prompt: str, context_count: int,
              trigger_msg_id: int, trigger_author: str, trigger_body: str) -> None:
    """Spawn a daemon thread that calls the AI API and posts the reply."""
    from database import SessionLocal

    def _call_openai(msgs: list) -> str:
        data = json.dumps({
            "model": model or "gpt-4o-mini",
            "messages": msgs,
            "max_tokens": 800,
        }).encode()
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    "https://api.openai.com/v1/chat/completions",
                    data=data,
                    headers={"Content-Type": "application/json",
                             "Authorization": f"Bearer {api_key}"},
                )
                with urllib.request.urlopen(req, timeout=40) as resp:
                    return json.loads(resp.read())["choices"][0]["message"]["content"]
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 2:
                    wait = 10 * (2 ** attempt)  # 10s, 20s
                    print(f"[AI] OpenAI rate limited, retry in {wait}s (attempt {attempt+1})", flush=True)
                    time.sleep(wait)
                else:
                    raise

    def _call_anthropic(sys: str, msgs: list) -> str:
        payload: dict = {
            "model": model or "claude-3-5-haiku-20241022",
            "max_tokens": 800,
            "messages": msgs,
        }
        if sys:
            payload["system"] = sys
        data = json.dumps(payload).encode()
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    "https://api.anthropic.com/v1/messages",
                    data=data,
                    headers={"Content-Type": "application/json",
                             "x-api-key": api_key,
                             "anthropic-version": "2023-06-01"},
                )
                with urllib.request.urlopen(req, timeout=40) as resp:
                    return json.loads(resp.read())["content"][0]["text"]
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 2:
                    wait = 10 * (2 ** attempt)
                    print(f"[AI] Anthropic rate limited, retry in {wait}s (attempt {attempt+1})", flush=True)
                    time.sleep(wait)
                else:
                    raise

    def _run():
        sess = SessionLocal()
        try:
            # Fetch recent context messages (up to context_count before + including trigger)
            recent = (
                sess.query(ChatMessage)
                .filter(
                    ChatMessage.id <= trigger_msg_id,
                    ChatMessage.is_system == False,
                )
                .order_by(ChatMessage.created_at.desc())
                .limit(context_count)
                .all()
            )
            recent = list(reversed(recent))  # chronological order

            default_sys = (
                "당신은 실험 연구소 전자 로그북(Elog) 커뮤니티 채팅의 AI 어시스턴트입니다. "
                "연구자들이 실험 로그, 데이터, 분석, 문제 해결 등을 논의하는 공간입니다. "
                "간결하고 정확하게 답변하세요. 마크다운을 사용해도 됩니다."
            )
            sys_text = system_prompt or default_sys

            # Build conversation: bot's own messages → assistant, others → user
            chat_msgs: list[dict] = []
            for m in recent:
                if m.is_ai_response and m.author_name == bot_name:
                    chat_msgs.append({"role": "assistant", "content": m.body})
                else:
                    chat_msgs.append({"role": "user",
                                      "content": f"{m.author_name}: {m.body}"})

            # Merge consecutive same-role messages (API requirement)
            merged: list[dict] = []
            for cm in chat_msgs:
                if merged and merged[-1]["role"] == cm["role"]:
                    merged[-1]["content"] += "\n" + cm["content"]
                else:
                    merged.append(dict(cm))

            # Must start with a user turn
            while merged and merged[0]["role"] == "assistant":
                merged.pop(0)
            if not merged:
                return

            # Call the appropriate API
            if provider == "openai":
                all_msgs = [{"role": "system", "content": sys_text}] + merged
                response_text = _call_openai(all_msgs)
            elif provider == "anthropic":
                response_text = _call_anthropic(sys_text, merged)
            else:
                return

            if not response_text or not response_text.strip():
                return

            # Post the AI reply as a chat message
            reply = ChatMessage(
                author_id=None,
                author_name=bot_name,
                body=response_text.strip(),
                is_cross_posted=True,
                is_ai_response=True,
                reply_to_id=trigger_msg_id,
                reply_to_author=trigger_author,
                reply_to_body=(trigger_body or "")[:200],
            )
            sess.add(reply)
            sess.commit()
        except Exception as e:
            import traceback
            print(f"[AI Bot ERROR] {bot_name}: {e}", flush=True)
            traceback.print_exc()
        finally:
            sess.close()

    threading.Thread(target=_run, daemon=True).start()


# ────────────────────────────────────────────────────────────────────────────
# ── Community ↔ external chat bridges (Dooray / Discord) ────────────────────
# ────────────────────────────────────────────────────────────────────────────

import secrets as _secrets


def _bridge_to_out(b: CommunityBridge, request_base: Optional[str] = None) -> dict:
    """Shape a CommunityBridge for the API. Includes managed-relay status if
    a bot_token is configured. Never returns the raw bot_token."""
    incoming_url = None
    if b.incoming_token:
        path = f"/api/community/incoming/{b.incoming_token}"
        incoming_url = (request_base.rstrip('/') + path) if request_base else path

    has_bot_token = bool(b.bot_token)
    relay_status = None
    relay_pid = None
    relay_log_tail = None
    if has_bot_token and b.source_type == "discord":
        from services.relay_manager import get_status
        st = get_status(b.id)
        relay_status = "running" if st["running"] else "stopped"
        relay_pid = st["pid"]
        relay_log_tail = st["log_tail"]

    return {
        "id": b.id,
        "name": b.name,
        "source_type": b.source_type,
        "outgoing_url": b.outgoing_url,
        "incoming_token": b.incoming_token,
        "incoming_url": incoming_url,
        "has_bot_token": has_bot_token,
        "relay_status": relay_status,
        "relay_pid": relay_pid,
        "relay_log_tail": relay_log_tail,
        "enabled": b.enabled,
        "created_at": b.created_at,
    }


def _bridge_payload(source_type: str, author: str, text: str) -> dict:
    """Single source of truth for the per-provider outgoing payload shape —
    used by both real broadcasts and the manager test endpoint so they can
    never diverge."""
    if source_type == "discord":
        return {"content": text, "username": f"{author} (lilak)"}
    if source_type == "slack":
        # Slack incoming webhook: { text, username, icon_emoji?, mrkdwn? }
        # Author name already shown by `username` field, so keep the
        # text body unwrapped (no surrounding * or **) — user requested
        # plain "author: message" instead of "*author*: message".
        return {"text": f"{author}: {text}", "username": f"{author} (lilak)", "mrkdwn": True}
    # Dooray (default) — supports botName / botIconImage / text.
    # No **bold** wrappers: Dooray renders the text verbatim.
    return {"text": f"{author}: {text}", "botName": author}


def _post_bridge(url: str, payload: dict, timeout: float = 5) -> tuple[bool, int, str]:
    """POST to an outgoing webhook URL. Returns (ok, status, body_or_error)."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            # Cloudflare in front of Dooray blocks the default
            # "Python-urllib/3.x" UA with error 1010. Send a normal-
            # looking UA so the request goes through.
            "User-Agent": "lilak-elog-bridge/1.0 (+https://github.com/)",
            "Accept":     "application/json, text/plain, */*",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, resp.status, resp.read(512).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as he:
        try:
            err_body = he.read(1024).decode("utf-8", errors="replace")
        except Exception:
            err_body = ""
        return False, he.code, err_body or str(he)
    except Exception as e:
        return False, 0, f"{type(e).__name__}: {e}"


def _broadcast_to_bridges(msg: ChatMessage, db: Session) -> None:
    """POST the new message to every enabled outgoing bridge — in a background
    thread so the user's request returns immediately. External-origin messages
    are skipped (loop prevention) by checking ``msg.external_source``."""
    if msg.external_source:
        return
    if msg.is_system or msg.is_cross_posted:
        # System notices / cross-posts: don't forward (would be noise).
        return

    bridges = (
        db.query(CommunityBridge)
        .filter(CommunityBridge.enabled == True,
                CommunityBridge.outgoing_url.isnot(None))
        .all()
    )
    if not bridges:
        print(f"[bridge] no enabled outgoing bridges for msg #{msg.id}", flush=True)
        return
    print(f"[bridge] broadcasting msg #{msg.id} to {len(bridges)} bridge(s): "
          f"{[b.name for b in bridges]}", flush=True)

    author = msg.author_name
    text   = msg.body or ""

    def _run():
        for b in bridges:
            payload = _bridge_payload(b.source_type, author, text)
            ok, status, body = _post_bridge(b.outgoing_url, payload)
            if ok:
                print(f"[bridge:{b.source_type}] POST {b.outgoing_url} → {status} {body[:80]}", flush=True)
            else:
                print(f"[bridge:{b.source_type}] POST {b.outgoing_url} failed ({status}): {body[:120]}", flush=True)

    threading.Thread(target=_run, daemon=True).start()


# ── Bridge CRUD (manager only) ────────────────────────────────────────────────

@router.get("/community/bridges", response_model=list[CommunityBridgeOut])
def list_bridges(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    base = f"{request.url.scheme}://{request.url.netloc}"
    rows = db.query(CommunityBridge).order_by(CommunityBridge.created_at.desc()).all()
    return [_bridge_to_out(b, base) for b in rows]


@router.post("/community/bridges", response_model=CommunityBridgeOut, status_code=201)
def create_bridge(
    payload: CommunityBridgeCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    if payload.source_type not in ("dooray", "discord", "slack"):
        raise HTTPException(400, "source_type must be 'dooray', 'discord', or 'slack'")
    b = CommunityBridge(
        name=(payload.name or "").strip() or payload.source_type,
        source_type=payload.source_type,
        outgoing_url=(payload.outgoing_url or "").strip() or None,
        incoming_token=_secrets.token_urlsafe(24) if payload.enable_incoming else None,
        enabled=payload.enabled,
        created_by=current_user.username,
    )
    db.add(b); db.commit(); db.refresh(b)
    base = f"{request.url.scheme}://{request.url.netloc}"
    return _bridge_to_out(b, base)


@router.put("/community/bridges/{bid}", response_model=CommunityBridgeOut)
def update_bridge(
    bid: int,
    payload: CommunityBridgeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    b = db.query(CommunityBridge).filter(CommunityBridge.id == bid).first()
    if not b:
        raise HTTPException(404, "Bridge not found")
    if payload.name is not None:         b.name = payload.name.strip() or b.name
    if payload.outgoing_url is not None: b.outgoing_url = payload.outgoing_url.strip() or None
    if payload.enabled is not None:      b.enabled = payload.enabled
    if payload.bot_token is not None:    b.bot_token = payload.bot_token.strip() or None
    if payload.enable_incoming is True and not b.incoming_token:
        b.incoming_token = _secrets.token_urlsafe(24)
    if payload.enable_incoming is False:
        b.incoming_token = None
    if payload.rotate_token and b.incoming_token:
        b.incoming_token = _secrets.token_urlsafe(24)
    db.commit(); db.refresh(b)
    base = f"{request.url.scheme}://{request.url.netloc}"
    return _bridge_to_out(b, base)


@router.delete("/community/bridges/{bid}", status_code=204)
def delete_bridge(
    bid: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    b = db.query(CommunityBridge).filter(CommunityBridge.id == bid).first()
    if not b:
        raise HTTPException(404, "Bridge not found")
    db.delete(b); db.commit()


@router.post("/community/bridges/{bid}/test-outgoing")
def test_bridge_outgoing(
    bid: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    """Synchronously POST a test message to this bridge's outgoing URL and
    return the result, so the manager can see *exactly* what happened
    (status code, response body, network error) instead of guessing."""
    b = db.query(CommunityBridge).filter(CommunityBridge.id == bid).first()
    if not b:
        raise HTTPException(404, "Bridge not found")
    if not b.outgoing_url:
        raise HTTPException(400, "This bridge has no outgoing_url configured")

    author = current_user.username
    text   = f"🔧 lilak elog bridge test — {b.name}"
    # Same payload + POST path as real broadcasts, so the test result is
    # representative.
    payload = _bridge_payload(b.source_type, author, text)
    ok, status_code, body = _post_bridge(b.outgoing_url, payload, timeout=10)
    if ok:
        return {"ok": True, "status": status_code, "response": body}
    return {"ok": False, "status": status_code, "error": body}


# ── Managed Discord relay subprocess ──────────────────────────────────────────

def _build_incoming_url(b: CommunityBridge, request: Request) -> Optional[str]:
    if not b.incoming_token:
        return None
    base = f"{request.url.scheme}://{request.url.netloc}"
    return f"{base}/api/community/incoming/{b.incoming_token}"


@router.post("/community/bridges/{bid}/relay/start")
def start_relay(
    bid: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    from services.relay_manager import start as _start
    b = db.query(CommunityBridge).filter(CommunityBridge.id == bid).first()
    if not b:
        raise HTTPException(404, "Bridge not found")
    if b.source_type != "discord":
        raise HTTPException(400, "Managed relay is currently only for Discord bridges")
    if not b.bot_token:
        raise HTTPException(400, "Set a bot token before starting the relay")
    incoming_url = _build_incoming_url(b, request)
    if not incoming_url:
        raise HTTPException(400, "Enable Incoming and generate a token first")
    return _start(b.id, b.bot_token, incoming_url)


@router.post("/community/bridges/{bid}/relay/stop")
def stop_relay(
    bid: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager),
):
    from services.relay_manager import stop as _stop
    b = db.query(CommunityBridge).filter(CommunityBridge.id == bid).first()
    if not b:
        raise HTTPException(404, "Bridge not found")
    return _stop(b.id)


# ── Incoming webhook (external → us) ──────────────────────────────────────────

@router.post("/community/incoming/{token}")
async def receive_incoming(token: str, request: Request, db: Session = Depends(get_db)):
    """Public endpoint: an external service POSTs here.
    The token in the URL is the bridge's incoming_token (manager-issued).

    Accepts JSON (Discord, Slack Events API, Dooray) or form-urlencoded
    (Slack legacy outgoing webhooks)."""
    b = (
        db.query(CommunityBridge)
        .filter(CommunityBridge.incoming_token == token,
                CommunityBridge.enabled == True)
        .first()
    )
    if not b:
        raise HTTPException(404, "Unknown bridge")

    # Try JSON first, fall back to form-urlencoded
    try:
        payload = await request.json()
    except Exception:
        payload = {}
        try:
            form = await request.form()
            payload = dict(form)
        except Exception:
            pass
    # A valid-JSON non-object body (array/string/number) must not 500 —
    # senders like Slack retry on non-2xx. Treat it as an empty payload.
    if not isinstance(payload, dict):
        payload = {}

    # ── Slack Events API URL verification handshake ──
    # When you first save the request URL in Slack's app config, Slack POSTs
    # { "type": "url_verification", "challenge": "..." } and expects the
    # challenge echoed back as plain text.
    if b.source_type == "slack" and isinstance(payload, dict) and payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge", "")}

    # ── Slack bot/self echo suppression ──
    # When our outgoing-webhook message hits the channel, Slack re-fires its
    # subscribed events for that same message. Skip messages authored by
    # any bot to avoid bouncing them back as fresh chat lines.
    if b.source_type == "slack":
        evt = payload.get("event") if isinstance(payload, dict) else None
        if isinstance(evt, dict):
            if evt.get("bot_id") or evt.get("subtype") == "bot_message":
                return {"skipped": "bot echo"}
        # Legacy outgoing webhooks include `user_name=slackbot` for bot posts
        if (payload.get("user_name") or "").lower() == "slackbot":
            return {"skipped": "slackbot"}

    author, text = _parse_incoming(b.source_type, payload)
    if not text or not author:
        # Slack will retry on non-2xx; respond 200 with a note so it stops.
        return {"skipped": "no body"}

    msg = ChatMessage(
        author_id=None,
        author_name=author,
        body=text,
        external_source=b.source_type,
        external_author=author,
        is_cross_posted=False,
        is_system=False,
    )
    db.add(msg); db.commit(); db.refresh(msg)
    return {"id": msg.id}


def _parse_incoming(source_type: str, payload: dict) -> tuple[str, str]:
    """Best-effort extraction of (author, text) per provider."""
    if source_type == "discord":
        # Discord outgoing webhooks: { content, username, channel_id, ... }
        author = (payload.get("username")
                  or (payload.get("author") or {}).get("username")
                  or payload.get("user_name")
                  or "discord")
        text = (payload.get("content")
                or payload.get("text")
                or "")
    elif source_type == "slack":
        # Slack supports two shapes:
        #   • Legacy outgoing webhooks → form-urlencoded
        #     { user_name, text, channel_name, trigger_word, ... }
        #   • Events API → JSON {type, event: {user|user_id, text, ...}}
        event = payload.get("event") if isinstance(payload.get("event"), dict) else None
        if event:
            author = (event.get("user_name")
                      or event.get("user")
                      or "slack")
            text = event.get("text") or ""
        else:
            author = (payload.get("user_name")
                      or payload.get("username")
                      or payload.get("user")
                      or "slack")
            text = (payload.get("text")
                    or payload.get("content")
                    or "")
    else:
        # Dooray outgoing hook: { text, userName, channelName, ... }
        author = (payload.get("userName")
                  or payload.get("username")
                  or (payload.get("user") or {}).get("name")
                  or "dooray")
        text = (payload.get("text")
                or payload.get("content")
                or "")
    return str(author).strip(), str(text).strip()
