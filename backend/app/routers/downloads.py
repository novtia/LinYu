from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_optional_user
from ..models import Delivery, DeliveryFile, Order, User
from ..services.commission import is_commission_mode
from ..services.files import image_media_type, is_image_name, resolve_stored_path
from .orders import _can_access_order, _deny_order_access

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


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
