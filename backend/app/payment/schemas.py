from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from pydantic import BaseModel, Field

# 兼容旧导入路径：易支付配置模型仍从 providers.ezpay 导出
from .providers.ezpay import EzpayConfig, EzpayMethods  # noqa: F401


class PaymentChannelIn(BaseModel):
    name: str
    provider: str = "ezpay"
    enabled: bool = False
    config: Dict[str, Any] = Field(default_factory=dict)


class PaymentChannelOut(BaseModel):
    id: str
    name: str
    provider: str
    enabled: bool
    config: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


class PaymentProviderOut(BaseModel):
    id: str
    name: str
    desc: str
    docs: str
    default_config: Dict[str, Any]


class PublicPaymentMethodOut(BaseModel):
    """前台结算可用的支付方式（不含密钥等敏感字段）。"""

    id: str  # 唯一选项 ID：{channel_id}:{method}
    method: str  # alipay | wxpay | qqpay
    label: str
    channel_id: str
    channel_name: str
    provider: str
    provider_name: str


class PublicPaymentMethodsOut(BaseModel):
    methods: List[PublicPaymentMethodOut]
