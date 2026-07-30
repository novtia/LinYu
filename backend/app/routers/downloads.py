from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Delivery, Order, User
from ..services.files import resolve_stored_path

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


@router.get("/{delivery_id}")
def download_delivery_file(
    delivery_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery or not delivery.file_path:
        raise HTTPException(status_code=404, detail="下载不存在")

    order = db.query(Order).filter(Order.id == delivery.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if user.role != "admin" and order.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权下载该文件")

    try:
        path = resolve_stored_path(delivery.file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")

    filename = delivery.file_name or path.name
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type="application/octet-stream",
    )
