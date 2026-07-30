from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    disabled: bool
    created_at: datetime

    class Config:
        from_attributes = True


class LoginIn(BaseModel):
    username: str
    password: str
    captcha_id: str
    captcha: str


class RegisterIn(BaseModel):
    username: str
    password: str
    captcha_id: str
    captcha: str


class CaptchaOut(BaseModel):
    captcha_id: str
    image: str


class ProductOut(BaseModel):
    id: str
    name: str
    type: str
    price: float
    desc: str
    cover: str
    cover_url: Optional[str] = None
    tag: str
    status: str
    file_name: Optional[str] = None
    has_file: bool = False

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_product(cls, p) -> "ProductOut":
        from .services.files import cover_public_url

        return cls(
            id=p.id,
            name=p.name,
            type=p.type,
            price=p.price,
            desc=p.desc,
            cover=p.cover or "p1",
            cover_url=cover_public_url(getattr(p, "cover_image", None)),
            tag=p.tag,
            status=p.status,
            file_name=p.file_name,
            has_file=bool(p.file_path),
        )


class ProductIn(BaseModel):
    id: Optional[str] = None
    name: str
    type: str = "key"
    price: float
    desc: str = ""
    cover: str = "p1"
    tag: Optional[str] = None
    status: str = "on"


class CoverUploadOut(BaseModel):
    cover_url: str
    message: str = "封面已上传"


class CartItemIn(BaseModel):
    id: str
    name: str
    price: float


class CheckoutIn(BaseModel):
    items: List[CartItemIn] = Field(min_length=1)


class DeliveryOut(BaseModel):
    id: str
    order_id: str
    product_id: str
    product_name: str
    payload: str
    file_name: Optional[str] = None
    download_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class OrderItemOut(BaseModel):
    product_id: str
    name: str
    price: float
    payload: Optional[str] = None
    file_name: Optional[str] = None
    download_url: Optional[str] = None


class OrderOut(BaseModel):
    id: str
    username: str
    total: float
    status: str
    created_at: datetime
    items: List[OrderItemOut]


class CheckoutOut(BaseModel):
    order: OrderOut
    deliveries: List[DeliveryOut]


class DashboardOut(BaseModel):
    today_orders: int
    users: int
    products_on: int
    deliveries: int
    recent_orders: List[OrderOut]


class PaySettings(BaseModel):
    alipay: bool = True
    wechat: bool = False
    usdt: bool = False
    alipayPid: str = ""
    alipayKey: str = ""
    wechatMch: str = ""
    wechatKey: str = ""
    usdtAddr: str = ""


class SysSettings(BaseModel):
    name: str = "领匣"
    email: str = "support@lingxia.demo"
    notify: str = ""
    autoDeliver: bool = True
    allowReg: bool = True
    maintain: bool = False


class SiteSettings(BaseModel):
    title: str = "领匣 · 虚拟商品在线售卖"
    keywords: str = "虚拟商品,卡密,兑换码,自动发货"
    desc: str = "卡密、兑换码与数字文件一站售卖。付款后写入领取匣，即时交付。"
    notice: str = "演示站点，支付与发货均为模拟流程。"


class SettingsOut(BaseModel):
    pay: PaySettings
    sys: SysSettings
    site: SiteSettings


class PublicSettingsOut(BaseModel):
    title: str
    notice: str
    allowReg: bool
    maintain: bool
    name: str


class MessageOut(BaseModel):
    message: str


class UploadOut(BaseModel):
    file_name: str
    has_file: bool = True


TokenOut.model_rebuild()
