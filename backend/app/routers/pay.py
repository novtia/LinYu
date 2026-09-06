from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Order, OrderPayment, PaymentChannel
from ..payment.providers import get_provider
from ..payment.providers.alipay_page import AlipayPageProvider
from ..payment.providers.ezpay import EzpayProvider
from ..payment.service import parse_config
from ..services.commission import is_commission_mode
from ..services.fulfillment import fulfill_order

router = APIRouter(prefix="/api/pay", tags=["pay"])

logger = logging.getLogger("lingxia.pay")


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


def _is_paid_status(provider: str, params: Dict[str, Any]) -> bool:
    status = (params.get("trade_status") or params.get("status") or "").upper()
    if provider == "alipay":
        return status in ("TRADE_SUCCESS", "TRADE_FINISHED")
    if status in ("TRADE_SUCCESS", "SUCCESS", "PAID", "1"):
        return True
    # 部分易支付仅在成功时回调，无 status 字段
    if params.get("out_trade_no") and params.get("trade_no") and not status:
        logger.info("回调无状态字段，按验签通过的成功通知处理：%s", params.get("out_trade_no"))
        return True
    return False


_AMOUNT_FIELDS = {
    "alipay": ("total_amount", "receipt_amount"),
    "ezpay": ("money", "total_fee", "total_amount"),
}
_DEFAULT_AMOUNT_FIELDS = ("money", "total_amount", "total_fee", "amount")


def _amount_ok(expected: float, provider: str, params: Dict[str, Any], *, label: str) -> bool:
    """校验回调金额不低于应付金额，避免小额支付换取大额发货。"""
    raw = ""
    for field in _AMOUNT_FIELDS.get(provider, _DEFAULT_AMOUNT_FIELDS):
        value = str(params.get(field) or "").strip()
        if value:
            raw = value
            break
    if not raw:
        logger.warning("订单 %s 回调缺少金额字段，已拒绝：%s", label, sorted(params))
        return False
    try:
        paid = round(float(raw), 2)
    except (TypeError, ValueError):
        return False
    need = round(float(expected), 2)
    if paid + 0.005 < need:
        logger.warning("订单 %s 回调金额不足：paid=%s expected=%s", label, paid, need)
        return False
    return True


def _resolve_pay_target(db: Session, out_trade_no: str) -> Tuple[Optional[Order], Optional[OrderPayment]]:
    payment = db.query(OrderPayment).filter(OrderPayment.id == out_trade_no).first()
    if payment:
        order = db.query(Order).filter(Order.id == payment.order_id).first()
        return order, payment
    order = db.query(Order).filter(Order.id == out_trade_no).first()
    return order, None


def _order_id_from_out_trade_no(db: Session, out_trade_no: str) -> str:
    payment = db.query(OrderPayment).filter(OrderPayment.id == out_trade_no).first()
    if payment:
        return payment.order_id
    return out_trade_no


def _mark_payment_paid(payment: Optional[OrderPayment], trade_no: Optional[str]) -> None:
    if not payment:
        return
    payment.status = "paid"
    if not payment.paid_at:
        payment.paid_at = datetime.utcnow()
    if trade_no and not payment.trade_no:
        payment.trade_no = trade_no


def _apply_commission_payment(db: Session, order: Order, payment: OrderPayment, trade_no: Optional[str]) -> bool:
    _mark_payment_paid(payment, trade_no)
    if payment.kind == "deposit":
        if order.status == "pending":
            order.status = "deposit_paid"
        if not order.paid_at:
            order.paid_at = datetime.utcnow()
        if trade_no and not order.trade_no:
            order.trade_no = trade_no
        db.commit()
        return True
    if payment.kind == "balance":
        if order.status in ("awaiting_balance", "deposit_paid"):
            order.status = "completed"
        if trade_no and not order.trade_no:
            order.trade_no = trade_no
        db.commit()
        return True
    return False


def _process_payment(db: Session, params: Dict[str, Any], *, expect_provider: Optional[str] = None) -> bool:
    """验签并完成发货。成功返回 True。"""
    out_trade_no = (params.get("out_trade_no") or "").strip()
    if not out_trade_no:
        return False

    order, payment = _resolve_pay_target(db, out_trade_no)
    if not order:
        return False

    if payment and payment.status == "paid":
        return True
    if is_commission_mode(order.sale_mode):
        if payment and payment.kind == "deposit" and order.status in ("deposit_paid", "awaiting_balance", "completed"):
            _mark_payment_paid(payment, (params.get("trade_no") or "").strip() or None)
            db.commit()
            return True
        if payment and payment.kind == "balance" and order.status == "completed":
            _mark_payment_paid(payment, (params.get("trade_no") or "").strip() or None)
            db.commit()
            return True
        if payment is None and order.status in ("deposit_paid", "awaiting_balance", "completed", "paid"):
            return True
    elif order.status in ("paid", "completed"):
        return True

    channel_id = (payment.payment_channel_id if payment else None) or order.payment_channel_id
    channel = db.query(PaymentChannel).filter(PaymentChannel.id == channel_id).first() if channel_id else None
    if not channel:
        return False

    if expect_provider and channel.provider != expect_provider:
        return False

    adapter = get_provider(channel.provider)
    if not adapter:
        return False
    if expect_provider == "ezpay" and not isinstance(adapter, EzpayProvider):
        return False
    if expect_provider == "alipay" and not isinstance(adapter, AlipayPageProvider):
        return False

    config = parse_config(channel.config_json)
    if not hasattr(adapter, "verify_notify") or not adapter.verify_notify(config, params):
        logger.warning("订单 %s 回调验签失败（渠道 %s）", order.id, channel.provider)
        return False

    if expect_provider == "alipay":
        app_id = str(params.get("app_id") or "").strip()
        if app_id and app_id != str(config.get("app_id") or "").strip():
            return False

    if not _is_paid_status(channel.provider, params):
        return False
    expected = payment.amount if payment else order.total
    if not _amount_ok(expected, channel.provider, params, label=order.id):
        return False

    trade_no = (params.get("trade_no") or "").strip() or None
    if is_commission_mode(order.sale_mode) and payment and payment.kind in ("deposit", "balance"):
        return _apply_commission_payment(db, order, payment, trade_no)

    _mark_payment_paid(payment, trade_no)
    fulfill_order(db, order, trade_no=trade_no)
    return True


@router.api_route("/ezpay/notify", methods=["GET", "POST"])
async def ezpay_notify(request: Request, db: Session = Depends(get_db)):
    """易支付异步通知：验签成功并发货后返回 success。"""
    params = await _collect_params(request)
    ok = _process_payment(db, params, expect_provider="ezpay")
    return PlainTextResponse("success" if ok else "fail")


@router.api_route("/ezpay/return", methods=["GET", "POST"])
async def ezpay_return(request: Request, db: Session = Depends(get_db)):
    """易支付同步跳转：尽量处理一次支付结果，再跳转前台订单页。"""
    params = await _collect_params(request)
    out_trade_no = (params.get("out_trade_no") or "").strip()
    if out_trade_no:
        try:
            _process_payment(db, params, expect_provider="ezpay")
        except Exception:
            pass
        return RedirectResponse(_frontend_order_url(_order_id_from_out_trade_no(db, out_trade_no)), status_code=302)
    base = (os.getenv("FRONTEND_URL") or "http://127.0.0.1:5173").rstrip("/")
    return RedirectResponse(f"{base}/orders", status_code=302)


@router.api_route("/alipay/notify", methods=["GET", "POST"])
async def alipay_notify(request: Request, db: Session = Depends(get_db)):
    """支付宝异步通知：验签成功并发货后返回 success。"""
    params = await _collect_params(request)
    ok = _process_payment(db, params, expect_provider="alipay")
    return PlainTextResponse("success" if ok else "fail")


@router.api_route("/alipay/return", methods=["GET", "POST"])
async def alipay_return(request: Request, db: Session = Depends(get_db)):
    """支付宝同步回跳：尽量处理一次，再跳转前台订单页。"""
    params = await _collect_params(request)
    out_trade_no = (params.get("out_trade_no") or "").strip()
    if out_trade_no:
        try:
            _process_payment(db, params, expect_provider="alipay")
        except Exception:
            pass
        return RedirectResponse(_frontend_order_url(_order_id_from_out_trade_no(db, out_trade_no)), status_code=302)
    base = (os.getenv("FRONTEND_URL") or "http://127.0.0.1:5173").rstrip("/")
    return RedirectResponse(f"{base}/orders", status_code=302)
