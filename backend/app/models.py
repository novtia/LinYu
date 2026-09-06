from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # 每次改密 / 重置密码自增，使旧 JWT 立即失效
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    orders: Mapped[List["Order"]] = relationship(back_populates="user")


class EmailCode(Base):
    __tablename__ = "email_codes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(128), index=True)
    purpose: Mapped[str] = mapped_column(String(32), default="reset")
    code: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    products: Mapped[List["Product"]] = relationship(back_populates="category")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    price: Mapped[float] = mapped_column(Float)
    desc: Mapped[str] = mapped_column(Text, default="")
    delivery_content: Mapped[str] = mapped_column(Text, default="")
    cover: Mapped[str] = mapped_column(String(16), default="p1")
    cover_image: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # 付费数字文件，仅经鉴权下载接口发放
    file_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="on")  # on | off
    # normal = 一次付清立即发货；commission = 定金 / 交稿 / 尾款解锁
    sale_mode: Mapped[str] = mapped_column(String(16), default="normal", server_default="normal")
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True)

    category: Mapped[Optional["Category"]] = relationship(back_populates="products")
    files: Mapped[List["ProductFile"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductFile.sort_order",
    )


class ProductFile(Base):
    __tablename__ = "product_files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    file_path: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    product: Mapped["Product"] = relationship(back_populates="files")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("users.id"), nullable=True)
    username: Mapped[str] = mapped_column(String(64))
    email: Mapped[str] = mapped_column(String(128), index=True, default="")
    total: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | deposit_paid | awaiting_balance | paid | completed | failed | cancelled
    sale_mode: Mapped[str] = mapped_column(String(16), default="normal", server_default="normal")
    payment_channel_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    payment_provider: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    trade_no: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    word_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    user: Mapped[Optional["User"]] = relationship(back_populates="orders")
    items: Mapped[List["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    deliveries: Mapped[List["Delivery"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    payments: Mapped[List["OrderPayment"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(String(64), ForeignKey("orders.id"))
    product_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(128))
    price: Mapped[float] = mapped_column(Float)

    order: Mapped["Order"] = relationship(back_populates="items")


class OrderPayment(Base):
    __tablename__ = "order_payments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), ForeignKey("orders.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # deposit | balance | full
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | paid
    trade_no: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    payment_channel_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    payment_provider: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    order: Mapped["Order"] = relationship(back_populates="payments")


class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), ForeignKey("orders.id"))
    product_id: Mapped[int] = mapped_column(Integer)
    product_name: Mapped[str] = mapped_column(String(128))
    payload: Mapped[str] = mapped_column(Text)
    file_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    order: Mapped["Order"] = relationship(back_populates="deliveries")
    files: Mapped[List["DeliveryFile"]] = relationship(
        back_populates="delivery",
        cascade="all, delete-orphan",
        order_by="DeliveryFile.sort_order",
    )


class DeliveryFile(Base):
    __tablename__ = "delivery_files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    delivery_id: Mapped[str] = mapped_column(String(64), ForeignKey("deliveries.id"), index=True)
    file_path: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    delivery: Mapped["Delivery"] = relationship(back_populates="files")


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    pay_json: Mapped[str] = mapped_column(Text, default="{}")
    sys_json: Mapped[str] = mapped_column(Text, default="{}")
    site_json: Mapped[str] = mapped_column(Text, default="{}")


class PaymentChannel(Base):
    __tablename__ = "payment_channels"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    provider: Mapped[str] = mapped_column(String(32), index=True)  # ezpay
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Captcha(Base):
    __tablename__ = "captchas"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CommissionThread(Base):
    __tablename__ = "commission_threads"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id", name="uq_commission_thread_user_product"),
        Index("ix_commission_threads_updated_at", "updated_at"),
        Index("ix_commission_threads_unread_admin", "unread_admin"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    product_id: Mapped[int] = mapped_column(Integer, index=True)
    unread_admin: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    unread_user: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_preview: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_kind: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    messages: Mapped[List["CommissionMessage"]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="CommissionMessage.id",
    )


class CommissionMessage(Base):
    __tablename__ = "commission_messages"
    __table_args__ = (Index("ix_commission_messages_thread_created", "thread_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(String(64), ForeignKey("commission_threads.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | admin | system
    type: Mapped[str] = mapped_column(String(16), default="text")  # text | image | file | emoji | system
    body: Mapped[str] = mapped_column(Text, default="")
    file_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    recalled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    thread: Mapped["CommissionThread"] = relationship(back_populates="messages")
