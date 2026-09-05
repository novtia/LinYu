from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_admin_user
from ..models import Delivery, User
from ..schemas import DeliveryOut, ProductFileItemOut

router = APIRouter(prefix="/api/deliveries", tags=["deliveries"])


def _out(d: Delivery) -> DeliveryOut:
    files = ProductFileItemOut.list_from_delivery(d)
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
    )


@router.get("", response_model=List[DeliveryOut])
def list_deliveries(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Delivery)
        .options(selectinload(Delivery.files))
        .order_by(Delivery.created_at.desc())
        .all()
    )
    return [_out(d) for d in rows]
