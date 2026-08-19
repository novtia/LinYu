from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

logger = logging.getLogger("lingxia.auth")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
MIN_SECRET_LENGTH = 24

_env_secret = (os.getenv("JWT_SECRET") or "").strip()
# 没有配置密钥时使用进程内随机值：重启后登录态失效，但不会退化成公开的固定密钥。
SECRET_IS_EPHEMERAL = not _env_secret
SECRET_KEY = _env_secret or secrets.token_urlsafe(48)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def check_secret_config() -> None:
    """启动自检：生产环境未配置 JWT_SECRET 直接拒绝启动。"""
    if not SECRET_IS_EPHEMERAL:
        if len(SECRET_KEY) < MIN_SECRET_LENGTH:
            logger.warning(
                "JWT_SECRET 长度不足 %d 位，建议替换为更长的随机串", MIN_SECRET_LENGTH
            )
        return
    if (os.getenv("LINGXIA_ENV") or "").strip().lower() in ("prod", "production"):
        raise RuntimeError("生产环境必须通过环境变量设置 JWT_SECRET")
    logger.warning("未设置 JWT_SECRET，已启用进程随机密钥，服务重启后所有登录态将失效")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def generate_password(length: int = 12) -> str:
    """生成便于人工转达的随机密码（去除易混淆字符）。"""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_access_token(subject: str, *, token_version: int = 0) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": subject, "tv": int(token_version or 0), "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """校验签名与有效期，返回 payload；失败返回 None。"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if not payload.get("sub"):
        return None
    return payload
