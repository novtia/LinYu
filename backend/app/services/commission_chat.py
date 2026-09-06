from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..models import CommissionMessage, CommissionThread, Order, OrderItem, Product, User
from ..schemas import CommissionMessageOut, CommissionThreadOut
from ..services.commission import format_words, format_yuan_text, is_commission_mode, split_price
from ..services.delivery import random_id

RECALL_SECONDS = 600
PREVIEW_LEN = 48


def _preview(msg_type: str, body: str, file_name: Optional[str]) -> str:
    if msg_type == "image":
        return "[图片]"
    if msg_type == "file":
        return file_name or "[文件]"
    if msg_type == "delivery":
        return "[稿件已发货]"
    if msg_type == "emoji":
        return (body or "").strip() or "[表情]"
    text = (body or "").replace("\n", " ").strip()
    if not text:
        return "…"
    return text[:PREVIEW_LEN]


def _new_thread(user_id: str, product_id: int, order_id: Optional[str] = None) -> CommissionThread:
    now = datetime.utcnow()
    return CommissionThread(
        id="ct_" + random_id(length=10),
        user_id=user_id,
        product_id=product_id,
        order_id=order_id,
        created_at=now,
        updated_at=now,
    )


def get_or_create_thread(
    db: Session,
    user_id: str,
    product_id: int,
    order_id: Optional[str] = None,
) -> CommissionThread:
    if order_id:
        thread = db.query(CommissionThread).filter(CommissionThread.order_id == order_id).first()
        if thread:
            return thread
        thread = _new_thread(user_id, product_id, order_id)
        db.add(thread)
        db.flush()
        return thread

    thread = (
        db.query(CommissionThread)
        .filter(
            CommissionThread.user_id == user_id,
            CommissionThread.product_id == product_id,
            CommissionThread.order_id.is_(None),
        )
        .order_by(CommissionThread.updated_at.desc())
        .first()
    )
    if thread:
        return thread
    thread = _new_thread(user_id, product_id)
    db.add(thread)
    db.flush()
    return thread


def ensure_thread_for_order(db: Session, order: Order) -> Optional[CommissionThread]:
    if not order.user_id or not is_commission_mode(getattr(order, "sale_mode", None)):
        return None
    items = list(order.items or [])
    if not items:
        items = db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    if not items:
        return None
    return get_or_create_thread(db, order.user_id, items[0].product_id, order.id)


def refresh_thread_preview(db: Session, thread: CommissionThread) -> None:
    last = (
        db.query(CommissionMessage)
        .filter(CommissionMessage.thread_id == thread.id, CommissionMessage.recalled_at.is_(None))
        .order_by(CommissionMessage.id.desc())
        .first()
    )
    if not last:
        thread.last_preview = "还没有消息"
        thread.last_kind = None
        return
    thread.last_preview = _preview(last.type, last.body, last.file_name)
    thread.last_at = last.created_at
    thread.last_kind = last.type


def add_message(
    db: Session,
    thread: CommissionThread,
    *,
    role: str,
    msg_type: str,
    body: str = "",
    file_path: Optional[str] = None,
    file_name: Optional[str] = None,
    file_size: Optional[int] = None,
) -> CommissionMessage:
    now = datetime.utcnow()
    msg = CommissionMessage(
        thread_id=thread.id,
        role=role,
        type=msg_type,
        body=body or "",
        file_path=file_path,
        file_name=file_name,
        file_size=file_size,
        created_at=now,
    )
    db.add(msg)
    db.flush()
    thread.last_preview = _preview(msg_type, body, file_name)
    thread.last_at = now
    thread.last_kind = msg_type
    thread.updated_at = now
    if role == "user":
        thread.unread_admin = int(thread.unread_admin or 0) + 1
    elif role == "admin":
        thread.unread_user = int(thread.unread_user or 0) + 1
    else:
        # 系统通知只提醒作者；买家自己触发的定金等不必再亮红点
        thread.unread_admin = int(thread.unread_admin or 0) + 1
    return msg


def notify_deposit_paid(db: Session, order: Order) -> None:
    if not order.user_id:
        return
    items = list(order.items or [])
    if not items:
        items = db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    if not items:
        return
    product_id = items[0].product_id
    thread = get_or_create_thread(db, order.user_id, product_id, order.id)
    deposit, _ = split_price(order.total)
    words = int(order.word_count or 0)
    text = f"已支付定金 {format_yuan_text(deposit)}"
    if words:
        text += f" · {format_words(words)}"
    since = datetime.utcnow() - timedelta(minutes=2)
    dup = (
        db.query(CommissionMessage)
        .filter(
            CommissionMessage.thread_id == thread.id,
            CommissionMessage.type == "system",
            CommissionMessage.body == text,
            CommissionMessage.created_at >= since,
        )
        .first()
    )
    if not dup:
        add_message(db, thread, role="system", msg_type="system", body=text)
    db.commit()


def can_recall(msg: CommissionMessage, role: str, now: Optional[datetime] = None) -> bool:
    now = now or datetime.utcnow()
    if msg.recalled_at or msg.role == "system" or msg.type in ("system", "delivery") or msg.role != role:
        return False
    return (now - (msg.created_at or now)).total_seconds() <= RECALL_SECONDS


def message_out(msg: CommissionMessage, *, viewer_role: str, now: Optional[datetime] = None) -> CommissionMessageOut:
    now = now or datetime.utcnow()
    recalled = msg.recalled_at is not None
    delivery = msg.type == "delivery"
    return CommissionMessageOut(
        id=msg.id,
        role=msg.role,
        type=msg.type,
        body="" if recalled else (msg.body or ""),
        file_name=None if recalled or delivery else msg.file_name,
        file_size=None if recalled or delivery else msg.file_size,
        file_url=None if recalled or delivery or not msg.file_path else f"/api/commission/files/{msg.id}",
        created_at=msg.created_at,
        recalled_at=msg.recalled_at,
        can_recall=can_recall(msg, viewer_role, now),
    )


def _thread_out_from(
    thread: CommissionThread,
    *,
    user: Optional[User],
    product: Optional[Product],
    order: Optional[Order],
) -> CommissionThreadOut:
    status = order.status if order else None
    deposit_amount = balance_amount = None
    if order:
        deposit_amount, balance_amount = split_price(order.total)
    return CommissionThreadOut(
        id=thread.id,
        user_id=thread.user_id,
        username=user.username if user else "用户",
        product_id=thread.product_id,
        product_name=product.name if product else "约稿",
        order_id=thread.order_id,
        unread_admin=int(thread.unread_admin or 0),
        unread_user=int(thread.unread_user or 0),
        last_preview=thread.last_preview,
        last_at=thread.last_at,
        last_kind=thread.last_kind,
        has_deposit=bool(status in ("deposit_paid", "awaiting_balance", "completed")),
        order_status=status,
        word_count=order.word_count if order else None,
        deposit_amount=deposit_amount,
        balance_amount=balance_amount,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
    )


def _order_for_thread(db: Session, thread: CommissionThread) -> Optional[Order]:
    if thread.order_id:
        return db.query(Order).filter(Order.id == thread.order_id).first()
    return None


def thread_out(db: Session, thread: CommissionThread, *, user: Optional[User] = None, product: Optional[Product] = None) -> CommissionThreadOut:
    if user is None:
        user = db.query(User).filter(User.id == thread.user_id).first()
    if product is None:
        product = db.query(Product).filter(Product.id == thread.product_id).first()
    order = _order_for_thread(db, thread)
    return _thread_out_from(thread, user=user, product=product, order=order)


def thread_out_many(db: Session, threads: list[CommissionThread]) -> list[CommissionThreadOut]:
    if not threads:
        return []
    user_ids = {t.user_id for t in threads}
    product_ids = {t.product_id for t in threads}
    order_ids = {t.order_id for t in threads if t.order_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()}
    orders = {o.id: o for o in db.query(Order).filter(Order.id.in_(order_ids)).all()} if order_ids else {}
    return [
        _thread_out_from(
            t,
            user=users.get(t.user_id),
            product=products.get(t.product_id),
            order=orders.get(t.order_id) if t.order_id else None,
        )
        for t in threads
    ]


def assert_commission_product(product: Optional[Product]) -> Product:
    from fastapi import HTTPException

    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    if not is_commission_mode(getattr(product, "sale_mode", None)):
        raise HTTPException(status_code=400, detail="该商品不支持约稿对话")
    return product
