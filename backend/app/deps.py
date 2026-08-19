from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .auth import decode_access_token
from .database import get_db
from .models import User

security = HTTPBearer(auto_error=False)


def _resolve_user(creds: Optional[HTTPAuthorizationCredentials], db: Session) -> Optional[User]:
    if not creds:
        return None
    payload = decode_access_token(creds.credentials)
    if not payload:
        return None
    user = db.query(User).filter(User.username == payload["sub"]).first()
    if not user or user.disabled:
        return None
    # 改密 / 重置密码后旧令牌立即失效
    if int(payload.get("tv") or 0) != int(user.token_version or 0):
        return None
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    user = _resolve_user(creds, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效，请重新登录")
    return user


def get_optional_user(
    creds: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """公开接口按需识别身份，未登录返回 None。"""
    return _resolve_user(creds, db)


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可操作")
    return user
