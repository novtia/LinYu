from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database import get_db
from ..deps import get_admin_user
from ..models import Delivery, User
from ..schemas import DeliveryOut, ProductFileItemOut
from ..services.commission import SALE_COMMISSION, SALE_NORMAL, is_commission_mode

router = APIRouter(prefix="/api/deliveries", tags=["deliveries"])


def _out(d: Delivery) -> DeliveryOut:
    files = ProductFileItemOut.list_from_delivery(d)
    order = d.order
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
        username=order.username if order else "",
        email=(order.email or "") if order else "",
        sale_mode=SALE_COMMISSION if order and is_commission_mode(order.sale_mode) else SALE_NORMAL,
    )


@router.get("", response_model=List[DeliveryOut])
def list_deliveries(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Delivery)
        .options(selectinload(Delivery.files), joinedload(Delivery.order))
        .order_by(Delivery.created_at.desc())
        .all()
    )
    return [_out(d) for d in rows]
