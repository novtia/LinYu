from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import PaymentChannel
from ..services.delivery import random_id
from .constants import METHOD_LABELS
from .providers import get_provider, known_provider_ids, list_providers
from .schemas import (
    PaymentChannelIn,
    PaymentChannelOut,
    PaymentProviderOut,
    PublicPaymentMethodOut,
    PublicPaymentMethodsOut,
)


def parse_config(raw: Optional[str]) -> Dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def serialize_channel(ch: PaymentChannel) -> PaymentChannelOut:
    return PaymentChannelOut(
        id=ch.id,
        name=ch.name,
        provider=ch.provider,
        enabled=ch.enabled,
        config=parse_config(ch.config_json),
        created_at=ch.created_at,
        updated_at=ch.updated_at,
    )


def list_provider_catalog() -> List[PaymentProviderOut]:
    return [PaymentProviderOut(**p.public_meta()) for p in list_providers()]


def normalize_channel_config(provider: str, config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    adapter = get_provider(provider)
    if not adapter:
        raise HTTPException(status_code=400, detail="暂不支持该渠道商")
    return adapter.normalize_config(config)


def ensure_provider(provider: str) -> None:
    if provider not in known_provider_ids():
        raise HTTPException(status_code=400, detail="暂不支持该渠道商")


def validate_channel_input(body: PaymentChannelIn) -> str:
    ensure_provider(body.provider)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请填写渠道名称")
    return name


def list_channels(db: Session) -> List[PaymentChannelOut]:
    rows = db.query(PaymentChannel).order_by(PaymentChannel.created_at.desc()).all()
    return [serialize_channel(r) for r in rows]


def get_channel(db: Session, channel_id: str) -> PaymentChannel:
    ch = db.query(PaymentChannel).filter(PaymentChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="渠道不存在")
    return ch


def create_channel(db: Session, body: PaymentChannelIn) -> PaymentChannelOut:
    name = validate_channel_input(body)
    now = datetime.utcnow()
    ch = PaymentChannel(
        id="pay_" + random_id(),
        name=name,
        provider=body.provider,
        enabled=body.enabled,
        config_json=json.dumps(normalize_channel_config(body.provider, body.config), ensure_ascii=False),
        created_at=now,
        updated_at=now,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return serialize_channel(ch)


def update_channel(db: Session, channel_id: str, body: PaymentChannelIn) -> PaymentChannelOut:
    ch = get_channel(db, channel_id)
    name = validate_channel_input(body)
    ch.name = name
    ch.provider = body.provider
    ch.enabled = body.enabled
    ch.config_json = json.dumps(normalize_channel_config(body.provider, body.config), ensure_ascii=False)
    ch.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ch)
    return serialize_channel(ch)


def toggle_channel(db: Session, channel_id: str) -> PaymentChannelOut:
    ch = get_channel(db, channel_id)
    ch.enabled = not ch.enabled
    ch.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ch)
    return serialize_channel(ch)


def delete_channel(db: Session, channel_id: str) -> None:
    ch = get_channel(db, channel_id)
    db.delete(ch)
    db.commit()


def list_public_methods(db: Session) -> PublicPaymentMethodsOut:
    """汇总已启用且配置完整的渠道，展开为前台可选支付方式。"""
    rows = (
        db.query(PaymentChannel)
        .filter(PaymentChannel.enabled.is_(True))
        .order_by(PaymentChannel.created_at.asc())
        .all()
    )
    methods: List[PublicPaymentMethodOut] = []
    for ch in rows:
        adapter = get_provider(ch.provider)
        if not adapter:
            continue
        config = parse_config(ch.config_json)
        if not adapter.is_ready(config):
            continue
        for method in adapter.enabled_methods(config):
            methods.append(
                PublicPaymentMethodOut(
                    id=f"{ch.id}:{method}",
                    method=method,
                    label=METHOD_LABELS.get(method, method),
                    channel_id=ch.id,
                    channel_name=ch.name,
                    provider=ch.provider,
                    provider_name=adapter.name,
                )
            )
    return PublicPaymentMethodsOut(methods=methods)
