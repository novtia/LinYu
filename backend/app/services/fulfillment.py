from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from ..models import Delivery, DeliveryFile, Order, Product, ProductFile
from ..seed import load_settings
from .commission import is_commission_mode
from .delivery import random_id
from .files import delete_stored

EMPTY_DELIVERY_NOTE = "暂无发货内容，请联系客服"


def ensure_commission_delivery(db: Session, order: Order) -> Delivery:
    if order.deliveries:
        return order.deliveries[0]
    item = order.items[0] if order.items else None
    delivery = Delivery(
        id="d_" + random_id(),
        order_id=order.id,
        product_id=item.product_id if item else 0,
        product_name=item.name if item else "约稿",
        payload="",
        created_at=datetime.utcnow(),
    )
    db.add(delivery)
    db.flush()
    order.deliveries.append(delivery)
    return delivery


def add_commission_file(db: Session, order: Order, stored: str, original: str) -> DeliveryFile:
    delivery = ensure_commission_delivery(db, order)
    sort_order = max([f.sort_order for f in (delivery.files or [])], default=-1) + 1
    row = DeliveryFile(
        id="df_" + random_id(length=8),
        delivery_id=delivery.id,
        file_path=stored,
        file_name=original,
        sort_order=sort_order,
    )
    db.add(row)
    db.flush()
    if not delivery.file_path:
        delivery.file_path = stored
        delivery.file_name = original
    if order.status == "deposit_paid":
        order.status = "awaiting_balance"
    return row


def sync_commission_delivery_state(order: Order) -> None:
    delivery = order.deliveries[0] if order.deliveries else None
    remaining = list(delivery.files or []) if delivery else []
    if delivery:
        if remaining:
            delivery.file_path = remaining[0].file_path
            delivery.file_name = remaining[0].file_name
        else:
            delivery.file_path = None
            delivery.file_name = None
    if not remaining and order.status == "awaiting_balance":
        order.status = "deposit_paid"


def remove_commission_file_rows(db: Session, order: Order, rows: List[DeliveryFile]) -> int:
    delivery = order.deliveries[0] if order.deliveries else None
    if not delivery or not rows:
        sync_commission_delivery_state(order)
        return 0
    seen: set[str] = set()
    removed = 0
    for row in rows:
        if not row or row.id in seen:
            continue
        seen.add(row.id)
        delete_stored(row.file_path)
        if row in (delivery.files or []):
            delivery.files.remove(row)
        db.delete(row)
        removed += 1
    sync_commission_delivery_state(order)
    return removed


def delivery_files_for_meta(order: Order, meta: dict) -> List[DeliveryFile]:
    delivery = order.deliveries[0] if order.deliveries else None
    if not delivery:
        return []
    files = list(delivery.files or [])
    ids = [str(x) for x in (meta.get("file_ids") or []) if x]
    if ids:
        idset = set(ids)
        return [f for f in files if f.id in idset]
    try:
        count = int(meta.get("file_count") or 0)
    except (TypeError, ValueError):
        count = 0
    if count <= 0:
        return []
    ordered = sorted(files, key=lambda f: (f.sort_order, f.id))
    return ordered[:count]


def remaining_commission_files(order: Order) -> List[DeliveryFile]:
    delivery = order.deliveries[0] if order.deliveries else None
    return list(delivery.files or []) if delivery else []


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
                payload = EMPTY_DELIVERY_NOTE

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


def _product_sources(product: Product) -> tuple[list[tuple[str, str]], str]:
    paid_files = sorted(list(product.files or []), key=lambda f: (f.sort_order, f.created_at or datetime.min))
    sources = [(f.file_path, f.file_name or "已购文件") for f in paid_files if f.file_path]
    legacy = getattr(product, "file_path", None)
    if not sources and legacy:
        sources = [(legacy, getattr(product, "file_name", None) or "已购文件")]
    content = (product.delivery_content or "").strip()
    return sources, content


def replenish_order(db: Session, order: Order) -> int:
    """把商品当前的文件和发货内容补到已支付、但当时没货的订单上。"""
    if is_commission_mode(getattr(order, "sale_mode", None)):
        raise ValueError("约稿订单请在对话里交稿")
    if order.status not in ("paid", "completed"):
        raise ValueError("订单还未支付，不能补货")

    saw_goods = False
    attached = 0
    for it in order.items:
        product = (
            db.query(Product)
            .options(joinedload(Product.files))
            .filter(Product.id == it.product_id)
            .first()
        )
        if not product:
            continue
        sources, content = _product_sources(product)
        if not sources and not content:
            continue
        saw_goods = True
        delivery = next((d for d in order.deliveries if d.product_id == it.product_id), None)
        if not delivery:
            delivery = Delivery(
                id="d_" + random_id(),
                order_id=order.id,
                product_id=it.product_id,
                product_name=it.name,
                payload=content,
                created_at=datetime.utcnow(),
            )
            db.add(delivery)
            order.deliveries.append(delivery)
            db.flush()
            attached += 1
        known = {f.file_path for f in (delivery.files or []) if f.file_path}
        if delivery.file_path:
            known.add(delivery.file_path)
        sort_order = max((f.sort_order for f in (delivery.files or [])), default=-1) + 1
        added_paths: list[tuple[str, str]] = []
        for path, name in sources:
            if path in known:
                continue
            db.add(
                DeliveryFile(
                    id="df_" + random_id(length=8),
                    delivery_id=delivery.id,
                    file_path=path,
                    file_name=name,
                    sort_order=sort_order,
                )
            )
            known.add(path)
            added_paths.append((path, name))
            sort_order += 1
            attached += 1
        if added_paths and not delivery.file_path:
            delivery.file_path, delivery.file_name = added_paths[0]
        current = (delivery.payload or "").strip()
        if content and current in ("", EMPTY_DELIVERY_NOTE):
            delivery.payload = content
            attached += 1
        elif added_paths and current == EMPTY_DELIVERY_NOTE:
            delivery.payload = ""
            attached += 1

    if not saw_goods:
        raise ValueError("商品还没有可发放的文件，请先上传后再补货")
    if attached == 0:
        raise ValueError("这份订单已经有当前商品的文件，无需补货")

    order.status = "completed"
    db.commit()
    db.expire_all()

    try:
        from .mail import notify_order_emails

        fresh = db.query(Order).filter(Order.id == order.id).first()
        if fresh:
            notify_order_emails(db, fresh)
    except Exception:
        pass

    return attached
