from __future__ import annotations

import random
import re
import string
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import create_access_token, hash_password, verify_password
from ..database import get_db
from ..deps import get_current_user
from ..models import EmailCode, User
from ..schemas import (
    AccountUpdateIn,
    ForgotPasswordIn,
    LoginIn,
    MessageOut,
    RegisterIn,
    ResetPasswordIn,
    TokenOut,
    UserOut,
)
from ..seed import load_settings
from ..services.captcha import verify_captcha
from ..services.delivery import random_id
from ..services.mail import get_mail_settings, is_valid_email, send_password_reset_code

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_CODE_TTL_MINUTES = 15


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
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请填写有效的邮箱")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="用户名已被占用")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")
    user = User(
        id="u_" + str(int(datetime.utcnow().timestamp() * 1000)),
        username=body.username,
        email=email,
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


@router.put("/account", response_model=TokenOut)
def update_account(
    body: AccountUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")

    new_username = (body.username or "").strip()
    new_email = body.email.strip().lower() if body.email is not None else None
    new_password = body.new_password or ""

    if not new_username and new_email is None and not new_password:
        raise HTTPException(status_code=400, detail="请填写要修改的信息")

    if new_username and new_username != user.username:
        if not re.match(r"^[a-zA-Z0-9_]{3,16}$", new_username):
            raise HTTPException(status_code=400, detail="用户名需为 3-16 位字母、数字或下划线")
        if db.query(User).filter(User.username == new_username, User.id != user.id).first():
            raise HTTPException(status_code=400, detail="用户名已被占用")
        user.username = new_username

    if new_email is not None and new_email != (user.email or ""):
        if new_email and not is_valid_email(new_email):
            raise HTTPException(status_code=400, detail="请填写有效的邮箱")
        if new_email and db.query(User).filter(User.email == new_email, User.id != user.id).first():
            raise HTTPException(status_code=400, detail="该邮箱已被占用")
        user.email = new_email or None

    if new_password:
        if len(new_password) < 6:
            raise HTTPException(status_code=400, detail="新密码至少 6 位")
        user.password_hash = hash_password(new_password)

    db.commit()
    db.refresh(user)
    token = create_access_token(user.username)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/forgot-password", response_model=MessageOut)
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    mail = get_mail_settings(db)
    if not mail.enabled:
        raise HTTPException(status_code=400, detail="邮件服务未启用，请联系管理员重置密码")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")

    account = (body.account or "").strip()
    if not account:
        raise HTTPException(status_code=400, detail="请输入用户名或邮箱")

    user = db.query(User).filter(User.username == account).first()
    if not user and is_valid_email(account):
        user = db.query(User).filter(User.email == account.lower()).first()

    # 防枚举：即使用户不存在也返回成功文案
    if not user or not user.email:
        return MessageOut(message="若账号存在且已绑定邮箱，验证码已发送")

    code = "".join(random.choice(string.digits) for _ in range(6))
    row = EmailCode(
        id="ec_" + random_id(),
        email=user.email.lower(),
        purpose="reset",
        code=code,
        created_at=datetime.utcnow(),
        used=False,
    )
    db.add(row)
    db.commit()

    try:
        send_password_reset_code(db, to=user.email, username=user.username, code=code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MessageOut(message="验证码已发送，请查收邮箱")


@router.post("/reset-password", response_model=MessageOut)
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    account = (body.account or "").strip()
    code = (body.code or "").strip()
    if not account or not code:
        raise HTTPException(status_code=400, detail="请填写账号与验证码")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")

    user = db.query(User).filter(User.username == account).first()
    if not user and is_valid_email(account):
        user = db.query(User).filter(User.email == account.lower()).first()
    if not user or not user.email:
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    cutoff = datetime.utcnow() - timedelta(minutes=EMAIL_CODE_TTL_MINUTES)
    row = (
        db.query(EmailCode)
        .filter(
            EmailCode.email == user.email.lower(),
            EmailCode.purpose == "reset",
            EmailCode.code == code,
            EmailCode.used.is_(False),
            EmailCode.created_at >= cutoff,
        )
        .order_by(EmailCode.created_at.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    row.used = True
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return MessageOut(message="密码已重置，请使用新密码登录")
