from __future__ import annotations

from typing import Any, Dict, List, Optional

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


class EzpayProvider(BasePaymentProvider):
    """易支付（YPay）页面跳转支付：https://www.ezfpy.cn/doc"""

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
