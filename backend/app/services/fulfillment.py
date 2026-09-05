from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from ..models import Delivery, DeliveryFile, Order, Product, ProductFile
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

            product = (
                db.query(Product)
                .options(joinedload(Product.files))
                .filter(Product.id == it.product_id)
                .first()
            )
            payload = (product.delivery_content or "").strip() if product else ""
            paid_files: List[ProductFile] = []
            if product:
                paid_files = sorted(list(product.files or []), key=lambda f: (f.sort_order, f.created_at or datetime.min))
            first_path = paid_files[0].file_path if paid_files else (getattr(product, "file_path", None) if product else None)
            first_name = paid_files[0].file_name if paid_files else (getattr(product, "file_name", None) if product else None)
            if not payload and not first_path:
                payload = "暂无发货内容，请联系客服"

            delivery = Delivery(
                id="d_" + random_id(),
                order_id=order.id,
                product_id=it.product_id,
                product_name=it.name,
                payload=payload,
                file_path=first_path,
                file_name=first_name,
                created_at=datetime.utcnow(),
            )
            db.add(delivery)
            if paid_files:
                for i, pf in enumerate(paid_files):
                    db.add(
                        DeliveryFile(
                            id="df_" + random_id(length=8),
                            delivery_id=delivery.id,
                            file_path=pf.file_path,
                            file_name=pf.file_name,
                            sort_order=i,
                        )
                    )
            elif first_path:
                db.add(
                    DeliveryFile(
                        id="df_" + random_id(length=8),
                        delivery_id=delivery.id,
                        file_path=first_path,
                        file_name=first_name or "已购文件",
                        sort_order=0,
                    )
                )
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
