from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from ..models import Order, User
from ..schemas import MailSettings
from ..seed import load_settings

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_valid_email(email: str) -> bool:
    return bool(email and EMAIL_RE.match(email.strip()))


def get_mail_settings(db: Session) -> MailSettings:
    return load_settings(db)["sys"].mail


def _from_address(mail: MailSettings) -> str:
    addr = (mail.from_email or "").strip()
    alias = (mail.from_alias or "").strip()
    if not addr:
        raise ValueError("未配置发信地址 from_email")
    # 别名与邮箱之间必须一个空格，别名不能含冒号
    alias = alias.replace(":", "·")
    if alias:
        return f"{alias} <{addr}>"
    return addr


def _as_template_data(data: Optional[Dict[str, Any]]) -> str:
    """SES TemplateData：值必须是简单文本字符串。"""
    cleaned: Dict[str, str] = {}
    for k, v in (data or {}).items():
        s = "" if v is None else str(v)
        cleaned[str(k)] = s
    return json.dumps(cleaned, ensure_ascii=False)


def send_tencent_ses(
    mail: MailSettings,
    *,
    to: str,
    template_id: str,
    subject: str,
    data: Optional[Dict[str, Any]] = None,
    reply_to: Optional[str] = None,
) -> None:
    """调用腾讯云邮件推送 SendEmail。Raises ValueError on failure."""
    if not mail.enabled:
        raise ValueError("邮件服务未启用")
    if not (mail.secret_id or "").strip() or not (mail.secret_key or "").strip():
        raise ValueError("未配置腾讯云 SecretId / SecretKey")
    tid = (template_id or "").strip()
    if not tid:
        raise ValueError("未配置邮件模板 ID")
    try:
        template_id_int = int(tid)
    except ValueError as e:
        raise ValueError("模板 ID 须为数字（腾讯云控制台模板 ID）") from e

    to = to.strip()
    if not is_valid_email(to):
        raise ValueError("收件人邮箱格式不正确")
    subject = (subject or "").strip()
    if not subject:
        raise ValueError("邮件主题不能为空")

    try:
        from tencentcloud.common import credential
        from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
        from tencentcloud.ses.v20201002 import models, ses_client
    except ImportError as e:
        raise ValueError("未安装腾讯云 SDK，请执行 pip install tencentcloud-sdk-python") from e

    region = (mail.region or "ap-guangzhou").strip() or "ap-guangzhou"
    cred = credential.Credential(mail.secret_id.strip(), mail.secret_key.strip())
    client = ses_client.SesClient(cred, region)

    req = models.SendEmailRequest()
    req.FromEmailAddress = _from_address(mail)
    req.Destination = [to]
    req.Subject = subject
    req.TriggerType = 1  # 触发类：验证码 / 交易通知
    rt = (reply_to or mail.reply_to or "").strip()
    if rt:
        req.ReplyToAddresses = rt

    tmpl = models.Template()
    tmpl.TemplateID = template_id_int
    tmpl.TemplateData = _as_template_data(data)
    req.Template = tmpl

    try:
        client.SendEmail(req)
    except TencentCloudSDKException as e:
        raise ValueError(f"腾讯云邮件发送失败：{e.get_code()} {e.get_message()}") from e
    except Exception as e:
        raise ValueError(f"邮件发送失败：{e}") from e


def _safe_send(mail: MailSettings, **kwargs) -> bool:
    try:
        send_tencent_ses(mail, **kwargs)
        return True
    except Exception as e:
        logger.warning("mail send failed: %s", e)
        return False


def notify_order_emails(db: Session, order: Order) -> None:
    """Send buyer delivery mail after fulfill (best-effort)."""
    mail = get_mail_settings(db)
    if not mail.enabled:
        return

    settings = load_settings(db)
    site_name = settings["sys"].name or "领匣"
    products = "、".join(it.name for it in order.items) or "—"

    user = db.query(User).filter(User.id == order.user_id).first()
    buyer_email = (user.email or "").strip() if user else ""
    if buyer_email and mail.template_buyer.strip():
        _safe_send(
            mail,
            to=buyer_email,
            template_id=mail.template_buyer,
            subject=f"【{site_name}】订单 {order.id} 已发货",
            data={
                "site_name": site_name,
                "order_id": order.id,
                "username": order.username,
                "total": f"{order.total:.2f}",
                "products": products,
                # 兼容旧模板变量；发货正文不再随邮件发送
                "delivery_content": "",
            },
        )


def send_password_reset_code(db: Session, *, to: str, username: str, code: str) -> None:
    mail = get_mail_settings(db)
    settings = load_settings(db)
    if not mail.template_reset.strip():
        raise ValueError("未配置找回密码邮件模板")
    site_name = settings["sys"].name or "领匣"
    send_tencent_ses(
        mail,
        to=to,
        template_id=mail.template_reset,
        subject=f"【{site_name}】密码重置验证码",
        data={
            "site_name": site_name,
            "username": username,
            "code": code,
        },
    )


def send_register_code(
    db: Session,
    *,
    to: str,
    username: str,
    code: str,
    expire_minutes: int = 15,
) -> None:
    mail = get_mail_settings(db)
    settings = load_settings(db)
    if not mail.template_register.strip():
        raise ValueError("未配置注册验证码邮件模板")
    site_name = settings["sys"].name or "领匣"
    send_tencent_ses(
        mail,
        to=to,
        template_id=mail.template_register,
        subject=f"【{site_name}】注册验证码",
        data={
            "site_name": site_name,
            "username": username or to,
            "email": to,
            "code": code,
            "expire_minutes": str(expire_minutes),
        },
    )
