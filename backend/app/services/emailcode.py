from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import EmailCode
from .delivery import random_id

CODE_TTL_MINUTES = 15
COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5


def generate_code(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))


def in_cooldown(db: Session, email: str, purpose: str) -> bool:
    cut = datetime.utcnow() - timedelta(seconds=COOLDOWN_SECONDS)
    return bool(
        db.query(EmailCode)
        .filter(
            EmailCode.email == email,
            EmailCode.purpose == purpose,
            EmailCode.created_at >= cut,
        )
        .first()
    )


def issue_code(db: Session, email: str, purpose: str) -> str:
    """签发新验证码，同时作废该用途下的历史验证码。"""
    db.query(EmailCode).filter(
        EmailCode.email == email,
        EmailCode.purpose == purpose,
        EmailCode.used.is_(False),
    ).update({EmailCode.used: True})

    code = generate_code()
    db.add(
        EmailCode(
            id="ec_" + random_id(),
            email=email,
            purpose=purpose,
            code=code,
            created_at=datetime.utcnow(),
            used=False,
            attempts=0,
        )
    )
    db.commit()
    return code


def consume_code(db: Session, email: str, purpose: str, code: str) -> bool:
    """校验验证码；错误累计到上限即作废，防止 6 位数字被枚举。"""
    cutoff = datetime.utcnow() - timedelta(minutes=CODE_TTL_MINUTES)
    row = (
        db.query(EmailCode)
        .filter(
            EmailCode.email == email,
            EmailCode.purpose == purpose,
            EmailCode.used.is_(False),
            EmailCode.created_at >= cutoff,
        )
        .order_by(EmailCode.created_at.desc())
        .first()
    )
    if not row:
        return False

    if (row.attempts or 0) >= MAX_ATTEMPTS:
        row.used = True
        db.commit()
        return False

    if not secrets.compare_digest(row.code, (code or "").strip()):
        row.attempts = (row.attempts or 0) + 1
        if row.attempts >= MAX_ATTEMPTS:
            row.used = True
        db.commit()
        return False

    row.used = True
    db.commit()
    return True
