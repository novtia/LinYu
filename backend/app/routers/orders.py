from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user, get_current_user
from ..models import Delivery, Order, OrderItem, Product, User
from ..schemas import CheckoutIn, CheckoutOut, DeliveryOut, OrderItemOut, OrderOut
from ..seed import load_settings
from ..services.delivery import generate_payload, random_id

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _delivery_out(d: Delivery) -> DeliveryOut:
    download_url = f"/api/downloads/{d.id}" if d.file_path else None
    return DeliveryOut(
        id=d.id,
        order_id=d.order_id,
        product_id=d.product_id,
        product_name=d.product_name,
        payload=d.payload,
        file_name=d.file_name,
        download_url=download_url,
        created_at=d.created_at,
    )


def _order_out(order: Order, include_payload: bool = False) -> OrderOut:
    delivery_by_product = {}
    if include_payload:
        for d in order.deliveries:
            delivery_by_product[d.product_id] = d
    items = []
    for it in order.items:
        d = delivery_by_product.get(it.product_id)
        payload = None
        file_name = None
        download_url = None
        if include_payload and d:
            payload = d.payload
            file_name = d.file_name
            if d.file_path:
                download_url = f"/api/downloads/{d.id}"
        items.append(
            OrderItemOut(
                product_id=it.product_id,
                name=it.name,
                price=it.price,
                payload=payload,
                file_name=file_name,
                download_url=download_url,
            )
        )
    return OrderOut(
        id=order.id,
        username=order.username,
        total=order.total,
        status=order.status,
        created_at=order.created_at,
        items=items,
    )


@router.post("/checkout", response_model=CheckoutOut)
def checkout(
    body: CheckoutIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = load_settings(db)
    if settings["sys"].maintain:
        raise HTTPException(status_code=400, detail="站点维护中，暂停下单")

    order_id = "LX" + str(int(datetime.utcnow().timestamp() * 1000))
    total = sum(it.price for it in body.items)
    order = Order(
        id=order_id,
        user_id=user.id,
        username=user.username,
        total=total,
        status="completed",
        created_at=datetime.utcnow(),
    )
    db.add(order)

    deliveries = []
    for it in body.items:
        db.add(
            OrderItem(
                order_id=order_id,
                product_id=it.id,
                name=it.name,
                price=it.price,
            )
        )
        product = db.query(Product).filter(Product.id == it.id).first()
        ptype = product.type if product else "key"
        payload = generate_payload(product, it.id, ptype)
        file_path = None
        file_name = None
        if product and product.type == "file" and product.file_path:
            file_path = product.file_path
            file_name = product.file_name
            payload = file_name or "下载文件"
        if settings["sys"].autoDeliver:
            delivery = Delivery(
                id="d_" + random_id(),
                order_id=order_id,
                product_id=it.id,
                product_name=it.name,
                payload=payload,
                file_path=file_path,
                file_name=file_name,
                created_at=datetime.utcnow(),
            )
            db.add(delivery)
            deliveries.append(delivery)

    db.commit()
    db.refresh(order)
    for d in deliveries:
        db.refresh(d)

    return CheckoutOut(
        order=_order_out(order, include_payload=True),
        deliveries=[_delivery_out(d) for d in deliveries],
    )


@router.get("/mine", response_model=List[OrderOut])
def my_orders(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    orders = (
        db.query(Order)
        .filter(Order.user_id == user.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    return [_order_out(o, include_payload=True) for o in orders]


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if user.role != "admin" and order.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权查看该订单")
    return _order_out(order, include_payload=True)


@router.get("", response_model=List[OrderOut])
def admin_orders(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    orders = db.query(Order).order_by(Order.created_at.desc()).all()
    return [_order_out(o, include_payload=False) for o in orders]
