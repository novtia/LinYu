from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import hash_password
from ..database import get_db
from ..deps import get_admin_user
from ..models import User
from ..schemas import MessageOut, UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=List[UserOut])
def list_users(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [UserOut.model_validate(u) for u in users]


@router.post("/{username}/reset-password", response_model=MessageOut)
def reset_password(
    username: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.password_hash = hash_password("123456")
    db.commit()
    return MessageOut(message="已重置为 123456")


@router.post("/{username}/toggle", response_model=UserOut)
def toggle_user(
    username: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="不能禁用管理员")
    user.disabled = not user.disabled
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)
