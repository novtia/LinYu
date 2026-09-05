from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_admin_user, get_current_user, get_optional_user
from ..models import Delivery, Order, OrderItem, Product, User
from ..payment.providers import get_provider
from ..payment.service import get_channel, list_public_methods, parse_config
from ..schemas import CheckoutIn, CheckoutOut, DeliveryOut, OrderItemOut, OrderLookupIn, OrderOut, ProductFileItemOut
from ..seed import load_settings
from ..services.delivery import random_id
from ..services.fulfillment import fulfill_order
from ..services.mail import is_valid_email
from ..services.ratelimit import rate_limit

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _resolve_checkout_email(db: Session, user: User | None, submitted: str | None) -> str:
    if user:
        email = _normalize_email(user.email)
        if email:
            if not is_valid_email(email):
                raise HTTPException(status_code=400, detail="账号邮箱无效，请先在设置中更新")
            return email
        email = _normalize_email(submitted)
        if not email:
            raise HTTPException(status_code=400, detail="请填写收货邮箱")
        if not is_valid_email(email):
            raise HTTPException(status_code=400, detail="请填写有效的邮箱")
        taken = db.query(User).filter(User.email == email, User.id != user.id).first()
        if taken:
            raise HTTPException(status_code=400, detail="该邮箱已被其他账号使用")
        user.email = email
        db.add(user)
        return email

    email = _normalize_email(submitted)
    if not email:
        raise HTTPException(status_code=400, detail="请填写收货邮箱")
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请填写有效的邮箱")
    return email


def _can_access_order(order: Order, user: User | None, email: str | None) -> bool:
    if user and user.role == "admin":
        return True
    if user:
        if order.user_id and order.user_id == user.id:
            return True
        user_email = _normalize_email(user.email)
        if user_email and user_email == _normalize_email(order.email):
            return True
    guest = _normalize_email(email)
    return bool(guest and guest == _normalize_email(order.email))


def _deny_order_access(user: User | None, email: str | None, *, action: str = "查看") -> None:
    if not user and not _normalize_email(email):
        raise HTTPException(status_code=403, detail="请填写购买邮箱")
    raise HTTPException(status_code=403, detail=f"无权{action}该订单")


def _delivery_out(d) -> DeliveryOut:
    files = ProductFileItemOut.list_from_delivery(d)
    return DeliveryOut(
        id=d.id,
        order_id=d.order_id,
        product_id=d.product_id,
        product_name=d.product_name,
        payload=d.payload,
        file_name=files[0].file_name if files else d.file_name,
        download_url=files[0].download_url if files else None,
        files=files,
        created_at=d.created_at,
    )


def _order_out(order: Order, include_payload: bool = False) -> OrderOut:
    delivery_by_product = {}
    if include_payload and order.status in ("paid", "completed"):
        for d in order.deliveries:
            delivery_by_product[d.product_id] = d
    items = []
    for it in order.items:
        d = delivery_by_product.get(it.product_id)
        payload = None
        file_name = None
        download_url = None
        files = []
        if include_payload and d:
            payload = d.payload
            files = ProductFileItemOut.list_from_delivery(d)
            file_name = files[0].file_name if files else d.file_name
            download_url = files[0].download_url if files else None
        items.append(
            OrderItemOut(
                product_id=it.product_id,
                name=it.name,
                price=it.price,
                payload=payload,
                file_name=file_name,
                download_url=download_url,
                files=files,
            )
        )
    return OrderOut(
        id=order.id,
        username=order.username,
        email=order.email or "",
        total=order.total,
        status=order.status,
        payment_method=order.payment_method,
        payment_provider=order.payment_provider,
        trade_no=order.trade_no,
        paid_at=order.paid_at,
        created_at=order.created_at,
        items=items,
    )


def _public_base(request: Request) -> str:
    # 生产环境优先使用固定配置，避免伪造 Host / X-Forwarded-Host 污染支付回调地址
    fixed = (os.getenv("PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if fixed:
        return fixed
    # 优先 X-Forwarded-*，便于反向代理；否则用请求自身
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if host:
        return f"{proto}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _resolve_payment(db: Session, payment_method_id: str):
    methods = list_public_methods(db).methods
    hit = next((m for m in methods if m.id == payment_method_id), None)
    if not hit:
        raise HTTPException(status_code=400, detail="支付方式不可用，请重新选择")
    channel = get_channel(db, hit.channel_id)
    if not channel.enabled:
        raise HTTPException(status_code=400, detail="支付渠道已停用")
    adapter = get_provider(channel.provider)
    if not adapter:
        raise HTTPException(status_code=400, detail="暂不支持该支付渠道")
    config = parse_config(channel.config_json)
    if not adapter.is_ready(config):
        raise HTTPException(status_code=400, detail="支付渠道配置不完整")
    return hit, channel, adapter, config


def _make_order(
    *,
    order_id: str,
    user: User | None,
    email: str,
    total: float,
    status: str = "pending",
    payment_channel_id: str | None = None,
    payment_method: str | None = None,
    payment_provider: str | None = None,
    trade_no: str | None = None,
) -> Order:
    return Order(
        id=order_id,
        user_id=user.id if user else None,
        username=user.username if user else "访客",
        email=email,
        total=total,
        status=status,
        payment_channel_id=payment_channel_id,
        payment_method=payment_method,
        payment_provider=payment_provider,
        trade_no=trade_no,
        created_at=datetime.utcnow(),
    )


def _complete_without_payment(
    db: Session,
    *,
    order_id: str,
    user: User | None,
    email: str,
    total: float,
    lines: list,
    method: str,
) -> CheckoutOut:
    order = _make_order(
        order_id=order_id,
        user=user,
        email=email,
        total=total,
        payment_method=method,
        payment_provider=method,
        trade_no=f"{method.upper()}-{order_id}",
    )
    db.add(order)
    for p in lines:
        db.add(
            OrderItem(
                order_id=order_id,
                product_id=p.id,
                name=p.name,
                price=p.price,
            )
        )
    db.commit()
    db.refresh(order)
    deliveries = fulfill_order(db, order, trade_no=order.trade_no, force=True)
    return CheckoutOut(
        order=_order_out(order, include_payload=True),
        pay_url="",
        deliveries=[_delivery_out(d) for d in deliveries],
    )


@router.post(
    "/checkout",
    response_model=CheckoutOut,
    dependencies=[Depends(rate_limit("checkout", limit=30, window=300))],
)
def checkout(
    body: CheckoutIn,
    request: Request,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    settings = load_settings(db)
    if settings["sys"].maintain:
        raise HTTPException(status_code=400, detail="站点维护中，暂停下单")

    email = _resolve_checkout_email(db, user, body.email)

    # 调试模式跳过真实支付，仅限管理员，避免被当成零元购入口
    debug_mode = bool(settings["sys"].debugMode) and bool(user and user.role == "admin")
    payment_method_id = (body.payment_method_id or "").strip()

    # 以服务端商品为准计价
    lines = []
    for raw in body.items:
        product = db.query(Product).filter(Product.id == raw.id).first()
        if not product or product.status != "on":
            raise HTTPException(status_code=400, detail=f"商品不可用：{raw.name or raw.id}")
        lines.append(product)

    if not lines:
        raise HTTPException(status_code=400, detail="请选择商品")
    if any((p.price or 0) < 0 for p in lines):
        raise HTTPException(status_code=400, detail="商品价格异常")

    total = round(sum(p.price for p in lines), 2)
    # 时间戳 + 随机后缀：避免同毫秒并发下单撞主键，也降低订单号可预测性
    order_id = "LX" + str(int(datetime.utcnow().timestamp() * 1000)) + random_id(length=4)

    if debug_mode or total == 0:
        return _complete_without_payment(
            db,
            order_id=order_id,
            user=user,
            email=email,
            total=total,
            lines=lines,
            method="debug" if debug_mode else "free",
        )

    if not payment_method_id:
        raise HTTPException(status_code=400, detail="请选择支付方式")

    hit, channel, adapter, config = _resolve_payment(db, payment_method_id)

    order = _make_order(
        order_id=order_id,
        user=user,
        email=email,
        total=total,
        payment_channel_id=channel.id,
        payment_method=hit.method,
        payment_provider=channel.provider,
    )
    db.add(order)
    for p in lines:
        db.add(
            OrderItem(
                order_id=order_id,
                product_id=p.id,
                name=p.name,
                price=p.price,
            )
        )
    db.commit()
    db.refresh(order)

    base = _public_base(request)
    notify_path = adapter.default_notify_path() if hasattr(adapter, "default_notify_path") else "api/pay/ezpay/notify"
    return_path = adapter.default_return_path() if hasattr(adapter, "default_return_path") else "api/pay/ezpay/return"
    notify_url = (config.get("notify_url") or "").strip() or urljoin(base + "/", notify_path)
    return_url = (config.get("return_url") or "").strip() or urljoin(base + "/", return_path)

    product_name = lines[0].name if len(lines) else "商品"
    if len(lines) > 1:
        product_name = f"{lines[0].name} 等{len(lines)}件"
    if not hasattr(adapter, "build_pay_url"):
        raise HTTPException(status_code=400, detail="该渠道暂不支持在线支付")

    pay_url = adapter.build_pay_url(
        config,
        money=total,
        name=product_name[:120],
        out_trade_no=order_id,
        pay_type=hit.method,
        notify_url=notify_url,
        return_url=return_url,
    )

    return CheckoutOut(order=_order_out(order, include_payload=False), pay_url=pay_url, deliveries=[])


@router.get("/mine", response_model=List[OrderOut])
def my_orders(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_email = _normalize_email(user.email)
    cond = [Order.user_id == user.id]
    if user_email:
        cond.append(Order.email == user_email)
    orders = (
        db.query(Order)
        .options(selectinload(Order.items), selectinload(Order.deliveries).selectinload(Delivery.files))
        .filter(or_(*cond))
        .order_by(Order.created_at.desc())
        .all()
    )
    return [_order_out(o, include_payload=True) for o in orders]


@router.post(
    "/lookup",
    response_model=List[OrderOut],
    dependencies=[Depends(rate_limit("order_lookup", limit=8, window=300))],
)
def lookup_orders(
    body: OrderLookupIn,
    db: Session = Depends(get_db),
):
    email = _normalize_email(body.email)
    if not email or not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请填写有效的邮箱")
    orders = (
        db.query(Order)
        .options(selectinload(Order.items), selectinload(Order.deliveries).selectinload(Delivery.files))
        .filter(Order.email == email)
        .order_by(Order.created_at.desc())
        .all()
    )
    return [_order_out(o, include_payload=True) for o in orders]


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: str,
    email: str = Query(default=""),
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    order = (
        db.query(Order)
        .options(selectinload(Order.items), selectinload(Order.deliveries).selectinload(Delivery.files))
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if not _can_access_order(order, user, email):
        _deny_order_access(user, email)
    return _order_out(order, include_payload=True)


@router.get("", response_model=List[OrderOut])
def admin_orders(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    orders = db.query(Order).order_by(Order.created_at.desc()).all()
    return [_order_out(o, include_payload=False) for o in orders]
