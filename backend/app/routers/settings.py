from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user, get_optional_user
from ..models import Delivery, Order, Product, User
from ..payment.service import SECRET_MASK
from ..schemas import (
    DashboardOut,
    OrderItemOut,
    OrderOut,
    PublicSettingsOut,
    SettingsOut,
    SiteSettings,
    SysSettings,
)
from ..seed import load_settings, save_settings

router = APIRouter(prefix="/api", tags=["settings"])


def _order_brief(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        username=order.username,
        total=order.total,
        status=order.status,
        created_at=order.created_at,
        items=[
            OrderItemOut(product_id=it.product_id, name=it.name, price=it.price)
            for it in order.items
        ],
    )


@router.get("/settings/public", response_model=PublicSettingsOut)
def public_settings(
    viewer: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    s = load_settings(db)
    is_admin = bool(viewer and viewer.role == "admin")
    return PublicSettingsOut(
        title=s["site"].title,
        notice=s["site"].notice,
        allowReg=s["sys"].allowReg,
        maintain=s["sys"].maintain,
        name=s["sys"].name,
        # 调试模式仅管理员可用，也只对管理员可见
        debugMode=bool(s["sys"].debugMode) and is_admin,
        mailEnabled=bool(s["sys"].mail.enabled),
    )


MAIL_SECRET_FIELDS = ("secret_id", "secret_key")


def _masked_sys(sys: SysSettings) -> SysSettings:
    """邮件密钥脱敏后再返回给管理端。"""
    masked = sys.model_copy(deep=True)
    for field in MAIL_SECRET_FIELDS:
        if str(getattr(masked.mail, field) or "").strip():
            setattr(masked.mail, field, SECRET_MASK)
    return masked


def _restore_mail_secrets(submitted: SysSettings, current: SysSettings) -> SysSettings:
    """提交为空或仍是掩码时沿用已存密钥。"""
    merged = submitted.model_copy(deep=True)
    for field in MAIL_SECRET_FIELDS:
        value = str(getattr(merged.mail, field) or "").strip()
        if not value or value == SECRET_MASK:
            setattr(merged.mail, field, getattr(current.mail, field) or "")
    return merged


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    s = load_settings(db)
    return SettingsOut(sys=_masked_sys(s["sys"]), site=s["site"])


@router.put("/settings/sys", response_model=SettingsOut)
def update_sys(
    body: SysSettings,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    current = load_settings(db)
    s = save_settings(db, sys=_restore_mail_secrets(body, current["sys"]))
    return SettingsOut(sys=_masked_sys(s["sys"]), site=s["site"])


@router.put("/settings/site", response_model=SettingsOut)
def update_site(
    body: SiteSettings,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    s = save_settings(db, site=body)
    # 与其他设置接口保持一致：邮件密钥脱敏后再返回
    return SettingsOut(sys=_masked_sys(s["sys"]), site=s["site"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    orders = db.query(Order).all()
    today_orders = sum(1 for o in orders if o.created_at.date() == today)
    users = db.query(User).filter(User.role != "admin").count()
    products_on = db.query(Product).filter(Product.status == "on").count()
    deliveries = db.query(Delivery).count()
    recent = (
        db.query(Order).order_by(Order.created_at.desc()).limit(5).all()
    )
    return DashboardOut(
        today_orders=today_orders,
        users=users,
        products_on=products_on,
        deliveries=deliveries,
        recent_orders=[_order_brief(o) for o in recent],
    )
