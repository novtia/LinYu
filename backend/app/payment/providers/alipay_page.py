from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional
from urllib.parse import quote_plus, urlencode

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from pydantic import BaseModel, Field

from ..constants import METHOD_LABELS
from .base import BasePaymentProvider

GATEWAY_PROD = "https://openapi.alipay.com/gateway.do"
GATEWAY_SANDBOX = "https://openapi-sandbox.dl.alipaydev.com/gateway.do"


class AlipayPageConfig(BaseModel):
    app_id: str = ""
    app_private_key: str = ""
    alipay_public_key: str = ""
    sandbox: bool = False
    notify_url: str = ""
    return_url: str = ""
    methods: Dict[str, bool] = Field(default_factory=lambda: {"alipay": True})


def _chunk_key(raw: str, width: int = 64) -> str:
    return "\n".join(raw[i : i + width] for i in range(0, len(raw), width))


def _normalize_private_key(raw: str) -> bytes:
    text = (raw or "").strip().replace("\r\n", "\n").replace("\r", "\n")
    if "BEGIN" in text:
        return text.encode("utf-8")
    body = "".join(text.split())
    pem = f"-----BEGIN RSA PRIVATE KEY-----\n{_chunk_key(body)}\n-----END RSA PRIVATE KEY-----\n"
    return pem.encode("utf-8")


def _normalize_public_key(raw: str) -> bytes:
    text = (raw or "").strip().replace("\r\n", "\n").replace("\r", "\n")
    if "BEGIN" in text:
        return text.encode("utf-8")
    body = "".join(text.split())
    pem = f"-----BEGIN PUBLIC KEY-----\n{_chunk_key(body)}\n-----END PUBLIC KEY-----\n"
    return pem.encode("utf-8")


def _load_private_key(raw: str):
    data = _normalize_private_key(raw)
    try:
        return serialization.load_pem_private_key(data, password=None, backend=default_backend())
    except ValueError:
        # PKCS#8
        pem = data.decode("utf-8").replace("RSA PRIVATE KEY", "PRIVATE KEY").encode("utf-8")
        return serialization.load_pem_private_key(pem, password=None, backend=default_backend())


def _load_public_key(raw: str):
    return serialization.load_pem_public_key(_normalize_public_key(raw), backend=default_backend())


def _sign_rsa2(content: str, private_key_pem: str) -> str:
    key = _load_private_key(private_key_pem)
    signature = key.sign(
        content.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


def _verify_rsa2(content: str, sign: str, public_key_pem: str) -> bool:
    if not content or not sign or not public_key_pem:
        return False
    try:
        key = _load_public_key(public_key_pem)
        key.verify(
            base64.b64decode(sign),
            content.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except Exception:
        return False


def _ordered_unsigned(params: Mapping[str, Any], *, exclude: set) -> str:
    items = []
    for k, v in params.items():
        if k in exclude:
            continue
        if v is None:
            continue
        s = str(v).strip() if not isinstance(v, str) else v
        if s == "":
            continue
        items.append((k, s))
    items.sort(key=lambda x: x[0])
    return "&".join(f"{k}={v}" for k, v in items)


class AlipayPageProvider(BasePaymentProvider):
    """支付宝官方电脑网站支付：alipay.trade.page.pay"""

    id = "alipay"
    name = "支付宝电脑网站支付"
    desc = "官方开放平台电脑网站支付（alipay.trade.page.pay），资金直达支付宝商户。"
    docs = "https://opendocs.alipay.com/open/270/105899"

    def default_config(self) -> Dict[str, Any]:
        return AlipayPageConfig().model_dump()

    def normalize_config(self, config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        data = dict(config or {})
        methods = data.get("methods")
        if not isinstance(methods, dict):
            data["methods"] = {"alipay": True}
        else:
            data["methods"] = {"alipay": bool(methods.get("alipay", True))}
        return AlipayPageConfig(**data).model_dump()

    def enabled_methods(self, config: Dict[str, Any]) -> List[str]:
        methods = (config or {}).get("methods") or {}
        return [code for code in ("alipay",) if methods.get(code) and code in METHOD_LABELS]

    def is_ready(self, config: Dict[str, Any]) -> bool:
        cfg = config or {}
        return bool(
            str(cfg.get("app_id") or "").strip()
            and str(cfg.get("app_private_key") or "").strip()
            and str(cfg.get("alipay_public_key") or "").strip()
        )

    def gateway(self, config: Dict[str, Any]) -> str:
        return GATEWAY_SANDBOX if (config or {}).get("sandbox") else GATEWAY_PROD

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
        del pay_type  # 电脑网站支付仅支付宝
        cfg = AlipayPageConfig(**(config or {}))
        biz = {
            "out_trade_no": out_trade_no,
            "product_code": "FAST_INSTANT_TRADE_PAY",
            "total_amount": f"{float(money):.2f}",
            "subject": (name or "领匣订单")[:256],
        }
        params: Dict[str, str] = {
            "app_id": cfg.app_id.strip(),
            "method": "alipay.trade.page.pay",
            "format": "JSON",
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "version": "1.0",
            "notify_url": notify_url,
            "return_url": return_url,
            "biz_content": json.dumps(biz, ensure_ascii=False, separators=(",", ":")),
        }
        unsigned = _ordered_unsigned(params, exclude={"sign"})
        params["sign"] = _sign_rsa2(unsigned, cfg.app_private_key)
        query = urlencode(params, quote_via=quote_plus)
        return f"{self.gateway(config)}?{query}"

    def verify_notify(self, config: Dict[str, Any], params: Mapping[str, Any]) -> bool:
        cfg = AlipayPageConfig(**(config or {}))
        sign = str(params.get("sign") or "")
        if not sign:
            return False
        unsigned = _ordered_unsigned(params, exclude={"sign", "sign_type"})
        return _verify_rsa2(unsigned, sign, cfg.alipay_public_key)
