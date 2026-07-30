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
        "desc": "## 产品说明\n\n正版软件年卡，**一码一用**。付款后自动发放激活码，支持一键复制。\n\n### 你将获得\n\n- 12 个月正式授权\n- 自动发货，即时到账\n- 订单页随时可查\n\n> 适用于个人学习与工作室场景。",
        "cover": "p1",
        "status": "on",
        "tag": "KEY · AUTO",
    },
    {
        "id": "ui-kit",
        "name": "UI 组件库源文件",
        "type": "file",
        "price": 89,
        "desc": "## 包含内容\n\nFigma 源文件 + 导出切图打包，覆盖常用后台与营销页组件。\n\n### 交付方式\n\n- 付款后解锁 ZIP 下载\n- 下载链接绑定买家账号\n- 支持在「我的订单」重复下载\n\n### 适用对象\n\n设计师、前端与独立开发者快速搭建界面原型。",
        "cover": "p2",
        "status": "on",
        "tag": "FILE · ZIP",
    },
    {
        "id": "stream-gift",
        "name": "流媒体季卡兑换码",
        "type": "code",
        "price": 68,
        "desc": "## 兑换说明\n\n平台官方兑换码，库存实时核销。发货后可在订单页随时查看。\n\n- 季卡时长以平台规则为准\n- 一码一用，核销后失效\n- 自动发货，无需等待客服",
        "cover": "p3",
        "status": "on",
        "tag": "CODE · REDEEM",
    },
    {
        "id": "vpn-month",
        "name": "加速节点月卡",
        "type": "key",
        "price": 36,
        "desc": "## 使用方式\n\n订阅密钥自动下发，复制到客户端即可使用，到期自动失效。\n\n1. 完成付款\n2. 复制密钥\n3. 粘贴至客户端完成订阅",
        "cover": "p4",
        "status": "on",
        "tag": "KEY · 30D",
    },
    {
        "id": "preset-pack",
        "name": "摄影调色预设包",
        "type": "file",
        "price": 49,
        "desc": "## 资源清单\n\n含 **40 组** Lightroom 预设与说明文档，付款后即时下载。\n\n- 人像 / 风光 / 街拍风格\n- 附简要导入说明\n- ZIP 打包交付",
        "cover": "p5",
        "status": "on",
        "tag": "FILE · DNG",
    },
    {
        "id": "game-topup",
        "name": "游戏点数充值码",
        "type": "code",
        "price": 98,
        "desc": "## 充值码说明\n\n面值点数兑换码，库存锁定发货，避免超卖与重复核销。\n\n付款成功后即可在订单中复制兑换。",
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
