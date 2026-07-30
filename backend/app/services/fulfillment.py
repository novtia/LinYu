from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Delivery, Order, Product
from ..seed import load_settings
from .delivery import generate_payload, random_id


def fulfill_order(db: Session, order: Order, *, trade_no: Optional[str] = None) -> List[Delivery]:
    """支付成功后发货（幂等）。返回本次关联的发放记录。"""
    if trade_no and not order.trade_no:
        order.trade_no = trade_no

    if order.status in ("completed", "paid") and order.deliveries:
        if order.status == "paid" and order.deliveries:
            order.status = "completed"
            db.commit()
        return list(order.deliveries)

    if not order.paid_at:
        order.paid_at = datetime.utcnow()

    settings = load_settings(db)
    deliveries: List[Delivery] = []

    if settings["sys"].autoDeliver:
        for it in order.items:
            exists = (
                db.query(Delivery)
                .filter(Delivery.order_id == order.id, Delivery.product_id == it.product_id)
                .first()
            )
            if exists:
                deliveries.append(exists)
                continue

            product = db.query(Product).filter(Product.id == it.product_id).first()
            ptype = product.type if product else "key"
            payload = generate_payload(product, it.product_id, ptype)
            file_path = None
            file_name = None
            if product and product.type == "file" and product.file_path:
                file_path = product.file_path
                file_name = product.file_name
                payload = file_name or "下载文件"

            delivery = Delivery(
                id="d_" + random_id(),
                order_id=order.id,
                product_id=it.product_id,
                product_name=it.name,
                payload=payload,
                file_path=file_path,
                file_name=file_name,
                created_at=datetime.utcnow(),
            )
            db.add(delivery)
            deliveries.append(delivery)
        order.status = "completed"
    else:
        order.status = "paid"

    db.commit()
    for d in deliveries:
        db.refresh(d)
    db.refresh(order)
    return deliveries
