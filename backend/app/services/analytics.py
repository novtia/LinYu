"""后台营收与经营统计。实收以已支付的 OrderPayment 为准，没有支付明细的旧订单用订单实付补上。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, selectinload

from ..models import Order, Product, User
from ..schemas import AnalyticsOut, AnalyticsStockOut, LedgerRowOut
from ..services.commission import is_commission_mode

SHANGHAI = timezone(timedelta(hours=8))
PAID_ORDER = ("paid", "completed", "deposit_paid", "awaiting_balance")


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _shanghai(dt: datetime) -> datetime:
    return _as_utc(dt).astimezone(SHANGHAI)


def channel_name(provider: str | None, method: str | None) -> str:
    method = method or ""
    provider = provider or ""
    if provider == "usdt" or method.startswith("usdt"):
        return "USDT"
    if method == "wxpay":
        return "微信"
    if provider == "alipay" or method == "alipay":
        return "支付宝"
    if provider == "ezpay":
        return "易支付"
    if provider or method:
        return "其他"
    return "—"


def _kind_for_order(order: Order) -> str:
    if is_commission_mode(getattr(order, "sale_mode", None)):
        if order.status == "deposit_paid":
            return "deposit"
        if order.status in ("awaiting_balance", "completed"):
            return "balance"
    return "full"


def build_analytics(db: Session) -> AnalyticsOut:
    orders = (
        db.query(Order)
        .options(selectinload(Order.payments), selectinload(Order.items))
        .all()
    )
    rows: list[LedgerRowOut] = []
    seen_paid: set[str] = set()
    for order in orders:
        item = order.items[0] if order.items else None
        item_name = item.name if item else "订单"
        product_id = item.product_id if item else None
        mode = "commission" if is_commission_mode(getattr(order, "sale_mode", None)) else "normal"
        paid_rows = [p for p in (order.payments or []) if p.status == "paid" and p.paid_at]
        if paid_rows:
            for pay in paid_rows:
                seen_paid.add(order.id)
                rows.append(
                    LedgerRowOut(
                        order_id=order.id,
                        at=_shanghai(pay.paid_at),
                        kind=pay.kind or "full",
                        ok=True,
                        channel=channel_name(pay.payment_provider or order.payment_provider, pay.payment_method or order.payment_method),
                        amount=round(float(pay.amount or 0), 2),
                        buyer=order.username or "",
                        item=item_name,
                        sale_mode=mode,
                        product_id=product_id,
                        payment_channel_id=pay.payment_channel_id or order.payment_channel_id,
                    )
                )
            continue
        if order.paid_at and order.status in PAID_ORDER:
            seen_paid.add(order.id)
            rows.append(
                LedgerRowOut(
                    order_id=order.id,
                    at=_shanghai(order.paid_at),
                    kind=_kind_for_order(order),
                    ok=True,
                    channel=channel_name(order.payment_provider, order.payment_method),
                    amount=round(float(order.total or 0), 2),
                    buyer=order.username or "",
                    item=item_name,
                    sale_mode=mode,
                    product_id=product_id,
                    payment_channel_id=order.payment_channel_id,
                )
            )
        elif order.status == "failed":
            rows.append(
                LedgerRowOut(
                    order_id=order.id,
                    at=_shanghai(order.created_at),
                    kind=_kind_for_order(order),
                    ok=False,
                    channel=channel_name(order.payment_provider, order.payment_method),
                    amount=round(float(order.total or 0), 2),
                    buyer=order.username or "",
                    item=item_name,
                    sale_mode=mode,
                    product_id=product_id,
                    payment_channel_id=order.payment_channel_id,
                )
            )

    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    late_balance = now - timedelta(hours=48)

    def _count(status: str) -> int:
        return sum(1 for o in orders if o.status == status)

    writing = _count("deposit_paid")
    writing_late = sum(
        1
        for o in orders
        if o.status == "deposit_paid" and o.created_at and _as_utc(o.created_at) < week_ago
    )
    balance_orders = [o for o in orders if o.status == "awaiting_balance"]
    balance_money = 0.0
    for o in balance_orders:
        pending = [p for p in (o.payments or []) if p.kind == "balance" and p.status != "paid"]
        if pending:
            balance_money += sum(float(p.amount or 0) for p in pending)
        else:
            balance_money += float(o.total or 0) / 2
    balance_late = sum(
        1
        for o in balance_orders
        if o.created_at and _as_utc(o.created_at) < late_balance
    )

    buyers: dict[str, int] = {}
    for row in rows:
        if row.ok:
            buyers[row.buyer] = buyers.get(row.buyer, 0) + 1
    paying = len(buyers)
    repeat = sum(1 for n in buyers.values() if n >= 2)

    products = db.query(Product).all()
    users = db.query(User).filter(User.role != "admin").count()

    rows.sort(key=lambda r: r.at, reverse=True)
    return AnalyticsOut(
        rows=rows,
        stock=AnalyticsStockOut(
            writing=writing,
            writing_late=writing_late,
            balance_count=len(balance_orders),
            balance_money=round(balance_money, 2),
            balance_late=balance_late,
            pending_pay=_count("pending"),
            users=int(users),
            paying_users=paying,
            repeat_users=repeat,
            products_on=sum(1 for p in products if p.status == "on"),
            products_off=sum(1 for p in products if p.status != "on"),
            commission_on=sum(1 for p in products if p.status == "on" and is_commission_mode(p.sale_mode)),
        ),
    )
