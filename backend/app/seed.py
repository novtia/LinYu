from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy.orm import Session

from .auth import hash_password
from .models import Product, Settings, User
from .schemas import PaySettings, SiteSettings, SysSettings
from .services.files import create_demo_zip


DEFAULT_PRODUCTS = [
    {
        "id": "pro-suite",
        "name": "Pro Suite 年卡激活码",
        "type": "key",
        "price": 129,
        "desc": "正版软件年卡，一码一用。付款后自动发放至领取匣，支持一键复制。",
        "cover": "p1",
        "status": "on",
        "tag": "KEY · AUTO",
    },
    {
        "id": "ui-kit",
        "name": "UI 组件库源文件",
        "type": "file",
        "price": 89,
        "desc": "Figma + 导出切图打包。下单后生成 24 小时有效下载链接。",
        "cover": "p2",
        "status": "on",
        "tag": "FILE · ZIP",
    },
    {
        "id": "stream-gift",
        "name": "流媒体季卡兑换码",
        "type": "code",
        "price": 68,
        "desc": "平台官方兑换码，库存实时核销。发货后可在订单页随时查看。",
        "cover": "p3",
        "status": "on",
        "tag": "CODE · REDEEM",
    },
    {
        "id": "vpn-month",
        "name": "加速节点月卡",
        "type": "key",
        "price": 36,
        "desc": "订阅密钥自动下发，复制到客户端即可使用，到期自动失效。",
        "cover": "p4",
        "status": "on",
        "tag": "KEY · 30D",
    },
    {
        "id": "preset-pack",
        "name": "摄影调色预设包",
        "type": "file",
        "price": 49,
        "desc": "含 40 组 Lightroom 预设与说明文档，付款后即时下载。",
        "cover": "p5",
        "status": "on",
        "tag": "FILE · DNG",
    },
    {
        "id": "game-topup",
        "name": "游戏点数充值码",
        "type": "code",
        "price": 98,
        "desc": "面值点数兑换码，库存锁定发货，避免超卖与重复核销。",
        "cover": "p6",
        "status": "on",
        "tag": "CODE · GAME",
    },
]

DEMO_FILES = {
    "ui-kit": ("ui-kit-demo.zip", "领匣演示：UI 组件库源文件包"),
    "preset-pack": ("preset-pack-demo.zip", "领匣演示：摄影调色预设包"),
}


def _attach_demo_files(db: Session) -> None:
    for pid, (fname, note) in DEMO_FILES.items():
        product = db.query(Product).filter(Product.id == pid).first()
        if product and not product.file_path:
            stored, original = create_demo_zip(pid, fname, note)
            product.file_path = stored
            product.file_name = original
    db.commit()


def seed_if_empty(db: Session) -> None:
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

    if db.query(Product).count() == 0:
        for p in DEFAULT_PRODUCTS:
            db.add(Product(**p))
        db.commit()

    if not db.query(Settings).filter(Settings.id == 1).first():
        pay = PaySettings()
        sys = SysSettings()
        site = SiteSettings()
        db.add(
            Settings(
                id=1,
                pay_json=pay.model_dump_json(),
                sys_json=sys.model_dump_json(),
                site_json=site.model_dump_json(),
            )
        )
        db.commit()

    _attach_demo_files(db)

def load_settings(db: Session) -> dict:
    row = db.query(Settings).filter(Settings.id == 1).first()
    if not row:
        seed_if_empty(db)
        row = db.query(Settings).filter(Settings.id == 1).first()
    return {
        "pay": PaySettings(**json.loads(row.pay_json)),
        "sys": SysSettings(**json.loads(row.sys_json)),
        "site": SiteSettings(**json.loads(row.site_json)),
    }


def save_settings(db: Session, pay=None, sys=None, site=None) -> dict:
    row = db.query(Settings).filter(Settings.id == 1).first()
    if not row:
        seed_if_empty(db)
        row = db.query(Settings).filter(Settings.id == 1).first()
    current = load_settings(db)
    if pay is not None:
        current["pay"] = pay
        row.pay_json = pay.model_dump_json()
    if sys is not None:
        current["sys"] = sys
        row.sys_json = sys.model_dump_json()
    if site is not None:
        current["site"] = site
        row.site_json = site.model_dump_json()
    db.commit()
    return current
