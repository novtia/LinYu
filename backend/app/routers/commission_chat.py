from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_admin_user, get_current_user
from ..models import CommissionMessage, CommissionThread, Delivery, Order, OrderItem, Product, User
from ..schemas import (
    CommissionMessageIn,
    CommissionMessageOut,
    CommissionMessagesOut,
    CommissionThreadListOut,
    CommissionThreadOut,
)
from ..services.commission import is_commission_mode, split_price
from ..services.chat_push import emit_message, emit_read, emit_recalls
from ..services.commission_chat import (
    add_message,
    assert_commission_product,
    get_or_create_thread,
    message_out,
    parse_delivery_body,
    recall_unused_delivery_notices,
    refresh_thread_preview,
    thread_out,
    thread_out_many,
)
from ..services.files import image_media_type, is_image_name, resolve_stored_path, save_chat_upload, save_upload
from ..services.fulfillment import add_commission_file, delivery_files_for_meta, remove_commission_file_rows
from ..services.ratelimit import limit_or_raise

router = APIRouter(prefix="/api/commission", tags=["commission"])

ALLOWED_TYPES = {"text", "emoji"}
PAGE_SIZE = 80


def _get_thread(db: Session, thread_id: str) -> CommissionThread:
    thread = db.query(CommissionThread).filter(CommissionThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="对话不存在")
    return thread


def _assert_access(thread: CommissionThread, user: User, viewer: Optional[str] = None) -> str:
    want_admin = (viewer or "").strip().lower() == "admin"
    if user.role == "admin" and want_admin:
        return "admin"
    if thread.user_id == user.id:
        return "user"
    if user.role == "admin":
        return "admin"
    raise HTTPException(status_code=403, detail="无权查看该对话")


def _mark_read(thread: CommissionThread, role: str) -> None:
    if role == "admin":
        thread.unread_admin = 0
    else:
        thread.unread_user = 0


def _order_status(db: Session, thread: CommissionThread) -> Optional[str]:
    if not thread.order_id:
        return None
    status = db.query(Order.status).filter(Order.id == thread.order_id).scalar()
    return str(status) if status else None


def _load_order_for_delivery(db: Session, order_id: str) -> Order:
    order = (
        db.query(Order)
        .options(selectinload(Order.items), selectinload(Order.deliveries).selectinload(Delivery.files))
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


@router.get("/threads/mine", response_model=CommissionThreadListOut)
def my_threads(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(CommissionThread)
        .filter(CommissionThread.user_id == user.id)
        .order_by(CommissionThread.updated_at.desc())
        .all()
    )
    items = thread_out_many(db, rows)
    return CommissionThreadListOut(items=items, total=len(items))


@router.get("/threads/mine/product/{product_id}", response_model=CommissionThreadOut)
def my_thread_for_product(
    product_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """商品页全局对话：只跟用户+商品走，不绑定任何订单。"""
    product = db.query(Product).filter(Product.id == product_id).first()
    assert_commission_product(product)
    thread = get_or_create_thread(db, user.id, product_id)
    db.commit()
    db.refresh(thread)
    return thread_out(db, thread, user=user, product=product)


@router.get("/threads/mine/{order_id}", response_model=CommissionThreadOut)
def my_thread_for_order(
    order_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.query(Order).options(selectinload(Order.items)).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if user.role != "admin" and order.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权查看该对话")
    if not is_commission_mode(getattr(order, "sale_mode", None)):
        raise HTTPException(status_code=400, detail="该订单不是约稿订单")
    items = list(order.items or []) or db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    if not items:
        raise HTTPException(status_code=400, detail="订单没有商品")
    thread = get_or_create_thread(db, order.user_id or user.id, items[0].product_id, order.id)
    db.commit()
    db.refresh(thread)
    return thread_out(db, thread, user=user)


@router.get("/threads", response_model=CommissionThreadListOut)
def admin_threads(
    q: str = Query(default=""),
    filter: str = Query(default="all"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    query = db.query(CommissionThread)
    if filter == "unread":
        query = query.filter(CommissionThread.unread_admin > 0)
    keyword = (q or "").strip()
    if keyword:
        users = db.query(User.id).filter(or_(User.username.contains(keyword), User.email.contains(keyword)))
        products = db.query(Product.id).filter(Product.name.contains(keyword))
        query = query.filter(
            or_(
                CommissionThread.user_id.in_(users),
                CommissionThread.product_id.in_(products),
                CommissionThread.order_id.contains(keyword),
                CommissionThread.last_preview.contains(keyword),
            )
        )
    rows = query.order_by(CommissionThread.updated_at.desc()).all()
    items = thread_out_many(db, rows)
    if filter == "deposit":
        items = [t for t in items if t.has_deposit]
    total = len(items)
    return CommissionThreadListOut(items=items[offset : offset + limit], total=total)


@router.get("/threads/{thread_id}", response_model=CommissionThreadOut)
def get_thread(
    thread_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_thread(db, thread_id)
    _assert_access(thread, user)
    return thread_out(db, thread)


@router.get("/threads/{thread_id}/messages", response_model=CommissionMessagesOut)
def list_messages(
    thread_id: str,
    after_id: int = Query(default=0, ge=0),
    before_id: int = Query(default=0, ge=0),
    limit: int = Query(default=PAGE_SIZE, ge=1, le=PAGE_SIZE),
    viewer: Optional[str] = Query(default=None),
    mark_read: bool = Query(default=True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_thread(db, thread_id)
    role = _assert_access(thread, user, viewer)
    now = datetime.utcnow()
    q = db.query(CommissionMessage).filter(CommissionMessage.thread_id == thread.id)
    has_more = False
    if after_id:
        rows = q.filter(CommissionMessage.id > after_id).order_by(CommissionMessage.id.asc()).limit(limit).all()
        extra = (
            q.filter(
                CommissionMessage.id <= after_id,
                CommissionMessage.recalled_at.isnot(None),
            )
            .order_by(CommissionMessage.recalled_at.desc())
            .limit(50)
            .all()
        )
        seen = {m.id for m in rows}
        for m in extra:
            if m.id not in seen:
                rows.append(m)
        rows.sort(key=lambda m: m.id)
    elif before_id:
        rows = q.filter(CommissionMessage.id < before_id).order_by(CommissionMessage.id.desc()).limit(limit).all()
        has_more = len(rows) >= limit
        rows.reverse()
    else:
        rows = q.order_by(CommissionMessage.id.desc()).limit(limit).all()
        has_more = len(rows) >= limit
        rows.reverse()
    unread_before = int(thread.unread_admin if role == "admin" else thread.unread_user)
    if mark_read:
        _mark_read(thread, role)
        db.commit()
        if unread_before:
            emit_read(db, thread, role)
    unread = int(thread.unread_admin if role == "admin" else thread.unread_user)
    status = _order_status(db, thread)
    return CommissionMessagesOut(
        messages=[message_out(m, viewer_role=role, now=now, order_status=status) for m in rows],
        unread=unread,
        has_more=has_more,
        order_status=status,
    )


@router.post("/threads/{thread_id}/messages", response_model=CommissionMessageOut)
def send_message(
    thread_id: str,
    body: CommissionMessageIn,
    viewer: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit_or_raise(f"chat_send:{user.id}", limit=30, window=60)
    thread = _get_thread(db, thread_id)
    role = _assert_access(thread, user, viewer)
    msg_type = (body.type or "text").strip()
    if msg_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="不支持的消息类型")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="请输入内容")
    msg = add_message(db, thread, role=role, msg_type=msg_type, body=text)
    db.commit()
    db.refresh(msg)
    emit_message(db, thread, msg)
    return message_out(msg, viewer_role=role)


@router.post("/threads/{thread_id}/deliver", response_model=CommissionMessageOut)
async def deliver_manuscript(
    thread_id: str,
    files: List[UploadFile] = File(...),
    viewer: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit_or_raise(f"chat_deliver:{user.id}", limit=10, window=60)
    thread = _get_thread(db, thread_id)
    role = _assert_access(thread, user, viewer)
    if role != "admin":
        raise HTTPException(status_code=403, detail="只有作者可以发货")
    if not thread.order_id:
        raise HTTPException(status_code=400, detail="该对话还没有订单，无法发货")
    order = _load_order_for_delivery(db, thread.order_id)
    if not is_commission_mode(getattr(order, "sale_mode", None)):
        raise HTTPException(status_code=400, detail="该订单不是约稿订单")
    if order.status == "completed":
        raise HTTPException(status_code=400, detail="尾款已收，订单已锁定")
    if order.status not in ("deposit_paid", "awaiting_balance"):
        raise HTTPException(status_code=400, detail="请等待买家支付定金后再发货")
    uploads = [f for f in files if f and f.filename]
    if not uploads:
        raise HTTPException(status_code=400, detail="请选择稿件文件")
    file_ids: List[str] = []
    file_names: List[str] = []
    for item in uploads:
        try:
            stored, original = await save_upload(item, order.id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        row = add_commission_file(db, order, stored, original)
        file_ids.append(row.id)
        file_names.append(original)
    _, balance = split_price(order.total)
    msg = add_message(
        db,
        thread,
        role="admin",
        msg_type="delivery",
        body=json.dumps(
            {
                "order_id": order.id,
                "file_count": len(file_ids),
                "balance_amount": balance,
                "file_ids": file_ids,
                "file_names": file_names,
            },
            ensure_ascii=False,
        ),
    )
    db.commit()
    db.refresh(msg)
    db.refresh(order)
    emit_message(db, thread, msg)
    return message_out(msg, viewer_role=role, order_status=order.status)


@router.post("/threads/{thread_id}/messages/upload", response_model=CommissionMessageOut)
async def upload_message(
    thread_id: str,
    file: UploadFile = File(...),
    viewer: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit_or_raise(f"chat_upload:{user.id}", limit=20, window=60)
    thread = _get_thread(db, thread_id)
    role = _assert_access(thread, user, viewer)
    try:
        stored, original, size = await save_chat_upload(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    msg_type = "image" if is_image_name(original) else "file"
    msg = add_message(
        db,
        thread,
        role=role,
        msg_type=msg_type,
        body=original,
        file_path=stored,
        file_name=original,
        file_size=size,
    )
    db.commit()
    db.refresh(msg)
    emit_message(db, thread, msg)
    return message_out(msg, viewer_role=role)


@router.post("/messages/{message_id}/recall", response_model=CommissionMessageOut)
def recall_message(
    message_id: int,
    viewer: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(CommissionMessage).filter(CommissionMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    thread = _get_thread(db, msg.thread_id)
    role = _assert_access(thread, user, viewer)
    if msg.role != role:
        raise HTTPException(status_code=403, detail="只能撤回自己的消息")
    if msg.role == "system" or msg.type == "system":
        raise HTTPException(status_code=400, detail="系统消息不能撤回")
    if msg.recalled_at:
        raise HTTPException(status_code=400, detail="消息已撤回")
    now = datetime.utcnow()
    order_status = _order_status(db, thread)
    if msg.type == "delivery":
        if role != "admin":
            raise HTTPException(status_code=403, detail="只有作者可以撤回发货")
        if not thread.order_id:
            raise HTTPException(status_code=400, detail="该对话没有订单")
        order = _load_order_for_delivery(db, thread.order_id)
        if order.status == "completed":
            raise HTTPException(status_code=400, detail="尾款已收，订单已锁定，不能撤回发货")
        meta = parse_delivery_body(msg.body)
        remove_commission_file_rows(db, order, delivery_files_for_meta(order, meta))
        msg.recalled_at = now
        extra = recall_unused_delivery_notices(db, order, notify_user=False)
        refresh_thread_preview(db, thread)
        thread.updated_at = now
        thread.unread_user = int(thread.unread_user or 0) + 1
        db.commit()
        db.refresh(msg)
        db.refresh(order)
        seen = {msg.id}
        recalled = [msg] + [m for m in extra if m.id not in seen]
        emit_recalls(db, thread, recalled)
        return message_out(msg, viewer_role=role, order_status=order.status)
    if (now - (msg.created_at or now)).total_seconds() > 600:
        raise HTTPException(status_code=400, detail="已超过 10 分钟，不能撤回")
    msg.recalled_at = now
    refresh_thread_preview(db, thread)
    thread.updated_at = now
    db.commit()
    db.refresh(msg)
    emit_recalls(db, thread, [msg])
    return message_out(msg, viewer_role=role, order_status=order_status)


@router.get("/files/{message_id}")
def download_chat_file(
    message_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(CommissionMessage).filter(CommissionMessage.id == message_id).first()
    if not msg or not msg.file_path:
        raise HTTPException(status_code=404, detail="文件不存在")
    thread = _get_thread(db, msg.thread_id)
    _assert_access(thread, user)
    if msg.recalled_at:
        raise HTTPException(status_code=404, detail="文件已撤回")
    try:
        path = resolve_stored_path(msg.file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")
    filename = msg.file_name or path.name
    inline = is_image_name(filename)
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type=image_media_type(filename) if inline else "application/octet-stream",
        content_disposition_type="inline" if inline else "attachment",
    )
