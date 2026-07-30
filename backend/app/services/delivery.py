from __future__ import annotations

import random
import string


def random_id(prefix: str = "") -> str:
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"{prefix}{suffix}"
