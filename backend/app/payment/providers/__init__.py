from __future__ import annotations

from typing import Dict, List, Optional

from .base import BasePaymentProvider
from .ezpay import EzpayProvider

_REGISTRY: List[BasePaymentProvider] = [
    EzpayProvider(),
]

_BY_ID: Dict[str, BasePaymentProvider] = {p.id: p for p in _REGISTRY}


def list_providers() -> List[BasePaymentProvider]:
    return list(_REGISTRY)


def get_provider(provider_id: str) -> Optional[BasePaymentProvider]:
    return _BY_ID.get(provider_id)


def known_provider_ids() -> set:
    return set(_BY_ID.keys())
