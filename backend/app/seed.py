from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy.orm import Session

from .auth import hash_password
from .models import Settings, User
from .schemas import SiteSettings, SysSettings


def seed_if_empty(db: Session) -> None:
    """仅在空库时写入管理员与默认站点设置。"""
    if not db.query(User).filter(User.username == "admin").first():
        db.add(
            User(
                id="u_admin",
                username="admin",
                password_hash=hash_password("admin123"),
                role="admin",
                disabled=False,
                created_at=datetime.utcnow(),
            )
        )
        db.commit()

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
