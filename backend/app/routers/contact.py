from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import ContactIn, MessageOut
from ..services.captcha import verify_captcha
from ..services.mail import get_mail_settings, is_valid_email, send_contact_mail

router = APIRouter(prefix="/api/contact", tags=["contact"])


@router.post("", response_model=MessageOut)
def submit_contact(body: ContactIn, db: Session = Depends(get_db)):
    mail = get_mail_settings(db)
    if not mail.enabled:
        raise HTTPException(status_code=400, detail="邮件服务未启用，请稍后再试或直接联系客服")

    name = (body.name or "").strip()
    email = (body.email or "").strip()
    message = (body.message or "").strip()
    if not name or len(name) > 64:
        raise HTTPException(status_code=400, detail="请填写有效的称呼")
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请填写有效的邮箱")
    if not message or len(message) < 5:
        raise HTTPException(status_code=400, detail="留言内容至少 5 个字")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="留言内容过长")
    if not verify_captcha(db, body.captcha_id, body.captcha):
        raise HTTPException(status_code=400, detail="验证码错误，请重新输入")

    try:
        send_contact_mail(db, name=name, email=email, message=message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MessageOut(message="已发送，我们会尽快回复")
