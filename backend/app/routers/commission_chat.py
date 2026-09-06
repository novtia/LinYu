from __future__ import annotations

import json
from datetime import datetime, timedelta
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
from ..services.commission_chat import (
    add_message,
    assert_commission_product,
    get_or_create_thread,
    message_out,
    refresh_thread_preview,
    thread_out,
    thread_out_many,
)
from ..services.files import image_media_type, is_image_name, resolve_stored_path, save_chat_upload, save_upload
from ..services.fulfillment import add_commission_file
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


@router.get("/threads/mine", response_model=CommissionThreadListOut)
def my_threads(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(CommissionThread)
        .filter(CommissionThread.user_id == user.id, CommissionThread.order_id.isnot(None))
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
        recall_since = now - timedelta(minutes=12)
        extra = (
            q.filter(
                CommissionMessage.id <= after_id,
                CommissionMessage.recalled_at.isnot(None),
                CommissionMessage.recalled_at >= recall_since,
            )
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
    if mark_read:
        _mark_read(thread, role)
        db.commit()
    unread = int(thread.unread_admin if role == "admin" else thread.unread_user)
    return CommissionMessagesOut(
        messages=[message_out(m, viewer_role=role, now=now) for m in rows],
        unread=unread,
        has_more=has_more,
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
    order = (
        db.query(Order)
        .options(selectinload(Order.items), selectinload(Order.deliveries).selectinload(Delivery.files))
        .filter(Order.id == thread.order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if not is_commission_mode(getattr(order, "sale_mode", None)):
        raise HTTPException(status_code=400, detail="该订单不是约稿订单")
    if order.status == "completed":
        raise HTTPException(status_code=400, detail="订单已完成，不能再发货")
    if order.status not in ("deposit_paid", "awaiting_balance"):
        raise HTTPException(status_code=400, detail="请等待买家支付定金后再发货")
    uploads = [f for f in files if f and f.filename]
    if not uploads:
        raise HTTPException(status_code=400, detail="请选择稿件文件")
    count = 0
    for item in uploads:
        try:
            stored, original = await save_upload(item, order.id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        add_commission_file(db, order, stored, original)
        count += 1
    _, balance = split_price(order.total)
    msg = add_message(
        db,
        thread,
        role="admin",
        msg_type="delivery",
        body=json.dumps({"order_id": order.id, "file_count": count, "balance_amount": balance}, ensure_ascii=False),
    )
    db.commit()
    db.refresh(msg)
    db.refresh(order)
    return message_out(msg, viewer_role=role)


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
    if (datetime.utcnow() - (msg.created_at or datetime.utcnow())).total_seconds() > 600:
        raise HTTPException(status_code=400, detail="已超过 10 分钟，不能撤回")
    msg.recalled_at = datetime.utcnow()
    refresh_thread_preview(db, thread)
    thread.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)
    return message_out(msg, viewer_role=role)


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
