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
    email: Optional[str] = None
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
    email: str
    password: str
    captcha_id: str
    captcha: str


class AccountUpdateIn(BaseModel):
    current_password: str
    username: Optional[str] = None
    email: Optional[str] = None
    new_password: Optional[str] = None


class ForgotPasswordIn(BaseModel):
    account: str  # username or email
    captcha_id: str
    captcha: str


class ResetPasswordIn(BaseModel):
    account: str
    code: str
    new_password: str


class ContactIn(BaseModel):
    name: str
    email: str
    message: str
    captcha_id: str
    captcha: str


class CaptchaOut(BaseModel):
    captcha_id: str
    image: str


class CategoryOut(BaseModel):
    id: int
    name: str
    sort_order: int
    enabled: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CategoryIn(BaseModel):
    name: str
    sort_order: int = 0
    enabled: bool = True


class ProductOut(BaseModel):
    id: int
    name: str
    price: float
    desc: str
    cover: str
    cover_url: Optional[str] = None
    status: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    delivery_content: Optional[str] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_product(cls, p, *, include_delivery: bool = False) -> "ProductOut":
        from .services.files import cover_public_url

        cat = getattr(p, "category", None)
        return cls(
            id=p.id,
            name=p.name,
            price=p.price,
            desc=p.desc or "",
            cover=p.cover or "p1",
            cover_url=cover_public_url(getattr(p, "cover_image", None)),
            status=p.status,
            category_id=p.category_id,
            category_name=cat.name if cat else None,
            delivery_content=(p.delivery_content or "") if include_delivery else None,
        )


class ProductIn(BaseModel):
    name: str
    price: float
    desc: str = ""
    delivery_content: str = ""
    cover: str = "p1"
    status: str = "on"
    category_id: Optional[int] = None


class CoverUploadOut(BaseModel):
    cover_url: str
    message: str = "封面已上传"


class AssetUploadOut(BaseModel):
    url: str
    file_name: str
    message: str = "上传成功"


class CartItemIn(BaseModel):
    id: int
    name: str
    price: float


class CheckoutIn(BaseModel):
    items: List[CartItemIn] = Field(min_length=1)
    payment_method_id: str = Field(default="", description="公开支付方式 ID：{channel_id}:{method}；调试模式可留空")


class DeliveryOut(BaseModel):
    id: str
    order_id: str
    product_id: int
    product_name: str
    payload: str
    file_name: Optional[str] = None
    download_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class OrderItemOut(BaseModel):
    product_id: int
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
    payment_method: Optional[str] = None
    payment_provider: Optional[str] = None
    trade_no: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime
    items: List[OrderItemOut]


class CheckoutOut(BaseModel):
    order: OrderOut
    pay_url: str
    deliveries: List[DeliveryOut] = Field(default_factory=list)


class DashboardOut(BaseModel):
    today_orders: int
    users: int
    products_on: int
    deliveries: int
    recent_orders: List[OrderOut]


class MailSettings(BaseModel):
    """AokSend 邮件配置。模板变量见系统设置页说明。"""

    enabled: bool = False
    app_key: str = ""
    alias: str = "领匣"
    reply_to: str = ""
    template_buyer: str = ""  # 买家发货通知
    template_admin_order: str = ""  # 管理员新订单
    template_reset: str = ""  # 找回密码
    template_contact: str = ""  # 联系表单


class SysSettings(BaseModel):
    name: str = "领匣"
    email: str = "support@lingxia.com"
    notify: str = ""
    autoDeliver: bool = True
    allowReg: bool = True
    maintain: bool = False
    debugMode: bool = False
    mail: MailSettings = Field(default_factory=MailSettings)


class SiteSettings(BaseModel):
    title: str = "领匣 · 虚拟商品在线售卖"
    keywords: str = "虚拟商品,自动发货"
    desc: str = "虚拟商品一站售卖。付款成功后自动发货，订单内随时查看。"
    notice: str = "欢迎选购。支付成功后将自动发货，内容可在「我的订单」查看。"


class SettingsOut(BaseModel):
    sys: SysSettings
    site: SiteSettings


class PublicSettingsOut(BaseModel):
    title: str
    notice: str
    allowReg: bool
    maintain: bool
    name: str
    debugMode: bool = False


class MessageOut(BaseModel):
    message: str


TokenOut.model_rebuild()
