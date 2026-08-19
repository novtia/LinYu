from __future__ import annotations

import secrets
import string

_ALPHABET = string.ascii_lowercase + string.digits


def random_id(prefix: str = "", length: int = 6) -> str:
    """生成随机业务 ID 后缀（密码学随机，避免被预测枚举）。"""
    suffix = "".join(secrets.choice(_ALPHABET) for _ in range(length))
    return f"{prefix}{suffix}"
