from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BasePaymentProvider(ABC):
    """支付渠道商适配基类。新增渠道商时在此实现并注册到 providers 包。"""

    id: str
    name: str
    desc: str
    docs: str

    @abstractmethod
    def default_config(self) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def normalize_config(self, config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def enabled_methods(self, config: Dict[str, Any]) -> List[str]:
        """返回该渠道配置下已开启的支付方式 method 列表，如 alipay / wxpay。"""
        raise NotImplementedError

    def is_ready(self, config: Dict[str, Any]) -> bool:
        """渠道是否具备对外收款的最小配置（公开接口只返回 ready 的渠道方式）。"""
        return True

    def public_meta(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "desc": self.desc,
            "docs": self.docs,
            "default_config": self.default_config(),
        }
