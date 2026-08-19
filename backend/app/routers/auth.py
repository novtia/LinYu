from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..auth import create_access_token, hash_password, verify_password
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import (
    AccountUpdateIn,
    ForgotPasswordIn,
    LoginByCodeIn,
    LoginIn,
    MessageOut,
    RegisterIn,
    ResetPasswordIn,
    SendLoginCodeIn,
    SendRegisterCodeIn,
    TokenOut,
    UserOut,
)
from ..seed import load_settings
from ..services.captcha import verify_captcha
from ..services.delivery import random_id
from ..services.emailcode import (
    CODE_TTL_MINUTES,
    consume_code,
    in_cooldown,
    issue_code,
)
from ..services.mail import (
    get_mail_settings,
    is_valid_email,
    send_login_code,
    send_password_reset_code,
    send_register_code,
)
from ..services.ratelimit import (
    clear_failures,
    client_ip,
    guard_failures,
    rate_limit,
    record_failure,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,16}$")
LOGIN_FAIL_LIMIT = 8
LOGIN_FAIL_WINDOW = 900
TOO_MANY_TRIES = "尝试次数过多，请稍后再试"
# bcrypt 仅使用密码前 72 字节，超长直接拒绝，避免后端报错或静默截断
MAX_PASSWORD_BYTES = 72


def _fail_key(request: Request, account: str) -> str:
    """失败计数键按 账号+来源IP 隔离：攻击者无法从其他 IP 把受害账号锁死。"""
    return f"{account}@{client_ip(request)}"


def _check_password_length(password: str) -> None:
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise HTTPException(status_code=400, detail="密码过长，请不超过 72 字节")


def _issue_token(user: User) -> TokenOut:
    token = create_access_token(user.username, token_version=user.token_version or 0)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


def _find_user_by_account(db: Session, account: str) -> User | None:
    account = (account or "").strip()
    if not account:
        return None
    user = db.query(User).filter(User.username == account).first()
    if not user and is_valid_email(account):
        user = db.query(User).filter(User.email == account.lower()).first()
    return user


def _require_mail_enabled(db: Session, message: str) -> None:
    if not get_mail_settings(db).enabled:
        raise HTTPException(status_code=400, detail=message)


def _normalized_email(raw: str | None) -> str:
    email = (raw or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请填写有效的邮箱")
    return email


@router.post(
    "/login",
    response_model=TokenOut,
    dependencies=[Depends(rate_limit("login", limit=20, window=300))],
)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    account = (body.username or "").strip().lower()
    fail_key = _fail_key(request, account)
    guard_failures("login-acct", fail_key, limit=LOGIN_FAIL_LIMIT, window=LOGIN_FAIL_WINDOW, detail=TOO_MANY_TRIES)

    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")
    user = _find_user_by_account(db, body.username)
    if not user or not verify_password(body.password, user.password_hash):
        record_failure("login-acct", fail_key)
        raise HTTPException(status_code=400, detail="账号或密码错误")
    if user.disabled:
        raise HTTPException(status_code=400, detail="账号已被禁用，请联系管理员")
    clear_failures("login-acct", fail_key)
    return _issue_token(user)


@router.post(
    "/send-login-code",
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("send-login-code", limit=6, window=600))],
)
def send_login_email_code(body: SendLoginCodeIn, db: Session = Depends(get_db)):
    _require_mail_enabled(db, "邮件服务未启用，暂时无法使用验证码登录")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")

    email = _normalized_email(body.email)
    if in_cooldown(db, email, "login"):
        raise HTTPException(status_code=400, detail="验证码发送过于频繁，请稍后再试")

    # 防枚举：邮箱未注册或账号被禁用时返回同样文案，不发送邮件
    user = db.query(User).filter(User.email == email).first()
    if not user or user.disabled:
        return MessageOut(message="若邮箱已注册，验证码已发送，请查收邮箱")

    code = issue_code(db, email, "login")
    try:
        send_login_code(
            db,
            to=email,
            username=user.username,
            code=code,
            expire_minutes=CODE_TTL_MINUTES,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MessageOut(message="若邮箱已注册，验证码已发送，请查收邮箱")


@router.post(
    "/login-by-code",
    response_model=TokenOut,
    dependencies=[Depends(rate_limit("login-by-code", limit=15, window=300))],
)
def login_by_code(body: LoginByCodeIn, request: Request, db: Session = Depends(get_db)):
    email = _normalized_email(body.email)
    if not (body.code or "").strip():
        raise HTTPException(status_code=400, detail="请填写邮箱验证码")
    fail_key = _fail_key(request, email)
    guard_failures("code-login", fail_key, limit=LOGIN_FAIL_LIMIT, window=LOGIN_FAIL_WINDOW, detail=TOO_MANY_TRIES)

    user = db.query(User).filter(User.email == email).first()
    if not user or not consume_code(db, email, "login", body.code):
        record_failure("code-login", fail_key)
        raise HTTPException(status_code=400, detail="验证码无效或已过期")
    if user.disabled:
        raise HTTPException(status_code=400, detail="账号已被禁用，请联系管理员")

    clear_failures("code-login", fail_key)
    return _issue_token(user)


@router.post(
    "/send-register-code",
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("send-register-code", limit=6, window=600))],
)
def send_register_email_code(body: SendRegisterCodeIn, db: Session = Depends(get_db)):
    if not load_settings(db)["sys"].allowReg:
        raise HTTPException(status_code=400, detail="当前已关闭注册，请联系管理员")
    _require_mail_enabled(db, "邮件服务未启用，暂时无法注册")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")

    username = (body.username or "").strip()
    if username and not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="用户名需为 3-16 位字母、数字或下划线")

    email = _normalized_email(body.email)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")
    if in_cooldown(db, email, "register"):
        raise HTTPException(status_code=400, detail="验证码发送过于频繁，请稍后再试")

    code = issue_code(db, email, "register")
    try:
        send_register_code(
            db,
            to=email,
            username=username,
            code=code,
            expire_minutes=CODE_TTL_MINUTES,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MessageOut(message="验证码已发送，请查收邮箱")


@router.post(
    "/register",
    response_model=TokenOut,
    dependencies=[Depends(rate_limit("register", limit=10, window=600))],
)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if not load_settings(db)["sys"].allowReg:
        raise HTTPException(status_code=400, detail="当前已关闭注册，请联系管理员")
    _require_mail_enabled(db, "邮件服务未启用，暂时无法注册")

    if not USERNAME_RE.match(body.username):
        raise HTTPException(status_code=400, detail="用户名需为 3-16 位字母、数字或下划线")
    email = _normalized_email(body.email)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    _check_password_length(body.password)
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="用户名已被占用")
    if not (body.code or "").strip():
        raise HTTPException(status_code=400, detail="请填写邮箱验证码")

    fail_key = _fail_key(request, email)
    guard_failures("register-code", fail_key, limit=8, window=900, detail=TOO_MANY_TRIES)
    if not consume_code(db, email, "register", body.code):
        record_failure("register-code", fail_key)
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    user = User(
        id="u_" + str(int(datetime.utcnow().timestamp() * 1000)) + random_id(length=4),
        username=body.username,
        email=email,
        password_hash=hash_password(body.password),
        role="user",
        disabled=False,
        token_version=0,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    clear_failures("register-code", fail_key)
    return _issue_token(user)


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
        if not USERNAME_RE.match(new_username):
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
        _check_password_length(new_password)
        user.password_hash = hash_password(new_password)
        # 改密后旧令牌立即失效
        user.token_version = (user.token_version or 0) + 1

    db.commit()
    db.refresh(user)
    return _issue_token(user)


@router.post(
    "/forgot-password",
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("forgot-password", limit=6, window=600))],
)
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    _require_mail_enabled(db, "邮件服务未启用，请联系管理员重置密码")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")

    account = (body.account or "").strip()
    if not account:
        raise HTTPException(status_code=400, detail="请输入用户名或邮箱")

    user = _find_user_by_account(db, account)
    # 防枚举：即使用户不存在也返回成功文案
    if not user or not user.email:
        return MessageOut(message="若账号存在且已绑定邮箱，验证码已发送")

    email = user.email.lower()
    if in_cooldown(db, email, "reset"):
        raise HTTPException(status_code=400, detail="验证码发送过于频繁，请稍后再试")

    code = issue_code(db, email, "reset")
    try:
        send_password_reset_code(db, to=user.email, username=user.username, code=code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MessageOut(message="若账号存在且已绑定邮箱，验证码已发送")


@router.post(
    "/reset-password",
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("reset-password", limit=15, window=300))],
)
def reset_password(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db)):
    account = (body.account or "").strip()
    code = (body.code or "").strip()
    if not account or not code:
        raise HTTPException(status_code=400, detail="请填写账号与验证码")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    _check_password_length(body.new_password)

    fail_key = _fail_key(request, account.lower())
    guard_failures("reset-code", fail_key, limit=8, window=900, detail=TOO_MANY_TRIES)
    user = _find_user_by_account(db, account)
    if not user or not user.email or not consume_code(db, user.email.lower(), "reset", code):
        record_failure("reset-code", fail_key)
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    user.password_hash = hash_password(body.new_password)
    # 重置密码后吊销此前签发的所有令牌
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    clear_failures("reset-code", fail_key)
    return MessageOut(message="密码已重置，请使用新密码登录")
