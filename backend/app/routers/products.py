from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_admin_user, get_optional_user
from ..models import Category, Product, User
from ..schemas import AssetUploadOut, CoverUploadOut, MessageOut, ProductFileOut, ProductIn, ProductOut
from ..services.files import delete_stored, save_asset, save_cover, save_upload

router = APIRouter(prefix="/api/products", tags=["products"])


def _out(p: Product, *, include_delivery: bool = False) -> ProductOut:
    return ProductOut.from_orm_product(p, include_delivery=include_delivery)


def _get_product(db: Session, product_id: int) -> Product:
    product = (
        db.query(Product)
        .options(joinedload(Product.category))
        .filter(Product.id == product_id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    return product


def _validate_category(db: Session, category_id: Optional[int]) -> None:
    if category_id is None:
        return
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=400, detail="商品分类不存在")


@router.get("", response_model=List[ProductOut])
def list_products(
    category_id: Optional[int] = Query(None),
    all: bool = Query(False, description="包含下架商品，仅管理员可用"),
    viewer: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    q = db.query(Product).options(joinedload(Product.category))
    include_off = all and bool(viewer and viewer.role == "admin")
    if not include_off:
        q = q.filter(Product.status == "on")
    if category_id is not None:
        q = q.filter(Product.category_id == category_id)
    return [_out(p) for p in q.all()]


@router.get("/admin", response_model=List[ProductOut])
def admin_list_products(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    products = db.query(Product).options(joinedload(Product.category)).all()
    return [_out(p) for p in products]


@router.get("/admin/{product_id}", response_model=ProductOut)
def admin_get_product(
    product_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return _out(_get_product(db, product_id), include_delivery=True)


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    if product.status != "on":
        raise HTTPException(status_code=404, detail="商品已下架")
    return _out(product)


@router.post("/assets", response_model=AssetUploadOut)
async def upload_delivery_asset(
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
):
    """Upload image/file for markdown delivery content."""
    try:
        stored, original = await save_asset(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return AssetUploadOut(url="/uploads/" + stored, file_name=original)


@router.post("", response_model=ProductOut)
def create_product(
    body: ProductIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    _validate_category(db, body.category_id)
    product = Product(
        name=body.name,
        price=body.price,
        desc=body.desc,
        delivery_content=body.delivery_content or "",
        cover=body.cover or "p1",
        status=body.status or "on",
        category_id=body.category_id,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return _out(_get_product(db, product.id), include_delivery=True)


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    body: ProductIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    _validate_category(db, body.category_id)
    product.name = body.name
    product.price = body.price
    product.desc = body.desc
    product.delivery_content = body.delivery_content or ""
    product.cover = body.cover or "p1"
    product.status = body.status or "on"
    product.category_id = body.category_id
    db.commit()
    return _out(_get_product(db, product.id), include_delivery=True)


@router.post("/{product_id}/file", response_model=ProductFileOut)
async def upload_product_file(
    product_id: int,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """上传付费数字文件，发货时随订单发放（不公开直链）。"""
    product = _get_product(db, product_id)
    try:
        stored, original = await save_upload(file, str(product_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    delete_stored(product.file_path)
    product.file_path = stored
    product.file_name = original
    db.commit()
    return ProductFileOut(file_name=original)


@router.delete("/{product_id}/file", response_model=MessageOut)
def delete_product_file(
    product_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    delete_stored(product.file_path)
    product.file_path = None
    product.file_name = None
    db.commit()
    return MessageOut(message="已删除商品文件")


@router.post("/{product_id}/cover", response_model=CoverUploadOut)
async def upload_product_cover(
    product_id: int,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    try:
        stored, _original = await save_cover(file, str(product_id))
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
    product_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    delete_stored(product.cover_image)
    product.cover_image = None
    db.commit()
    return MessageOut(message="已删除封面")


@router.patch("/{product_id}/toggle", response_model=ProductOut)
def toggle_product(
    product_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    product.status = "off" if product.status == "on" else "on"
    db.commit()
    return _out(_get_product(db, product.id))


@router.delete("/{product_id}", response_model=MessageOut)
def delete_product(
    product_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    delete_stored(product.cover_image)
    delete_stored(product.file_path)
    db.delete(product)
    db.commit()
    return MessageOut(message="已删除")
