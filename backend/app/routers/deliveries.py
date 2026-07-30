from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user
from ..models import Delivery, User
from ..schemas import DeliveryOut

router = APIRouter(prefix="/api/deliveries", tags=["deliveries"])


def _out(d: Delivery) -> DeliveryOut:
    return DeliveryOut(
        id=d.id,
        order_id=d.order_id,
        product_id=d.product_id,
        product_name=d.product_name,
        payload=d.payload,
        file_name=d.file_name,
        download_url=f"/api/downloads/{d.id}" if d.file_path else None,
        created_at=d.created_at,
    )


@router.get("", response_model=List[DeliveryOut])
def list_deliveries(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    rows = db.query(Delivery).order_by(Delivery.created_at.desc()).all()
    return [_out(d) for d in rows]
