from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import CaptchaOut
from ..services.captcha import create_captcha
from ..services.ratelimit import rate_limit

router = APIRouter(prefix="/api", tags=["captcha"])


@router.get(
    "/captcha",
    response_model=CaptchaOut,
    dependencies=[Depends(rate_limit("captcha", limit=60, window=300))],
)
def get_captcha(db: Session = Depends(get_db)):
    captcha_id, image = create_captcha(db)
    return CaptchaOut(captcha_id=captcha_id, image=image)
