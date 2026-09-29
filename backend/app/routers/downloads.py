from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_optional_user
from ..models import CommissionMessage, CommissionThread, Delivery, DeliveryFile, Order, User
from ..services.commission import is_commission_mode
from ..services.download_tickets import get_ticket, issue_ticket
from ..services.files import image_media_type, is_image_name, resolve_stored_path
from .orders import _can_access_order, _deny_order_access

router = APIRouter(prefix="/api/downloads", tags=["downloads"])

_FILES_RE = re.compile(r"^/api/downloads/files/([^/]+)$")
_CHAT_RE = re.compile(r"^/api/commission/files/(\d+)$")
_DELIVERY_RE = re.compile(r"^/api/downloads/([^/]+)$")


class DownloadTicketIn(BaseModel):
    url: str = Field(min_length=1, max_length=512)
    filename: Optional[str] = Field(default=None, max_length=255)
    email: str = ""


class DownloadTicketOut(BaseModel):
    url: str


def _file_response(path, filename: str, *, inline: bool) -> FileResponse:
    use_inline = inline and is_image_name(filename)
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type=image_media_type(filename) if use_inline else "application/octet-stream",
        content_disposition_type="inline" if use_inline else "attachment",
    )


def _assert_download_access(order: Order, user: Optional[User], email: str) -> None:
    if not _can_access_order(order, user, email):
        _deny_order_access(user, email, action="下载")
    if user and user.role == "admin":
        return
    if is_commission_mode(order.sale_mode):
        if order.status != "completed":
            raise HTTPException(status_code=403, detail="请先支付尾款后再下载")
        return
    if order.status not in ("paid", "completed"):
        raise HTTPException(status_code=403, detail="订单未完成支付")


@router.get("/files/{file_id}")
def download_delivery_file_item(
    file_id: str,
    email: str = Query(default=""),
    inline: bool = Query(default=False),
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(DeliveryFile)
        .options(joinedload(DeliveryFile.delivery))
        .filter(DeliveryFile.id == file_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="下载不存在")
    delivery = row.delivery
    order = db.query(Order).filter(Order.id == delivery.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    _assert_download_access(order, user, email)
    try:
        path = resolve_stored_path(row.file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")
    return _file_response(path, row.file_name or path.name, inline=inline)


def _ticket_path(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="下载地址无效")
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail="下载地址无效")
        path = parsed.path or ""
    else:
        path = raw.split("?", 1)[0]
    path = path.strip()
    if not path.startswith("/api/"):
        raise HTTPException(status_code=400, detail="下载地址无效")
    return path


def _resolve_authorized_file(
    db: Session,
    path: str,
    user: Optional[User],
    email: str,
) -> tuple[str, str]:
    hit = _FILES_RE.match(path)
    if hit:
        row = (
            db.query(DeliveryFile)
            .options(joinedload(DeliveryFile.delivery))
            .filter(DeliveryFile.id == hit.group(1))
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="下载不存在")
        delivery = row.delivery
        order = db.query(Order).filter(Order.id == delivery.order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="订单不存在")
        _assert_download_access(order, user, email)
        stored = resolve_stored_path(row.file_path)
        return row.file_path, row.file_name or stored.name

    chat = _CHAT_RE.match(path)
    if chat:
        if not user:
            raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
        msg = db.query(CommissionMessage).filter(CommissionMessage.id == int(chat.group(1))).first()
        if not msg or not msg.file_path:
            raise HTTPException(status_code=404, detail="文件不存在")
        thread = db.query(CommissionThread).filter(CommissionThread.id == msg.thread_id).first()
        if not thread:
            raise HTTPException(status_code=404, detail="对话不存在")
        if user.role != "admin" and thread.user_id != user.id:
            raise HTTPException(status_code=403, detail="无权查看该对话")
        if msg.recalled_at:
            raise HTTPException(status_code=404, detail="文件已撤回")
        stored = resolve_stored_path(msg.file_path)
        return msg.file_path, msg.file_name or stored.name

    delivery_hit = _DELIVERY_RE.match(path)
    if delivery_hit and delivery_hit.group(1) not in {"files", "tickets"}:
        delivery = (
            db.query(Delivery)
            .options(joinedload(Delivery.files))
            .filter(Delivery.id == delivery_hit.group(1))
            .first()
        )
        file_path = delivery.file_path if delivery else None
        file_name = delivery.file_name if delivery else None
        if delivery and not file_path and delivery.files:
            file_path = delivery.files[0].file_path
            file_name = delivery.files[0].file_name
        if not delivery or not file_path:
            raise HTTPException(status_code=404, detail="下载不存在")
        order = db.query(Order).filter(Order.id == delivery.order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="订单不存在")
        _assert_download_access(order, user, email)
        stored = resolve_stored_path(file_path)
        return file_path, file_name or stored.name

    raise HTTPException(status_code=400, detail="下载地址无效")


@router.post("/tickets", response_model=DownloadTicketOut)
def create_download_ticket(
    body: DownloadTicketIn,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    path = _ticket_path(body.url)
    try:
        stored, filename = _resolve_authorized_file(db, path, user, (body.email or "").strip())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")
    token = issue_ticket(stored, (body.filename or "").strip() or filename)
    return DownloadTicketOut(url=f"/api/downloads/tickets/{token}")


@router.get("/tickets/{token}")
def redeem_download_ticket(token: str):
    row = get_ticket(token)
    if not row:
        raise HTTPException(status_code=404, detail="下载链接已失效，请重试")
    try:
        path = resolve_stored_path(row.path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(
        path=str(path),
        filename=row.filename,
        media_type="application/octet-stream",
        content_disposition_type="attachment",
    )


@router.get("/{delivery_id}")
def download_delivery_file(
    delivery_id: str,
    email: str = Query(default=""),
    inline: bool = Query(default=False),
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    delivery = (
        db.query(Delivery)
        .options(joinedload(Delivery.files))
        .filter(Delivery.id == delivery_id)
        .first()
    )
    file_path = delivery.file_path if delivery else None
    file_name = delivery.file_name if delivery else None
    if delivery and not file_path and delivery.files:
        file_path = delivery.files[0].file_path
        file_name = delivery.files[0].file_name
    if not delivery or not file_path:
        raise HTTPException(status_code=404, detail="下载不存在")

    order = db.query(Order).filter(Order.id == delivery.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    _assert_download_access(order, user, email)

    try:
        path = resolve_stored_path(file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")

    return _file_response(path, file_name or path.name, inline=inline)
