from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user
from ..models import Product, User
from ..schemas import CoverUploadOut, MessageOut, ProductIn, ProductOut, UploadOut
from ..services.delivery import random_id
from ..services.files import delete_stored, save_cover, save_upload

router = APIRouter(prefix="/api/products", tags=["products"])

TAG_MAP = {"key": "KEY · AUTO", "file": "FILE · ZIP", "code": "CODE · REDEEM"}


def _out(p: Product) -> ProductOut:
    return ProductOut.from_orm_product(p)


@router.get("", response_model=List[ProductOut])
def list_products(
    type: Optional[str] = Query(None),
    all: bool = Query(False),
    db: Session = Depends(get_db),
):
    q = db.query(Product)
    if not all:
        q = q.filter(Product.status == "on")
    if type and type != "all":
        q = q.filter(Product.type == type)
    return [_out(p) for p in q.all()]


@router.get("/admin", response_model=List[ProductOut])
def admin_list_products(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return [_out(p) for p in db.query(Product).all()]


@router.get("/admin/{product_id}", response_model=ProductOut)
def admin_get_product(
    product_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    return _out(product)


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: str,
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    if product.status != "on":
        raise HTTPException(status_code=404, detail="商品已下架")
    return _out(product)


@router.post("", response_model=ProductOut)
def create_or_update_product(
    body: ProductIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    pid = body.id or ("p_" + random_id())
    tag = body.tag or TAG_MAP.get(body.type, "KEY · AUTO")
    existing = db.query(Product).filter(Product.id == pid).first()
    if existing:
        existing.name = body.name
        existing.type = body.type
        existing.price = body.price
        existing.desc = body.desc
        existing.cover = body.cover
        existing.tag = tag
        existing.status = body.status
        db.commit()
        db.refresh(existing)
        return _out(existing)
    product = Product(
        id=pid,
        name=body.name,
        type=body.type,
        price=body.price,
        desc=body.desc,
        cover=body.cover,
        tag=tag,
        status=body.status,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return _out(product)


@router.post("/{product_id}/cover", response_model=CoverUploadOut)
async def upload_product_cover(
    product_id: str,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    try:
        stored, _original = await save_cover(file, product_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    delete_stored(product.cover_image)
    product.cover_image = stored
    db.commit()
    db.refresh(product)
    out = _out(product)
    return CoverUploadOut(cover_url=out.cover_url or "")


@router.delete("/{product_id}/cover", response_model=MessageOut)
def delete_product_cover(
    product_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    delete_stored(product.cover_image)
    product.cover_image = None
    db.commit()
    return MessageOut(message="已删除封面")


@router.post("/{product_id}/file", response_model=UploadOut)
async def upload_product_file(
    product_id: str,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    try:
        stored, original = await save_upload(file, product_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    delete_stored(product.file_path)
    product.file_path = stored
    product.file_name = original
    if product.type != "file":
        product.type = "file"
        product.tag = TAG_MAP["file"]
    db.commit()
    return UploadOut(file_name=original, has_file=True)


@router.delete("/{product_id}/file", response_model=MessageOut)
def delete_product_file(
    product_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    delete_stored(product.file_path)
    product.file_path = None
    product.file_name = None
    db.commit()
    return MessageOut(message="已删除文件")


@router.patch("/{product_id}/toggle", response_model=ProductOut)
def toggle_product(
    product_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    product.status = "off" if product.status == "on" else "on"
    db.commit()
    db.refresh(product)
    return _out(product)


@router.delete("/{product_id}", response_model=MessageOut)
def delete_product(
    product_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    delete_stored(product.file_path)
    delete_stored(product.cover_image)
    db.delete(product)
    db.commit()
    return MessageOut(message="已删除")
