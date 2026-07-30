from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import CaptchaOut
from ..services.captcha import create_captcha

router = APIRouter(prefix="/api", tags=["captcha"])


@router.get("/captcha", response_model=CaptchaOut)
def get_captcha(db: Session = Depends(get_db)):
    captcha_id, image = create_captcha(db)
    return CaptchaOut(captcha_id=captcha_id, image=image)
