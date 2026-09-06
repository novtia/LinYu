from __future__ import annotations

import json
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

from .auth import generate_password, hash_password
from .models import Settings, User
from .schemas import SiteSettings, SysSettings

logger = logging.getLogger("lingxia.seed")


def seed_if_empty(db: Session) -> None:
    """仅在空库时写入管理员与默认站点设置。"""
    has_bootstrap_admin = (
        db.query(User).filter(User.id == "u_admin").first()
        or db.query(User).filter(User.username == "admin").first()
    )
    if not has_bootstrap_admin:
        password = (os.getenv("ADMIN_INITIAL_PASSWORD") or "").strip()
        generated = not password
        if generated:
            password = generate_password()
        db.add(
            User(
                id="u_admin",
                username="admin",
                password_hash=hash_password(password),
                role="admin",
                disabled=False,
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
        if generated:
            logger.warning(
                "已创建管理员 admin，初始密码：%s （仅本次输出，请立即登录修改）", password
            )
        else:
            logger.warning("已创建管理员 admin，初始密码取自 ADMIN_INITIAL_PASSWORD，请尽快修改")

    if not db.query(Settings).filter(Settings.id == 1).first():
        sys = SysSettings()
        site = SiteSettings()
        db.add(
            Settings(
                id=1,
                pay_json="{}",
                sys_json=sys.model_dump_json(),
                site_json=site.model_dump_json(),
            )
        )
        db.commit()


def load_settings(db: Session) -> dict:
    row = db.query(Settings).filter(Settings.id == 1).first()
    if not row:
        seed_if_empty(db)
        row = db.query(Settings).filter(Settings.id == 1).first()
    return {
        "sys": SysSettings(**json.loads(row.sys_json or "{}")),
        "site": SiteSettings(**json.loads(row.site_json or "{}")),
    }


def save_settings(db: Session, sys=None, site=None) -> dict:
    row = db.query(Settings).filter(Settings.id == 1).first()
    if not row:
        seed_if_empty(db)
        row = db.query(Settings).filter(Settings.id == 1).first()
    current = load_settings(db)
    if sys is not None:
        current["sys"] = sys
        row.sys_json = sys.model_dump_json()
    if site is not None:
        current["site"] = site
        row.site_json = site.model_dump_json()
    db.commit()
    return current
