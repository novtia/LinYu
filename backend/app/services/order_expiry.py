"""未支付订单超过 24 小时后整单删除，以及手动整单级联删除清理。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, selectinload

from ..models import (
    CommissionMessage,
    CommissionThread,
    Delivery,
    DeliveryFile,
    Order,
    OrderItem,
    OrderPayment,
    Product,
    ProductFile,
    ReadingBookmark,
    ReadingProgress,
    UsdtInvoice,
)
from .commission import is_commission_mode
from .files import delete_stored

logger = logging.getLogger("lingxia.orders")

UNPAID_TTL = timedelta(hours=24)
# 这些状态说明钱已经进来过，不能因为下单时间早被清掉
PAID_STATUSES = {"paid", "completed", "deposit_paid", "awaiting_balance"}


def _as_utc_naive(value) -> datetime | None:
    """库里的旧单有的是无时区时间，有的是带时区的字符串。一律折成 UTC 再比。"""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            value = datetime.fromisoformat(normalized)
        except ValueError:
            parsed = None
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    parsed = datetime.strptime(text[:26], fmt)
                    break
                except ValueError:
                    continue
            if parsed is None:
                return None
            value = parsed
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def order_took_money(order: Order) -> bool:
    if (order.status or "") in PAID_STATUSES:
        return True
    if order.paid_at:
        return True
    for pay in order.payments or []:
        if (pay.status or "") == "paid":
            return True
    return False


def _chat_upload(path: str | None) -> bool:
    if not path:
        return False
    norm = path.replace("\\", "/").lstrip("/")
    return norm.startswith("chat/") or norm.startswith("uploads/chat/")


def delete_orders(db: Session, order_ids: list[str]) -> int:
    """整单级联删除指定订单，并清理关联对话、发放记录、支付单及约稿专属附件。"""
    ids = list(dict.fromkeys(oid.strip() for oid in order_ids if oid and oid.strip()))
    if not ids:
        return 0

    orders = db.query(Order).filter(Order.id.in_(ids)).all()
    if not orders:
        return 0

    existing_ids = [o.id for o in orders]
    commission_ids = {o.id for o in orders if is_commission_mode(getattr(o, "sale_mode", None))}

    threads = db.query(CommissionThread).filter(CommissionThread.order_id.in_(existing_ids)).all()
    thread_ids = [thread.id for thread in threads]
    if thread_ids:
        messages = db.query(CommissionMessage).filter(CommissionMessage.thread_id.in_(thread_ids)).all()
        for message in messages:
            if _chat_upload(message.file_path):
                delete_stored(message.file_path)
        db.query(CommissionMessage).filter(CommissionMessage.thread_id.in_(thread_ids)).delete(synchronize_session=False)
        db.query(CommissionThread).filter(CommissionThread.id.in_(thread_ids)).delete(synchronize_session=False)

    deliveries = db.query(Delivery).filter(Delivery.order_id.in_(existing_ids)).all()
    delivery_ids = [d.id for d in deliveries]
    commission_delivery_ids = {d.id for d in deliveries if d.order_id in commission_ids}

    if delivery_ids:
        delivery_files = db.query(DeliveryFile).filter(DeliveryFile.delivery_id.in_(delivery_ids)).all()
        file_ids = [df.id for df in delivery_files]
        if file_ids:
            db.query(ReadingProgress).filter(ReadingProgress.file_id.in_(file_ids)).delete(synchronize_session=False)
            db.query(ReadingBookmark).filter(ReadingBookmark.file_id.in_(file_ids)).delete(synchronize_session=False)

        # 仅删除约稿订单专属上传的稿件文件；成品订单文件引用自商品库，绝不删除
        candidate_paths = {
            df.file_path
            for df in delivery_files
            if df.delivery_id in commission_delivery_ids and df.file_path
        } | {
            d.file_path
            for d in deliveries
            if d.id in commission_delivery_ids and d.file_path
        }
        if candidate_paths:
            shared_pf = {
                row[0]
                for row in db.query(ProductFile.file_path).filter(ProductFile.file_path.in_(candidate_paths)).all()
            }
            shared_prod = {
                row[0]
                for row in db.query(Product.file_path).filter(Product.file_path.in_(candidate_paths)).all()
            }
            for path in candidate_paths - shared_pf - shared_prod:
                delete_stored(path)

        db.query(DeliveryFile).filter(DeliveryFile.delivery_id.in_(delivery_ids)).delete(synchronize_session=False)

    db.query(Delivery).filter(Delivery.order_id.in_(existing_ids)).delete(synchronize_session=False)
    db.query(UsdtInvoice).filter(UsdtInvoice.order_id.in_(existing_ids)).delete(synchronize_session=False)
    db.query(OrderPayment).filter(OrderPayment.order_id.in_(existing_ids)).delete(synchronize_session=False)
    db.query(OrderItem).filter(OrderItem.order_id.in_(existing_ids)).delete(synchronize_session=False)
    deleted = db.query(Order).filter(Order.id.in_(existing_ids)).delete(synchronize_session=False)
    db.commit()
    return int(deleted or len(existing_ids))


def purge_expired_unpaid_orders(db: Session, *, now: datetime | None = None) -> int:
    """删掉超过 24 小时仍未入账的订单，连带支付单、发放记录和挂在这笔上的对话。"""
    moment = now or datetime.utcnow()
    cutoff = moment - UNPAID_TTL
    rows = (
        db.query(Order)
        .options(selectinload(Order.payments))
        .all()
    )
    doomed: list[Order] = []
    for order in rows:
        if order_took_money(order):
            continue
        created = _as_utc_naive(order.created_at)
        # 没有时间的旧单无法证明还在 24 小时内，按已过期处理
        if created is not None and created >= cutoff:
            continue
        doomed.append(order)
    if not doomed:
        return 0

    count = delete_orders(db, [order.id for order in doomed])
    logger.info("已清除超过 24 小时未支付的订单 %s 笔", count)
    return count
