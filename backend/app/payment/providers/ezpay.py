from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Mapping, Optional

from pydantic import BaseModel, Field

from ..constants import METHOD_LABELS
from .base import BasePaymentProvider


class EzpayMethods(BaseModel):
    alipay: bool = True
    wxpay: bool = True
    qqpay: bool = False


class EzpayConfig(BaseModel):
    gateway: str = "https://www.ezfpy.cn"
    pid: str = ""
    key: str = ""
    notify_url: str = ""
    return_url: str = ""
    sitename: str = "领匣"
    methods: EzpayMethods = Field(default_factory=EzpayMethods)


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def build_submit_sign(
    *,
    money: str,
    name: str,
    notify_url: str,
    out_trade_no: str,
    pid: str,
    return_url: str,
    sitename: str,
    pay_type: str,
    key: str,
) -> tuple[str, str]:
    """按易支付约定固定顺序签名，返回 (待签字符串, sign)。"""
    sg = (
        f"money={money}&name={name}&notify_url={notify_url}"
        f"&out_trade_no={out_trade_no}&pid={pid}&return_url={return_url}"
        f"&sitename={sitename}&type={pay_type}"
    )
    return sg, _md5(sg + key)


def verify_callback_sign(params: Mapping[str, Any], key: str) -> bool:
    """异步/同步通知验签：排除 sign、sign_type，按 key 排序后 MD5。"""
    received = str(params.get("sign") or "").lower()
    if not received or not key:
        return False
    items = []
    for k, v in params.items():
        if k in ("sign", "sign_type"):
            continue
        if v is None:
            continue
        s = str(v).strip()
        if s == "":
            continue
        items.append((k, s))
    items.sort(key=lambda x: x[0])
    plain = "&".join(f"{k}={v}" for k, v in items)
    return _md5(plain + key).lower() == received


class EzpayProvider(BasePaymentProvider):
    """易支付页面跳转支付：https://www.ezfpy.cn/doc"""

    id = "ezpay"
    name = "易支付"
    desc = "页面跳转支付，支持支付宝、微信、QQ 钱包。对接 https://www.ezfpy.cn"
    docs = "https://www.ezfpy.cn/doc"

    def default_config(self) -> Dict[str, Any]:
        return EzpayConfig().model_dump()

    def normalize_config(self, config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return EzpayConfig(**(config or {})).model_dump()

    def enabled_methods(self, config: Dict[str, Any]) -> List[str]:
        methods = (config or {}).get("methods") or {}
        return [code for code in METHOD_LABELS if methods.get(code)]

    def is_ready(self, config: Dict[str, Any]) -> bool:
        cfg = config or {}
        return bool(str(cfg.get("pid") or "").strip() and str(cfg.get("key") or "").strip())

    def build_pay_url(
        self,
        config: Dict[str, Any],
        *,
        money: float,
        name: str,
        out_trade_no: str,
        pay_type: str,
        notify_url: str,
        return_url: str,
    ) -> str:
        cfg = EzpayConfig(**(config or {}))
        money_s = f"{float(money):.2f}"
        gateway = (cfg.gateway or "https://www.ezfpy.cn").rstrip("/")
        sg, sign = build_submit_sign(
            money=money_s,
            name=name,
            notify_url=notify_url,
            out_trade_no=out_trade_no,
            pid=cfg.pid.strip(),
            return_url=return_url,
            sitename=cfg.sitename or "领匣",
            pay_type=pay_type,
            key=cfg.key.strip(),
        )
        return f"{gateway}/submit.php?{sg}&sign={sign}&sign_type=MD5"

    def verify_notify(self, config: Dict[str, Any], params: Mapping[str, Any]) -> bool:
        cfg = EzpayConfig(**(config or {}))
        return verify_callback_sign(params, cfg.key.strip())
