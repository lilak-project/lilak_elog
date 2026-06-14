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
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

import models
from database import get_db

# ── Configuration ──────────────────────────────────────────────────────────
SECRET_KEY: str = os.environ.get("ELOG_SECRET_KEY", "lilak-dev-secret-CHANGE-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS: int = int(os.environ.get("ELOG_TOKEN_EXPIRE_HOURS", "24"))

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

def create_access_token(user_id: int, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expire,
    }
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
