from __future__ import annotations

import random
import string
from typing import Optional

from ..models import Product


def _rand(n: int) -> str:
    chars = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(random.choice(chars) for _ in range(n))


def generate_payload(product: Optional[Product], product_id: str, product_type: str = "key") -> str:
    """按商品类型生成发货内容（文件商品返回文件名，卡密/兑换码即时生成）。"""
    if product and product.type == "file" and product.file_path:
        return product.file_name or "下载文件"
    if product_type == "file":
        return "文件待上传，请联系客服"
    if product_type == "code":
        return "REDEEM-" + _rand(8).upper()
    return "LX-" + _rand(4).upper() + "-" + _rand(4).upper() + "-" + _rand(4).upper()


def random_id(prefix: str = "") -> str:
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"{prefix}{suffix}"
