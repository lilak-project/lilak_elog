"""
Authentication utilities — intentionally isolated.

PASSWORD RULES
--------------
- 모든 문자 허용
- 최소 4자
hash_password() / verify_password() 만 교체하면 bcrypt/LDAP 등으로 업그레이드 가능.

USERNAME RULES
--------------
- 영문자(a-z, A-Z), 숫자(0-9), -(하이픈), _(언더스코어) 허용
- 최소 3자, 최대 32자
"""

import hashlib
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

import models
from database import get_db

# ── Configuration ──────────────────────────────────────────────────────────
# Prefer PORTAL_SECRET_KEY (the portal signs tokens with it), then ELOG_SECRET_KEY,
# then the shared dev default. Matches config.py in the portal and every other
# service — without this, a deployment that sets only PORTAL_SECRET_KEY would leave
# elog verifying portal tokens against the PUBLIC dev default (forgeable manager
# tokens). Keep both in sync; they must resolve to the same value in production.
def _resolve_secret_key() -> tuple:
    """The JWT signing key, and where it came from.

    This must resolve to the SAME value the portal reaches, or a portal token is
    rejected here and one password stops working in two places. It used to fall
    back to a constant printed in the source, which made that failure invisible:
    started without the variable, this service ran a whole day on the public dev
    key while the portal signed with the real one — the log said only
    "token=yes, claims=no". Worse, had the portal lost the variable too they
    would have AGREED, on a key anyone can read.

    Delivery by environment inheritance was the root of it: whoever spawned the
    process decided whether auth worked. So the key is a property of the shared
    data root instead, in the same order service_manager/app/config.py uses:
    an explicit variable, else `<PORTAL_DATA_ROOT>/_portal/secret.key`, else that
    file is created. Keep the two in step.

    Standalone (no portal data root) falls back to this experiment's own data
    directory: there is no portal to agree with, so a private persistent key is
    right — and portal tokens then simply do not verify, which is the truth.
    """
    for var in ("PORTAL_SECRET_KEY", "ELOG_SECRET_KEY"):
        val = os.environ.get(var)
        if val:
            return val, f"env:{var}"

    root = os.environ.get("PORTAL_DATA_ROOT")
    if root:
        path = os.path.join(root, "_portal", "secret.key")
    else:
        from database import DATA_DIR
        path = os.path.join(DATA_DIR, "secret.key")
    try:
        if os.path.exists(path):
            with open(path) as fh:
                val = fh.read().strip()
            if val:
                return val, f"file:{path}"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        val = secrets.token_urlsafe(48)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(val + "\n")
        return val, f"generated:{path}"
    except FileExistsError:
        with open(path) as fh:
            return fh.read().strip(), f"file:{path}"
    except OSError as err:
        raise RuntimeError(
            f"cannot read or create the JWT signing key at {path}: {err}. "
            f"Set ELOG_SECRET_KEY, or make the data directory writable."
        ) from err


SECRET_KEY, SECRET_KEY_SOURCE = _resolve_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS: int = int(os.environ.get("ELOG_TOKEN_EXPIRE_HOURS", "24"))

# ── Portal introspection ─────────────────────────────────────────────────────
# The portal mints tokens at login, so a later role change wouldn't reach elog,
# which used to copy `role` only when it first provisioned the local mirror — a
# portal demotion then never propagated (the mirror stayed manager forever). Ask
# the portal's /api/introspect for the LIVE role/profile on entry (cached briefly),
# falling back to the token claims when the portal is unreachable. Same canonical
# mechanism nptoy/g4toy use.
_PORTAL_PORT = os.environ.get("PORTAL_PORT")
_INTROSPECT_TTL = 20                            # seconds; caps portal calls per token
_introspect_cache: dict = {}                    # token -> (expiry_monotonic, fresh)


def _introspect(token: Optional[str]) -> Optional[dict]:
    if not token or not _PORTAL_PORT:
        return None
    now = time.monotonic()
    hit = _introspect_cache.get(token)
    if hit and hit[0] > now:
        return hit[1]
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{_PORTAL_PORT}/api/introspect",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=2) as r:
            fresh = json.loads(r.read())
    except Exception:
        return None
    if len(_introspect_cache) > 512:            # bound the map (tokens rotate daily)
        for k, (exp, _) in list(_introspect_cache.items()):
            if exp <= now:
                _introspect_cache.pop(k, None)
    _introspect_cache[token] = (now + _INTROSPECT_TTL, fresh)
    return fresh

def portal_login(username: str, password: str) -> Optional[str]:
    """Ask the PORTAL to check these credentials; return its token, or None.

    This is what lets one password work in both places without there being two of
    them. The portal stays the only store — nothing is copied here, and a password
    change there takes effect immediately.

    It exists because a portal-provisioned account has no local password at all
    (`password_hash == PORTAL_PROVISIONED_HASH`, set when SSO adopts an account so
    a seeded credential stops being a second way in). Entering through a portal
    card hands over a token and never shows a login form — but a bookmark straight
    to /pp/<svc>/<proj>/ does, and there was no password on earth that would work
    on it. Now that form authenticates against the portal.

    Loopback only, like _introspect: the portal is on this host and this must not
    become a way to point elog at some other authenticator.
    """
    if not username or not password or not _PORTAL_PORT:
        return None
    body = json.dumps({"username": username, "password": password}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{_PORTAL_PORT}/api/auth/login",
        data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
    except Exception:
        # Wrong password, portal down, verification pending — all the same here:
        # no token, so the caller falls through to its own 401.
        return None
    token = data.get("access_token")
    return token if isinstance(token, str) and token else None


# ── Validation rules ────────────────────────────────────────────────────────
_USERNAME_RE = re.compile(r'^[A-Za-z0-9_-]{3,32}$')


def validate_username(username: str) -> str:
    """영문/숫자/-/_ 3~32자. 통과하면 그대로 반환, 아니면 ValueError."""
    if not _USERNAME_RE.match(username):
        raise ValueError("아이디는 영문자, 숫자, -, _만 사용할 수 있으며 3~32자여야 합니다.")
    return username


def validate_password(password: str) -> str:
    """4자 이상 (모든 문자 허용). 통과하면 그대로 반환, 아니면 ValueError."""
    if len(password) < 4:
        raise ValueError("비밀번호는 4자 이상이어야 합니다.")
    return password


# ── Password hashing (REPLACE FOR PRODUCTION) ──────────────────────────────

def hash_password(password: str) -> str:
    """Return 'sha256:<hex-salt>:<hex-digest>'."""
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return f"sha256:{salt}:{digest}"


def verify_password(plain: str, stored: str) -> bool:
    """Constant-time comparison against stored hash."""
    try:
        scheme, salt, digest = stored.split(":", 2)
        if scheme == "sha256":
            computed = hashlib.sha256(f"{salt}:{plain}".encode()).hexdigest()
            return secrets.compare_digest(computed, digest)
    except Exception:
        pass
    return False


# ── JWT helpers ─────────────────────────────────────────────────────────────

def create_access_token(user_id: int, username: str, role: str,
                        extra: Optional[dict] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expire,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ── FastAPI dependency helpers ───────────────────────────────────────────────

def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


# Placeholder hash for users provisioned from a portal account — it never
# matches verify_password(), so they can't password-login locally (they always
# arrive carrying a portal token).
PORTAL_PROVISIONED_HASH = "portal"


def _sync_linked(db: Session, user: models.User, src: dict, role: str,
                 adopt: bool = False, email: Optional[str] = None) -> models.User:
    """Keep a linked elog user in sync with the portal on EVERY entry: avatar +
    display name AND role (a portal promote/demote propagates; local role edits for a
    portal-linked user are transient by design). elog-local fields (phone /
    experiment_role / participation) are left alone.

    `adopt` marks a local account as taken over by the portal identity: it also
    retires the local password, so a seeded credential (elog plants `admin`/1757 in
    every new project) stops being a second way in and entry becomes portal-only.
    `email` backfills an address the local row never had, so the next entry resolves
    on the normal email path instead of coming back through the username fallback."""
    changed = not getattr(user, "portal_linked", False)
    if changed:
        user.portal_linked = True
    if adopt and user.password_hash != PORTAL_PROVISIONED_HASH:
        user.password_hash = PORTAL_PROVISIONED_HASH
        changed = True
    if email and not user.email:
        user.email = email
        changed = True
    for attr, val in (("display_name", src.get("name")),
                      ("profile_color", src.get("color")),
                      ("profile_shape", src.get("shape")),
                      ("role", role)):
        if val is not None and getattr(user, attr, None) != val:
            setattr(user, attr, val)
            changed = True
    if changed:
        db.commit()
    return user


def _resolve_portal_user(payload: dict, db: Session, token: Optional[str] = None) -> Optional[models.User]:
    """A portal token authenticates against THIS service's user table, by email when
    there is one and by username when there is not.

    - portal-provisioned / already-linked local user with the same email → link in.
    - an INDEPENDENT local user (its own password) with the same email not yet
      linked → DON'T silently take it over: raise 409 PORTAL_LINK_REQUIRED so the
      user confirms ownership once (POST /api/auth/portal-link with the local
      password). Afterwards it's linked and entry is seamless.
    - no email match, but a local user with the SAME USERNAME and no email of its
      own → adopt it (see the fallback below).
    - nothing matched → provision a fresh local user mirroring the portal account.
    """
    # Overlay the LIVE portal identity (fresh role/profile from /api/introspect) on
    # the token claims, so a portal role change propagates on the NEXT entry instead
    # of being frozen at provisioning time. Falls back to the claims if the portal
    # is unreachable (role then tracks the ≤24 h-old token, not "forever").
    src = {**(payload or {}), **(_introspect(token) or {})}
    role = src.get("role") or src.get("prole") or "user"
    email = src.get("email")
    if email:
        user = db.query(models.User).filter(models.User.email == email).first()
        if user is not None:
            if not user.is_active:
                return None
            linked = bool(getattr(user, "portal_linked", False)) or user.password_hash == PORTAL_PROVISIONED_HASH
            if not linked:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail={"code": "PORTAL_LINK_REQUIRED", "email": email,
                                            "username": user.username})
            # The portal is the source of truth for the SHARED identity.
            return _sync_linked(db, user, src, role)

    # ── username fallback ─────────────────────────────────────────────────────
    # The email did not resolve: either the portal account has no email at all (a
    # deployment running EMAIL_VERIFY_REQUIRED=0) or it carries one this service has
    # never seen. Match on the username instead, GUARDED to a local account with no
    # email of its own — an account that has an email is reachable by the normal path
    # and keeps its 409 confirm-ownership step, so this can never quietly swallow an
    # identity that had another way in. The portal still dictates the role, so an
    # adopted account confers no privilege its portal owner lacks.
    uname = src.get("username")
    local = (db.query(models.User).filter(models.User.username == uname).first()
             if uname else None)
    if local is not None and not local.email:
        if not local.is_active:
            return None
        return _sync_linked(db, local, src, role, adopt=True, email=email)

    # Nothing matched → provision a fresh local user from the portal claims.
    base = uname or (email.split("@")[0] if email else "user")
    uname = base
    if db.query(models.User).filter(models.User.username == uname).first():
        uname = f"{base}_{src.get('sub', payload.get('sub', 'p'))}"
        # Idempotence: an earlier entry may already have provisioned this exact name.
        # Re-using it instead of INSERTing again is what stops a repeat visit from
        # dying on UNIQUE(users.username) — the failure that turned every
        # authenticated request into a 500 for an emailless account.
        prior = db.query(models.User).filter(models.User.username == uname).first()
        if prior is not None:
            return _sync_linked(db, prior, src, role, email=email) if prior.is_active else None
    user = models.User(
        username=uname,
        display_name=src.get("name") or uname,
        email=email,
        role=role,
        profile_color=src.get("color"),
        profile_shape=src.get("shape"),
        # rest of the elog profile, mirrored from the portal account (superset)
        phone=src.get("phone"),
        experiment_role=src.get("erole"),
        participation_from=src.get("pfrom"),
        participation_to=src.get("pto"),
        is_active=True,
        portal_linked=True,
        password_hash=PORTAL_PROVISIONED_HASH,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_current_user_optional(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    token = _extract_bearer(authorization)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    # A portal token carries `portal: true` + the account's email; resolve it to
    # a local user (link by email / auto-provision) instead of by local id.
    if payload.get("portal"):
        return _resolve_portal_user(payload, db, token)
    user = db.query(models.User).filter(
        models.User.id == int(payload["sub"]),
        models.User.is_active == True,
    ).first()
    return user


def require_auth(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    user = get_current_user_optional(authorization, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")
    return user


def require_manager(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    user = require_auth(authorization, db)
    if user.role != "manager":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="매니저 권한이 필요합니다.")
    return user


def get_api_token_source(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[models.ApiToken]:
    token_str = _extract_bearer(authorization)
    if not token_str:
        return None
    api_token = db.query(models.ApiToken).filter(
        models.ApiToken.token == token_str,
        models.ApiToken.is_active == True,
    ).first()
    if api_token:
        api_token.last_used_at = datetime.utcnow()
        db.commit()
    return api_token
