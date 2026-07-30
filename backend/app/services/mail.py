from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from ..models import Order, User
from ..schemas import MailSettings
from ..seed import load_settings

logger = logging.getLogger(__name__)

AOKSEND_URL = "https://apiv2.aoksend.com/index/api/send_email"
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_valid_email(email: str) -> bool:
    return bool(email and EMAIL_RE.match(email.strip()))


def get_mail_settings(db: Session) -> MailSettings:
    return load_settings(db)["sys"].mail


def send_aoksend(
    mail: MailSettings,
    *,
    to: str,
    template_id: str,
    data: Optional[Dict[str, Any]] = None,
    reply_to: Optional[str] = None,
) -> None:
    """Call AokSend API v2. Raises ValueError on failure."""
    if not mail.enabled:
        raise ValueError("邮件服务未启用")
    if not mail.app_key.strip():
        raise ValueError("未配置 AokSend app_key")
    if not template_id.strip():
        raise ValueError("未配置邮件模板 ID")
    to = to.strip()
    if not is_valid_email(to):
        raise ValueError("收件人邮箱格式不正确")

    payload: Dict[str, Any] = {
        "app_key": mail.app_key.strip(),
        "template_id": template_id.strip(),
        "to": to,
    }
    alias = (mail.alias or "").strip()
    if alias:
        payload["alias"] = alias
    rt = (reply_to or mail.reply_to or "").strip()
    if rt:
        payload["reply_to"] = rt
    if data:
        payload["data"] = json.dumps(data, ensure_ascii=False)

    body = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        AOKSEND_URL,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
        raise ValueError(f"AokSend HTTP {e.code}: {detail[:200]}") from e
    except Exception as e:
        raise ValueError(f"邮件发送失败：{e}") from e

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"AokSend 返回异常：{raw[:200]}") from e

    code = result.get("code")
    if code != 200:
        raise ValueError(result.get("message") or f"AokSend 错误码 {code}")


def _safe_send(mail: MailSettings, **kwargs) -> bool:
    try:
        send_aoksend(mail, **kwargs)
        return True
    except Exception as e:
        logger.warning("mail send failed: %s", e)
        return False


def notify_order_emails(db: Session, order: Order) -> None:
    """Send buyer delivery mail + admin order notice after fulfill (best-effort)."""
    mail = get_mail_settings(db)
    if not mail.enabled:
        return

    settings = load_settings(db)
    site_name = settings["sys"].name or "领匣"
    products = "、".join(it.name for it in order.items) or "—"
    delivery_parts = []
    for d in order.deliveries:
        delivery_parts.append(f"【{d.product_name}】\n{d.payload}")
    delivery_content = "\n\n".join(delivery_parts) if delivery_parts else "请登录站点在订单中查看"

    # A: buyer
    user = db.query(User).filter(User.id == order.user_id).first()
    buyer_email = (user.email or "").strip() if user else ""
    if buyer_email and mail.template_buyer.strip():
        _safe_send(
            mail,
            to=buyer_email,
            template_id=mail.template_buyer,
            data={
                "site_name": site_name,
                "order_id": order.id,
                "username": order.username,
                "total": f"{order.total:.2f}",
                "products": products,
                "delivery_content": delivery_content,
            },
        )

    # B: admin
    admin_email = (settings["sys"].email or "").strip()
    if admin_email and mail.template_admin_order.strip():
        _safe_send(
            mail,
            to=admin_email,
            template_id=mail.template_admin_order,
            data={
                "site_name": site_name,
                "order_id": order.id,
                "username": order.username,
                "total": f"{order.total:.2f}",
                "products": products,
                "status": order.status,
            },
        )


def send_password_reset_code(db: Session, *, to: str, username: str, code: str) -> None:
    mail = get_mail_settings(db)
    settings = load_settings(db)
    if not mail.template_reset.strip():
        raise ValueError("未配置找回密码邮件模板")
    send_aoksend(
        mail,
        to=to,
        template_id=mail.template_reset,
        data={
            "site_name": settings["sys"].name or "领匣",
            "username": username,
            "code": code,
        },
    )


def send_contact_mail(
    db: Session,
    *,
    name: str,
    email: str,
    message: str,
) -> None:
    mail = get_mail_settings(db)
    settings = load_settings(db)
    admin_email = (settings["sys"].email or "").strip()
    if not admin_email:
        raise ValueError("未配置客服邮箱（收件人）")
    if not mail.template_contact.strip():
        raise ValueError("未配置联系表单邮件模板")
    send_aoksend(
        mail,
        to=admin_email,
        template_id=mail.template_contact,
        reply_to=email,
        data={
            "site_name": settings["sys"].name or "领匣",
            "name": name,
            "email": email,
            "message": message,
        },
    )
