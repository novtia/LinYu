from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_admin_user
from ..models import User
from ..payment import service as payment_service
from ..payment.schemas import PaymentChannelIn, PaymentChannelOut, PaymentProviderOut
from ..schemas import MessageOut

router = APIRouter(prefix="/api/payment-channels", tags=["payment-channels"])


@router.get("/providers", response_model=List[PaymentProviderOut])
def list_providers(_: User = Depends(get_admin_user)):
    return payment_service.list_provider_catalog()


@router.get("", response_model=List[PaymentChannelOut])
def list_channels(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return payment_service.list_channels(db)


@router.get("/{channel_id}", response_model=PaymentChannelOut)
def get_channel(
    channel_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return payment_service.serialize_channel(payment_service.get_channel(db, channel_id))


@router.post("", response_model=PaymentChannelOut)
def create_channel(
    body: PaymentChannelIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return payment_service.create_channel(db, body)


@router.put("/{channel_id}", response_model=PaymentChannelOut)
def update_channel(
    channel_id: str,
    body: PaymentChannelIn,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return payment_service.update_channel(db, channel_id, body)


@router.patch("/{channel_id}/toggle", response_model=PaymentChannelOut)
def toggle_channel(
    channel_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return payment_service.toggle_channel(db, channel_id)


@router.delete("/{channel_id}", response_model=MessageOut)
def delete_channel(
    channel_id: str,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    payment_service.delete_channel(db, channel_id)
    return MessageOut(message="已删除")
