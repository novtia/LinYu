from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..payment import service as payment_service
from ..payment.schemas import PublicPaymentMethodsOut

router = APIRouter(prefix="/api/payment", tags=["payment"])


@router.get("/methods", response_model=PublicPaymentMethodsOut)
def public_payment_methods(db: Session = Depends(get_db)):
    """
    公开支付方式列表。

    仅返回：已启用 + 配置完整（如易支付已填 pid/key）+ 渠道内开启的 method。
    不包含商户密钥等敏感信息，供前台结算页选择支付方式。
    """
    return payment_service.list_public_methods(db)
