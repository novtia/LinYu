from __future__ import annotations

from datetime import datetime
from typing import List
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user, get_current_user
from ..models import Order, OrderItem, Product, User
from ..payment.providers import get_provider
from ..payment.service import get_channel, list_public_methods, parse_config
from ..schemas import CheckoutIn, CheckoutOut, DeliveryOut, OrderItemOut, OrderOut
from ..seed import load_settings
from ..services.fulfillment import fulfill_order
from ..services.mail import is_valid_email

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _bind_checkout_email(db: Session, user: User, submitted: str | None) -> str:
    email = (submitted or user.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="请填写收货邮箱")
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请填写有效的邮箱")
    current = (user.email or "").strip().lower()
    if email != current:
        taken = db.query(User).filter(User.email == email, User.id != user.id).first()
        if taken:
            raise HTTPException(status_code=400, detail="该邮箱已被其他账号使用")
        user.email = email
        db.add(user)
    return email


def _delivery_out(d) -> DeliveryOut:
    download_url = f"/api/downloads/{d.id}" if d.file_path else None
    return DeliveryOut(
        id=d.id,
        order_id=d.order_id,
        product_id=d.product_id,
        product_name=d.product_name,
        payload=d.payload,
        file_name=d.file_name,
        download_url=download_url,
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
        if include_payload and d:
            payload = d.payload
            file_name = d.file_name
            if d.file_path:
                download_url = f"/api/downloads/{d.id}"
        items.append(
            OrderItemOut(
                product_id=it.product_id,
                name=it.name,
                price=it.price,
                payload=payload,
                file_name=file_name,
                download_url=download_url,
            )
        )
    return OrderOut(
        id=order.id,
        username=order.username,
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


@router.post("/checkout", response_model=CheckoutOut)
def checkout(
    body: CheckoutIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = load_settings(db)
    if settings["sys"].maintain:
        raise HTTPException(status_code=400, detail="站点维护中，暂停下单")

    _bind_checkout_email(db, user, body.email)

    debug_mode = bool(settings["sys"].debugMode)
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

    total = round(sum(p.price for p in lines), 2)
    order_id = "LX" + str(int(datetime.utcnow().timestamp() * 1000))

    if debug_mode:
        order = Order(
            id=order_id,
            user_id=user.id,
            username=user.username,
            total=total,
            status="pending",
            payment_channel_id=None,
            payment_method="debug",
            payment_provider="debug",
            trade_no="DEBUG-" + order_id,
            created_at=datetime.utcnow(),
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

    if not payment_method_id:
        raise HTTPException(status_code=400, detail="请选择支付方式")

    hit, channel, adapter, config = _resolve_payment(db, payment_method_id)

    order = Order(
        id=order_id,
        user_id=user.id,
        username=user.username,
        total=total,
        status="pending",
        payment_channel_id=channel.id,
        payment_method=hit.method,
        payment_provider=channel.provider,
        created_at=datetime.utcnow(),
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

    product_name = lines[0].name if len(lines) == 1 else f"{lines[0].name} 等{len(lines)}件"
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
    orders = (
        db.query(Order)
        .filter(Order.user_id == user.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    return [_order_out(o, include_payload=True) for o in orders]


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if user.role != "admin" and order.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权查看该订单")
    return _order_out(order, include_payload=True)


@router.get("", response_model=List[OrderOut])
def admin_orders(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    orders = db.query(Order).order_by(Order.created_at.desc()).all()
    return [_order_out(o, include_payload=False) for o in orders]
