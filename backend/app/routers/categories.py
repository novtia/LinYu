from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user
from ..models import Category, Product, User
from ..schemas import CategoryIn, CategoryOut, MessageOut

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=List[CategoryOut])
def list_categories(
    all: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(Category)
    if not all:
        q = q.filter(Category.enabled.is_(True))
    return q.order_by(Category.sort_order.asc(), Category.id.asc()).all()


@router.get("/admin", response_model=List[CategoryOut])
def admin_list_categories(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return db.query(Category).order_by(Category.sort_order.asc(), Category.id.asc()).all()


@router.post("", response_model=CategoryOut)
def create_category(
    body: CategoryIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    if db.query(Category).filter(Category.name == name).first():
        raise HTTPException(status_code=400, detail="分类名称已存在")
    cat = Category(
        name=name,
        sort_order=body.sort_order,
        enabled=body.enabled,
        created_at=datetime.utcnow(),
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    body: CategoryIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    dup = db.query(Category).filter(Category.name == name, Category.id != category_id).first()
    if dup:
        raise HTTPException(status_code=400, detail="分类名称已存在")
    cat.name = name
    cat.sort_order = body.sort_order
    cat.enabled = body.enabled
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", response_model=MessageOut)
def delete_category(
    category_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    in_use = db.query(Product).filter(Product.category_id == category_id).count()
    if in_use:
        raise HTTPException(status_code=400, detail=f"仍有 {in_use} 个商品使用该分类，无法删除")
    db.delete(cat)
    db.commit()
    return MessageOut(message="已删除")
