from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Delivery, Order, Product
from ..seed import load_settings
from .delivery import random_id


def fulfill_order(
    db: Session,
    order: Order,
    *,
    trade_no: Optional[str] = None,
    force: bool = False,
) -> List[Delivery]:
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

    if settings["sys"].autoDeliver or force:
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
            payload = (product.delivery_content or "").strip() if product else ""
            file_path = getattr(product, "file_path", None) if product else None
            if not payload:
                payload = "文件已附在本条发货记录，请点击下载。" if file_path else "暂无发货内容，请联系客服"

            delivery = Delivery(
                id="d_" + random_id(),
                order_id=order.id,
                product_id=it.product_id,
                product_name=it.name,
                payload=payload,
                file_path=file_path,
                file_name=getattr(product, "file_name", None) if product else None,
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

    # 发货完成后发送邮件（失败不影响主流程）
    try:
        from .mail import notify_order_emails

        notify_order_emails(db, order)
    except Exception:
        pass

    return deliveries
