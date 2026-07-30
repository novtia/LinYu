from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import create_access_token, hash_password, verify_password
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import LoginIn, MessageOut, RegisterIn, TokenOut, UserOut
from ..seed import load_settings
from ..services.captcha import verify_captcha

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="用户名或密码错误")
    if user.disabled:
        raise HTTPException(status_code=400, detail="账号已被禁用，请联系管理员")
    token = create_access_token(user.username)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    settings = load_settings(db)
    if not settings["sys"].allowReg:
        raise HTTPException(status_code=400, detail="当前已关闭注册，请联系管理员")
    if not re.match(r"^[a-zA-Z0-9_]{3,16}$", body.username):
        raise HTTPException(status_code=400, detail="用户名需为 3-16 位字母、数字或下划线")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="用户名已被占用")
    user = User(
        id="u_" + str(int(datetime.utcnow().timestamp() * 1000)),
        username=body.username,
        password_hash=hash_password(body.password),
        role="user",
        disabled=False,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.username)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)
