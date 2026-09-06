from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_admin_user, get_current_user, get_optional_user
from ..models import Delivery, DeliveryFile, Order, OrderItem, OrderPayment, Product, User
from ..payment.providers import get_provider
from ..payment.service import get_channel, list_public_methods, parse_config
from ..schemas import (
    CheckoutIn,
    CheckoutOut,
    DeliveryOut,
    MessageOut,
    OrderItemOut,
    OrderLookupIn,
    OrderOut,
    OrderPaymentOut,
    PayBalanceIn,
    ProductFileItemOut,
    ProductFileOut,
)
from ..seed import load_settings
from ..services.commission import (
    MAX_WORDS,
    MIN_WORDS,
    SALE_COMMISSION,
    SALE_NORMAL,
    commission_total,
    is_commission_mode,
    split_price,
)
from ..services.commission_chat import notify_deposit_paid
from ..services.delivery import random_id
from ..services.files import delete_stored, is_image_name, save_upload
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


def _delivery_out(d, *, include_url: bool = True) -> DeliveryOut:
    files = ProductFileItemOut.list_from_delivery(d, include_url=include_url)
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


def _order_out(order: Order, include_payload: bool = False, *, unlock_download: bool = False) -> OrderOut:
    commission = is_commission_mode(getattr(order, "sale_mode", None))
    deposit_amount = balance_amount = None
    if commission:
        deposit_amount, balance_amount = split_price(order.total)

    include_url = False
    attach_delivery = False
    if include_payload:
        if commission:
            attach_delivery = order.status in ("deposit_paid", "awaiting_balance", "completed")
            include_url = unlock_download or order.status == "completed"
        else:
            attach_delivery = order.status in ("paid", "completed")
            include_url = attach_delivery

    delivery_by_product = {}
    if attach_delivery:
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
            if not commission or include_url:
                payload = d.payload
            files = ProductFileItemOut.list_from_delivery(d, include_url=include_url)
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
    payments = [
        OrderPaymentOut(
            id=p.id,
            kind=p.kind,
            amount=p.amount,
            status=p.status,
            paid_at=p.paid_at,
        )
        for p in sorted(list(order.payments or []), key=lambda x: x.created_at or datetime.min)
    ]
    return OrderOut(
        id=order.id,
        user_id=order.user_id,
        username=order.username,
        email=order.email or "",
        total=order.total,
        status=order.status,
        sale_mode=SALE_COMMISSION if commission else SALE_NORMAL,
        deposit_amount=deposit_amount,
        balance_amount=balance_amount,
        word_count=getattr(order, "word_count", None),
        payment_method=order.payment_method,
        payment_provider=order.payment_provider,
        trade_no=order.trade_no,
        paid_at=order.paid_at,
        created_at=order.created_at,
        items=items,
        payments=payments,
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
    sale_mode: str = SALE_NORMAL,
    payment_channel_id: str | None = None,
    payment_method: str | None = None,
    payment_provider: str | None = None,
    trade_no: str | None = None,
    paid_at: datetime | None = None,
    word_count: int | None = None,
) -> Order:
    return Order(
        id=order_id,
        user_id=user.id if user else None,
        username=user.username if user else "访客",
        email=email,
        total=total,
        status=status,
        sale_mode=sale_mode,
        payment_channel_id=payment_channel_id,
        payment_method=payment_method,
        payment_provider=payment_provider,
        trade_no=trade_no,
        paid_at=paid_at,
        created_at=datetime.utcnow(),
        word_count=word_count,
    )


def _payment_id(order_id: str, kind: str) -> str:
    if kind == "full":
        return order_id
    if kind == "deposit":
        return f"{order_id}D"
    if kind == "balance":
        return f"{order_id}B"
    return f"{order_id}P"


def _add_payment(
    *,
    order_id: str,
    kind: str,
    amount: float,
    channel_id: str | None,
    method: str | None,
    provider: str | None,
    status: str = "pending",
) -> OrderPayment:
    return OrderPayment(
        id=_payment_id(order_id, kind),
        order_id=order_id,
        kind=kind,
        amount=round(float(amount), 2),
        status=status,
        payment_channel_id=channel_id,
        payment_method=method,
        payment_provider=provider,
        created_at=datetime.utcnow(),
    )


def _notify_return_urls(request: Request, adapter, config: dict) -> tuple[str, str]:
    base = _public_base(request)
    notify_path = adapter.default_notify_path() if hasattr(adapter, "default_notify_path") else "api/pay/ezpay/notify"
    return_path = adapter.default_return_path() if hasattr(adapter, "default_return_path") else "api/pay/ezpay/return"
    notify_url = (config.get("notify_url") or "").strip() or urljoin(base + "/", notify_path)
    return_url = (config.get("return_url") or "").strip() or urljoin(base + "/", return_path)
    return notify_url, return_url


def _build_pay_url(adapter, config, *, money: float, name: str, out_trade_no: str, pay_type: str, notify_url: str, return_url: str) -> str:
    if not hasattr(adapter, "build_pay_url"):
        raise HTTPException(status_code=400, detail="该渠道暂不支持在线支付")
    return adapter.build_pay_url(
        config,
        money=money,
        name=name[:120],
        out_trade_no=out_trade_no,
        pay_type=pay_type,
        notify_url=notify_url,
        return_url=return_url,
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
        sale_mode=SALE_NORMAL,
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

    commission_lines = [p for p in lines if is_commission_mode(getattr(p, "sale_mode", None))]
    if commission_lines and len(commission_lines) != len(lines):
        raise HTTPException(status_code=400, detail="约稿商品请单独下单，不能与普通商品一起结算")
    sale_mode = SALE_COMMISSION if commission_lines else SALE_NORMAL
    word_count = None
    deposit_amount = balance_amount = 0.0
    if sale_mode == SALE_COMMISSION:
        if not user:
            raise HTTPException(status_code=401, detail="约稿商品请先登录后再购买")
        if len(lines) != 1:
            raise HTTPException(status_code=400, detail="约稿商品每次只能购买一种，请按字数下单")
        word_count = body.word_count
        if word_count is None or int(word_count) < MIN_WORDS:
            raise HTTPException(status_code=400, detail=f"约稿至少 {MIN_WORDS} 字")
        if int(word_count) > MAX_WORDS:
            raise HTTPException(status_code=400, detail="字数超出范围")
        word_count = int(word_count)
        total = commission_total(lines[0].price, word_count)
        deposit_amount, balance_amount = split_price(total)
        if deposit_amount < 0.01 or balance_amount < 0.01:
            raise HTTPException(status_code=400, detail="按当前字数计算后金额过低，请增加字数")
    else:
        total = round(sum(p.price for p in lines), 2)

    email = _resolve_checkout_email(db, user, body.email)
    # 时间戳 + 随机后缀：避免同毫秒并发下单撞主键，也降低订单号可预测性
    order_id = "LX" + str(int(datetime.utcnow().timestamp() * 1000)) + random_id(length=4)

    if sale_mode == SALE_COMMISSION and debug_mode:
        order = _make_order(
            order_id=order_id,
            user=user,
            email=email,
            total=total,
            status="deposit_paid",
            sale_mode=SALE_COMMISSION,
            payment_method="debug",
            payment_provider="debug",
            trade_no=f"DEBUG-{order_id}",
            paid_at=datetime.utcnow(),
            word_count=word_count,
        )
        db.add(order)
        for p in lines:
            db.add(OrderItem(order_id=order_id, product_id=p.id, name=p.name, price=p.price))
        db.add(
            _add_payment(
                order_id=order_id,
                kind="deposit",
                amount=deposit_amount,
                channel_id=None,
                method="debug",
                provider="debug",
                status="paid",
            )
        )
        db.commit()
        db.refresh(order)
        notify_deposit_paid(db, order)
        db.refresh(order)
        return CheckoutOut(order=_order_out(order, include_payload=True, unlock_download=True), pay_url="", deliveries=[])

    if debug_mode or (sale_mode == SALE_NORMAL and total == 0):
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
        sale_mode=sale_mode,
        payment_channel_id=channel.id,
        payment_method=hit.method,
        payment_provider=channel.provider,
        word_count=word_count,
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
    if sale_mode == SALE_COMMISSION:
        pay_kind = "deposit"
        pay_amount = deposit_amount
        pay_name = f"{lines[0].name} 定金"
    else:
        pay_kind = "full"
        pay_amount = total
        pay_name = lines[0].name if len(lines) == 1 else f"{lines[0].name} 等{len(lines)}件"
    payment = _add_payment(
        order_id=order_id,
        kind=pay_kind,
        amount=pay_amount,
        channel_id=channel.id,
        method=hit.method,
        provider=channel.provider,
    )
    db.add(payment)
    db.commit()
    db.refresh(order)

    notify_url, return_url = _notify_return_urls(request, adapter, config)
    pay_url = _build_pay_url(
        adapter,
        config,
        money=pay_amount,
        name=pay_name,
        out_trade_no=payment.id,
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
        .options(
            selectinload(Order.items),
            selectinload(Order.payments),
            selectinload(Order.deliveries).selectinload(Delivery.files),
        )
        .filter(or_(*cond))
        .order_by(Order.created_at.desc())
        .all()
    )
    return [_order_out(o, include_payload=True) for o in orders]


@router.get("/mine/for-product/{product_id}", response_model=Optional[OrderOut])
def my_order_for_product(
    product_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_email = _normalize_email(user.email)
    cond = [Order.user_id == user.id]
    if user_email:
        cond.append(Order.email == user_email)
    order = (
        db.query(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .options(
            selectinload(Order.items),
            selectinload(Order.payments),
            selectinload(Order.deliveries).selectinload(Delivery.files),
        )
        .filter(or_(*cond), OrderItem.product_id == product_id)
        .order_by(Order.created_at.desc())
        .first()
    )
    if not order:
        return None
    return _order_out(order, include_payload=True)


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
        .options(
            selectinload(Order.items),
            selectinload(Order.payments),
            selectinload(Order.deliveries).selectinload(Delivery.files),
        )
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
        .options(
            selectinload(Order.items),
            selectinload(Order.payments),
            selectinload(Order.deliveries).selectinload(Delivery.files),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if not _can_access_order(order, user, email):
        _deny_order_access(user, email)
    unlock = bool(user and user.role == "admin")
    return _order_out(order, include_payload=True, unlock_download=unlock)


def _get_order_or_404(db: Session, order_id: str) -> Order:
    order = (
        db.query(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.payments),
            selectinload(Order.deliveries).selectinload(Delivery.files),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


def _ensure_commission_delivery(db: Session, order: Order) -> Delivery:
    if order.deliveries:
        return order.deliveries[0]
    item = order.items[0] if order.items else None
    delivery = Delivery(
        id="d_" + random_id(),
        order_id=order.id,
        product_id=item.product_id if item else 0,
        product_name=item.name if item else "约稿",
        payload="",
        created_at=datetime.utcnow(),
    )
    db.add(delivery)
    db.flush()
    order.deliveries.append(delivery)
    return delivery


@router.post("/{order_id}/pay-balance", response_model=CheckoutOut)
def pay_balance(
    order_id: str,
    body: PayBalanceIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = _get_order_or_404(db, order_id)
    if user.role != "admin" and order.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权支付该订单尾款")
    if not is_commission_mode(order.sale_mode):
        raise HTTPException(status_code=400, detail="该订单不是约稿订单")
    if order.status != "awaiting_balance":
        raise HTTPException(status_code=400, detail="当前还不能支付尾款")

    settings = load_settings(db)
    if settings["sys"].maintain:
        raise HTTPException(status_code=400, detail="站点维护中，暂停下单")

    _deposit, balance_amount = split_price(order.total)
    debug_mode = bool(settings["sys"].debugMode) and user.role == "admin"
    if debug_mode:
        existing = next((p for p in order.payments if p.kind == "balance"), None)
        if existing:
            existing.status = "paid"
            existing.paid_at = datetime.utcnow()
            existing.trade_no = existing.trade_no or f"DEBUG-{order.id}B"
        else:
            row = _add_payment(
                order_id=order.id,
                kind="balance",
                amount=balance_amount,
                channel_id=None,
                method="debug",
                provider="debug",
                status="paid",
            )
            row.paid_at = datetime.utcnow()
            row.trade_no = f"DEBUG-{order.id}B"
            db.add(row)
        order.status = "completed"
        db.commit()
        db.refresh(order)
        return CheckoutOut(order=_order_out(order, include_payload=True, unlock_download=True), pay_url="", deliveries=[])

    payment_method_id = (body.payment_method_id or "").strip()
    if not payment_method_id:
        raise HTTPException(status_code=400, detail="请选择支付方式")
    hit, channel, adapter, config = _resolve_payment(db, payment_method_id)

    payment = next((p for p in order.payments if p.kind == "balance" and p.status == "pending"), None)
    if not payment:
        payment = _add_payment(
            order_id=order.id,
            kind="balance",
            amount=balance_amount,
            channel_id=channel.id,
            method=hit.method,
            provider=channel.provider,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
    else:
        payment.payment_channel_id = channel.id
        payment.payment_method = hit.method
        payment.payment_provider = channel.provider
        payment.amount = balance_amount
        db.commit()

    notify_url, return_url = _notify_return_urls(request, adapter, config)
    item_name = order.items[0].name if order.items else "约稿"
    pay_url = _build_pay_url(
        adapter,
        config,
        money=payment.amount,
        name=f"{item_name} 尾款",
        out_trade_no=payment.id,
        pay_type=hit.method,
        notify_url=notify_url,
        return_url=return_url,
    )
    return CheckoutOut(order=_order_out(order, include_payload=True), pay_url=pay_url, deliveries=[])


@router.post("/{order_id}/files", response_model=ProductFileOut)
async def upload_order_manuscript(
    order_id: str,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    order = _get_order_or_404(db, order_id)
    if not is_commission_mode(order.sale_mode):
        raise HTTPException(status_code=400, detail="仅约稿订单可上传稿件")
    if order.status == "completed":
        raise HTTPException(status_code=400, detail="订单已完成，不能再改稿件")
    if order.status not in ("deposit_paid", "awaiting_balance"):
        raise HTTPException(status_code=400, detail="请等待买家支付定金后再交稿")

    delivery = _ensure_commission_delivery(db, order)
    try:
        stored, original = await save_upload(file, order.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    sort_order = max([f.sort_order for f in (delivery.files or [])], default=-1) + 1
    row = DeliveryFile(
        id="df_" + random_id(length=8),
        delivery_id=delivery.id,
        file_path=stored,
        file_name=original,
        sort_order=sort_order,
    )
    db.add(row)
    if not delivery.file_path:
        delivery.file_path = stored
        delivery.file_name = original
    if order.status == "deposit_paid":
        order.status = "awaiting_balance"
    db.commit()
    db.refresh(row)
    return ProductFileOut(id=row.id, file_name=row.file_name, is_image=is_image_name(row.file_name), message="稿件已上传")


@router.delete("/{order_id}/files/{file_id}", response_model=MessageOut)
def delete_order_manuscript(
    order_id: str,
    file_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    order = _get_order_or_404(db, order_id)
    if not is_commission_mode(order.sale_mode):
        raise HTTPException(status_code=400, detail="仅约稿订单可管理稿件")
    if order.status == "completed":
        raise HTTPException(status_code=400, detail="订单已完成，不能再改稿件")
    delivery = order.deliveries[0] if order.deliveries else None
    if not delivery:
        raise HTTPException(status_code=404, detail="文件不存在")
    row = next((f for f in delivery.files if f.id == file_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="文件不存在")
    delete_stored(row.file_path)
    delivery.files.remove(row)
    db.delete(row)
    remaining = list(delivery.files or [])
    if remaining:
        delivery.file_path = remaining[0].file_path
        delivery.file_name = remaining[0].file_name
    else:
        delivery.file_path = None
        delivery.file_name = None
        if order.status == "awaiting_balance":
            order.status = "deposit_paid"
    db.commit()
    return MessageOut(message="已删除稿件")


@router.get("", response_model=List[OrderOut])
def admin_orders(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    orders = (
        db.query(Order)
        .options(selectinload(Order.items), selectinload(Order.payments))
        .order_by(Order.created_at.desc())
        .all()
    )
    return [_order_out(o, include_payload=False) for o in orders]
