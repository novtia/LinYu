from __future__ import annotations

import os
from typing import Any, Dict
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Order, PaymentChannel
from ..payment.providers import get_provider
from ..payment.providers.ezpay import EzpayProvider
from ..payment.service import parse_config
from ..services.fulfillment import fulfill_order

router = APIRouter(prefix="/api/pay", tags=["pay"])


async def _collect_params(request: Request) -> Dict[str, Any]:
    params: Dict[str, Any] = dict(request.query_params)
    if request.method == "POST":
        content_type = (request.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            try:
                data = await request.json()
                if isinstance(data, dict):
                    params.update(data)
            except Exception:
                pass
        else:
            try:
                form = await request.form()
                for k, v in form.items():
                    params[k] = v
            except Exception:
                pass
    return {k: ("" if v is None else str(v)) for k, v in params.items()}


def _frontend_order_url(order_id: str) -> str:
    base = (os.getenv("FRONTEND_URL") or "http://127.0.0.1:5173").rstrip("/")
    qs = urlencode({"pay": "1"})
    return f"{base}/orders/{order_id}?{qs}"


def _is_paid_status(params: Dict[str, Any]) -> bool:
    status = (params.get("trade_status") or params.get("status") or "").upper()
    if status in ("TRADE_SUCCESS", "SUCCESS", "PAID", "1"):
        return True
    # 部分易支付仅在成功时回调，无 status 字段
    if params.get("out_trade_no") and params.get("trade_no") and not status:
        return True
    return False


def _process_payment(db: Session, params: Dict[str, Any]) -> bool:
    """验签并完成发货。成功返回 True。"""
    out_trade_no = (params.get("out_trade_no") or "").strip()
    if not out_trade_no:
        return False

    order = db.query(Order).filter(Order.id == out_trade_no).first()
    if not order:
        return False

    # 已完成：幂等成功
    if order.status in ("paid", "completed"):
        return True

    channel = None
    if order.payment_channel_id:
        channel = db.query(PaymentChannel).filter(PaymentChannel.id == order.payment_channel_id).first()
    if not channel:
        return False

    adapter = get_provider(channel.provider)
    if not adapter or not isinstance(adapter, EzpayProvider):
        return False

    config = parse_config(channel.config_json)
    if not adapter.verify_notify(config, params):
        return False

    if not _is_paid_status(params):
        return False

    trade_no = (params.get("trade_no") or "").strip() or None
    fulfill_order(db, order, trade_no=trade_no)
    return True


@router.api_route("/ezpay/notify", methods=["GET", "POST"])
async def ezpay_notify(request: Request, db: Session = Depends(get_db)):
    """易支付异步通知：验签成功并发货后返回 success。"""
    params = await _collect_params(request)
    ok = _process_payment(db, params)
    return PlainTextResponse("success" if ok else "fail")


@router.api_route("/ezpay/return", methods=["GET", "POST"])
async def ezpay_return(request: Request, db: Session = Depends(get_db)):
    """易支付同步跳转：尽量处理一次支付结果，再跳转前台订单页。"""
    params = await _collect_params(request)
    out_trade_no = (params.get("out_trade_no") or "").strip()
    if out_trade_no:
        # 同步回跳也可能带签名，尽量完成发货（异步通知仍是权威）
        try:
            _process_payment(db, params)
        except Exception:
            pass
        return RedirectResponse(_frontend_order_url(out_trade_no), status_code=302)
    base = (os.getenv("FRONTEND_URL") or "http://127.0.0.1:5173").rstrip("/")
    return RedirectResponse(f"{base}/orders", status_code=302)
