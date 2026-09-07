from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from ..database import BASE_DIR
from ..models import CommissionThread, Delivery, Order, OrderPayment, PaymentChannel, Product, User
from ..schemas import (
    DashboardConvOut,
    DashboardOut,
    DashboardSystemOut,
    DashboardTodoOut,
    DashboardTrendPoint,
    OrderItemOut,
    OrderOut,
)
from ..seed import load_settings
from ..services.commission import SALE_COMMISSION, SALE_NORMAL, is_commission_mode

SHANGHAI = timezone(timedelta(hours=8))
TREND_DAYS = 30
PROVIDER_SHORT = {
    "alipay": "支付宝",
    "ezpay": "易支付",
}
PAID_STATUSES = ("paid", "completed", "deposit_paid", "awaiting_balance")
ACTION_STATUSES = ("pending", "deposit_paid", "awaiting_balance")


def _now_utc() -> datetime:
    return datetime.utcnow()


def _today_shanghai() -> date:
    return datetime.now(SHANGHAI).date()


def _as_utc_naive(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _to_shanghai(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(SHANGHAI)


def _day_range_utc(day: date) -> tuple[datetime, datetime]:
    start_local = datetime(day.year, day.month, day.day, tzinfo=SHANGHAI)
    end_local = start_local + timedelta(days=1)
    return _as_utc_naive(start_local), _as_utc_naive(end_local)


def _order_brief(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        user_id=order.user_id,
        username=order.username,
        email=order.email or "",
        total=order.total,
        status=order.status,
        sale_mode=SALE_COMMISSION if is_commission_mode(getattr(order, "sale_mode", None)) else SALE_NORMAL,
        word_count=order.word_count,
        created_at=order.created_at,
        items=[
            OrderItemOut(product_id=it.product_id, name=it.name, price=it.price)
            for it in (order.items or [])
        ],
    )


def _count_created(db: Session, start: datetime, end: datetime) -> int:
    return (
        db.query(func.count(Order.id))
        .filter(Order.created_at >= start, Order.created_at < end)
        .scalar()
        or 0
    )


def _format_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        kb = n / 1024
        return f"{kb:.0f} KB" if kb >= 10 else f"{kb:.1f} KB"
    mb = n / (1024 * 1024)
    return f"{mb:.1f} MB"


def _ago_hint(dt: datetime | None) -> str:
    if not dt:
        return "等待回复"
    mins = int(max(0, (_now_utc() - dt).total_seconds()) // 60)
    if mins < 1:
        return "刚刚有新消息"
    if mins < 60:
        return f"最早一条距今 {mins} 分钟"
    hours = mins // 60
    if hours < 48:
        return f"最早一条距今 {hours} 小时"
    return f"最早一条距今 {hours // 24} 天"


def _revenue_events(db: Session, start: datetime) -> list[tuple[datetime, float]]:
    events: list[tuple[datetime, float]] = []
    pays = (
        db.query(OrderPayment.paid_at, OrderPayment.amount)
        .filter(
            OrderPayment.status == "paid",
            OrderPayment.paid_at.isnot(None),
            OrderPayment.paid_at >= start,
        )
        .all()
    )
    events.extend((row.paid_at, float(row.amount or 0)) for row in pays if row.paid_at)

    paid_ids = {
        row[0]
        for row in db.query(OrderPayment.order_id).filter(OrderPayment.status == "paid").all()
    }
    orders = (
        db.query(Order.id, Order.paid_at, Order.total)
        .filter(
            Order.paid_at.isnot(None),
            Order.paid_at >= start,
            Order.status.in_(PAID_STATUSES),
        )
        .all()
    )
    for row in orders:
        if row.id in paid_ids or not row.paid_at:
            continue
        events.append((row.paid_at, float(row.total or 0)))
    return events


def _bucket_by_day(items: Iterable[tuple[datetime, float]]) -> dict[date, float]:
    out: dict[date, float] = defaultdict(float)
    for dt, amount in items:
        out[_to_shanghai(dt).date()] += amount
    return out


def _db_size_label() -> tuple[str, str]:
    path = BASE_DIR / "lingxia.db"
    if not path.exists():
        return path.name, "—"
    return path.name, _format_size(path.stat().st_size)


def _payment_label(db: Session) -> str:
    rows = (
        db.query(PaymentChannel)
        .filter(PaymentChannel.enabled.is_(True))
        .order_by(PaymentChannel.created_at.asc())
        .all()
    )
    names: list[str] = []
    seen: set[str] = set()
    for ch in rows:
        label = PROVIDER_SHORT.get(ch.provider or "", "") or (ch.name or "").strip()
        if not label or label in seen:
            continue
        seen.add(label)
        names.append(label)
    return " · ".join(names) if names else "未启用"


def _build_trend(order_days: dict[date, int], revenue_days: dict[date, float], today: date) -> list[DashboardTrendPoint]:
    points: list[DashboardTrendPoint] = []
    for i in range(TREND_DAYS - 1, -1, -1):
        day = today - timedelta(days=i)
        points.append(
            DashboardTrendPoint(
                date=day.isoformat(),
                orders=int(order_days.get(day, 0)),
                revenue=round(float(revenue_days.get(day, 0)), 2),
            )
        )
    return points


def _build_todos(
    *,
    awaiting_balance: int,
    unread_threads: int,
    unread_hint: str,
    pending_pay: int,
    deposit_paid: int,
) -> list[DashboardTodoOut]:
    return [
        DashboardTodoOut(
            key="balance",
            label="待付尾款",
            count=awaiting_balance,
            hint="已成稿，等待买家支付",
            to="/admin/orders?status=awaiting_balance",
            urgent=awaiting_balance > 0,
        ),
        DashboardTodoOut(
            key="unread",
            label="未读约稿对话",
            count=unread_threads,
            hint=unread_hint if unread_threads else "目前没有未读",
            to="/admin/conversations",
            urgent=unread_threads > 0,
        ),
        DashboardTodoOut(
            key="pending",
            label="待支付订单",
            count=pending_pay,
            hint="等待买家完成支付",
            to="/admin/orders?status=pending",
            urgent=False,
        ),
        DashboardTodoOut(
            key="deposit",
            label="已付定金待交稿",
            count=deposit_paid,
            hint="确认档期后按章交稿",
            to="/admin/conversations",
            urgent=False,
        ),
    ]


def _build_conversations(db: Session) -> list[DashboardConvOut]:
    unread = (
        db.query(CommissionThread)
        .filter(CommissionThread.unread_admin > 0)
        .order_by(CommissionThread.updated_at.desc())
        .limit(5)
        .all()
    )
    rows = list(unread)
    if len(rows) < 5:
        seen = {t.id for t in rows}
        extra = (
            db.query(CommissionThread)
            .order_by(CommissionThread.updated_at.desc())
            .limit(8)
            .all()
        )
        for t in extra:
            if t.id in seen:
                continue
            rows.append(t)
            if len(rows) >= 5:
                break

    if not rows:
        return []

    user_ids = {t.user_id for t in rows}
    product_ids = {t.product_id for t in rows}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()}
    return [
        DashboardConvOut(
            id=t.id,
            user_id=t.user_id,
            username=(users.get(t.user_id).username if users.get(t.user_id) else "用户"),
            product_id=t.product_id,
            product_name=(products.get(t.product_id).name if products.get(t.product_id) else "约稿"),
            order_id=t.order_id,
            preview=(t.last_preview or "").strip() or "还没有消息",
            last_at=t.last_at or t.updated_at,
            unread=int(t.unread_admin or 0),
        )
        for t in rows
    ]


def build_dashboard(db: Session) -> DashboardOut:
    today = _today_shanghai()
    yesterday = today - timedelta(days=1)
    today_start, today_end = _day_range_utc(today)
    yday_start, yday_end = _day_range_utc(yesterday)
    window_start, _ = _day_range_utc(today - timedelta(days=TREND_DAYS - 1))
    overdue_before = _now_utc() - timedelta(hours=24)

    today_orders = _count_created(db, today_start, today_end)
    yesterday_orders = _count_created(db, yday_start, yday_end)

    revenue_events = _revenue_events(db, window_start)
    revenue_days = _bucket_by_day(revenue_events)
    today_revenue = round(float(revenue_days.get(today, 0)), 2)
    yesterday_revenue = round(float(revenue_days.get(yesterday, 0)), 2)

    created_rows = (
        db.query(Order.created_at)
        .filter(Order.created_at >= window_start)
        .all()
    )
    order_days: dict[date, int] = defaultdict(int)
    for row in created_rows:
        if row.created_at:
            order_days[_to_shanghai(row.created_at).date()] += 1

    pending_pay = db.query(func.count(Order.id)).filter(Order.status == "pending").scalar() or 0
    pending_overdue = (
        db.query(func.count(Order.id))
        .filter(Order.status == "pending", Order.created_at < overdue_before)
        .scalar()
        or 0
    )
    deposit_paid = db.query(func.count(Order.id)).filter(Order.status == "deposit_paid").scalar() or 0
    awaiting_balance = db.query(func.count(Order.id)).filter(Order.status == "awaiting_balance").scalar() or 0
    pending = (
        db.query(func.count(Order.id))
        .filter(Order.status.in_(ACTION_STATUSES))
        .scalar()
        or 0
    )

    unread_threads = (
        db.query(func.count(CommissionThread.id))
        .filter(CommissionThread.unread_admin > 0)
        .scalar()
        or 0
    )
    unread_users = (
        db.query(func.count(func.distinct(CommissionThread.user_id)))
        .filter(CommissionThread.unread_admin > 0)
        .scalar()
        or 0
    )
    oldest_unread = (
        db.query(CommissionThread.last_at, CommissionThread.updated_at)
        .filter(CommissionThread.unread_admin > 0)
        .order_by(CommissionThread.last_at.is_(None), CommissionThread.last_at.asc())
        .first()
    )
    unread_hint = "目前没有未读"
    if oldest_unread:
        unread_hint = _ago_hint(oldest_unread[0] or oldest_unread[1])

    users = db.query(User).filter(User.role != "admin").count()
    products_on = db.query(Product).filter(Product.status == "on").count()
    deliveries = db.query(Delivery).count()

    recent = (
        db.query(Order)
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc())
        .limit(8)
        .all()
    )

    sys = load_settings(db)["sys"]
    mail_ok = bool(sys.mail.enabled)
    db_name, db_size = _db_size_label()

    return DashboardOut(
        today_orders=int(today_orders),
        yesterday_orders=int(yesterday_orders),
        today_revenue=today_revenue,
        yesterday_revenue=yesterday_revenue,
        pending=int(pending),
        pending_overdue=int(pending_overdue),
        unread_threads=int(unread_threads),
        unread_users=int(unread_users),
        users=int(users),
        products_on=int(products_on),
        deliveries=int(deliveries),
        recent_orders=[_order_brief(o) for o in recent],
        trend=_build_trend(order_days, revenue_days, today),
        todos=_build_todos(
            awaiting_balance=int(awaiting_balance),
            unread_threads=int(unread_threads),
            unread_hint=unread_hint,
            pending_pay=int(pending_pay),
            deposit_paid=int(deposit_paid),
        ),
        conversations=_build_conversations(db),
        system=DashboardSystemOut(
            payments=_payment_label(db),
            mail_ok=mail_ok,
            mail_label="腾讯云 SES" if mail_ok else "未开启",
            db_name=db_name,
            db_size=db_size,
            users=int(users),
            products_on=int(products_on),
        ),
    )
