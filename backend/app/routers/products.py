from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_admin_user, get_optional_user
from ..models import Category, Product, ProductFile, User
from ..schemas import AssetUploadOut, CoverUploadOut, MessageOut, ProductFileOut, ProductIn, ProductOut
from ..services.commission import SALE_COMMISSION, normalize_sale_mode, split_price
from ..services.delivery import random_id
from ..services.files import (
    delete_stored,
    image_media_type,
    is_image_name,
    resolve_stored_path,
    save_asset,
    save_cover,
    save_upload,
)

router = APIRouter(prefix="/api/products", tags=["products"])


def _out(p: Product, *, include_delivery: bool = False) -> ProductOut:
    return ProductOut.from_orm_product(p, include_delivery=include_delivery)


def _get_product(db: Session, product_id: int) -> Product:
    product = (
        db.query(Product)
        .options(joinedload(Product.category), joinedload(Product.files))
        .filter(Product.id == product_id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    return product


def _sync_legacy_file(product: Product) -> None:
    files = sorted(list(product.files or []), key=lambda f: f.sort_order)
    if files:
        product.file_path = files[0].file_path
        product.file_name = files[0].file_name
    else:
        product.file_path = None
        product.file_name = None


def _next_file_sort(product: Product) -> int:
    files = list(product.files or [])
    if not files:
        return 0
    return max(f.sort_order for f in files) + 1


async def _add_product_file(db: Session, product: Product, file: UploadFile) -> ProductFile:
    try:
        stored, original = await save_upload(file, str(product.id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    row = ProductFile(
        id="pf_" + random_id(length=8),
        product_id=product.id,
        file_path=stored,
        file_name=original,
        sort_order=_next_file_sort(product),
    )
    db.add(row)
    product.files.append(row)
    _sync_legacy_file(product)
    db.commit()
    db.refresh(row)
    return row


def _validate_category(db: Session, category_id: Optional[int]) -> None:
    if category_id is None:
        return
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=400, detail="商品分类不存在")


def _validated_sale_mode(body: ProductIn) -> str:
    mode = normalize_sale_mode(body.sale_mode)
    if mode == SALE_COMMISSION:
        deposit, balance = split_price(body.price)
        if deposit < 0.01 or balance < 0.01:
            raise HTTPException(status_code=400, detail="约稿单价须至少 0.02 元/千字，以便拆分定金与尾款")
    return mode


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
        sale_mode=_validated_sale_mode(body),
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
    product.sale_mode = _validated_sale_mode(body)
    db.commit()
    return _out(_get_product(db, product.id), include_delivery=True)


@router.post("/{product_id}/files", response_model=ProductFileOut)
async def upload_product_files(
    product_id: int,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """上传一个付费文件，可连续调用多次。"""
    product = _get_product(db, product_id)
    row = await _add_product_file(db, product, file)
    return ProductFileOut(id=row.id, file_name=row.file_name, is_image=is_image_name(row.file_name))


@router.delete("/{product_id}/files/{file_id}", response_model=MessageOut)
def delete_product_file_item(
    product_id: int,
    file_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    row = next((f for f in product.files if f.id == file_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="文件不存在")
    delete_stored(row.file_path)
    product.files.remove(row)
    db.delete(row)
    _sync_legacy_file(product)
    db.commit()
    return MessageOut(message="已删除商品文件")


@router.get("/{product_id}/files/{file_id}/preview")
def preview_product_file(
    product_id: int,
    file_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    row = next((f for f in product.files if f.id == file_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        path = resolve_stored_path(row.file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件已丢失")
    inline = is_image_name(row.file_name)
    return FileResponse(
        path=str(path),
        filename=row.file_name,
        media_type=image_media_type(row.file_name) if inline else "application/octet-stream",
        content_disposition_type="inline" if inline else "attachment",
    )


@router.post("/{product_id}/file", response_model=ProductFileOut)
async def upload_product_file(
    product_id: int,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """兼容旧单文件接口：追加一个付费文件。"""
    product = _get_product(db, product_id)
    row = await _add_product_file(db, product, file)
    return ProductFileOut(id=row.id, file_name=row.file_name, is_image=is_image_name(row.file_name))


@router.delete("/{product_id}/file", response_model=MessageOut)
def delete_product_file(
    product_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    product = _get_product(db, product_id)
    for row in list(product.files or []):
        delete_stored(row.file_path)
        db.delete(row)
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
    for row in list(product.files or []):
        delete_stored(row.file_path)
    delete_stored(product.file_path)
    db.delete(product)
    db.commit()
    return MessageOut(message="已删除")
