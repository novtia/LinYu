from __future__ import annotations

import os


def cors_origins() -> list[str]:
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "https://xinx.shop",
        "https://www.xinx.shop",
    ]
    extra = os.getenv("FRONTEND_URL", "").rstrip("/")
    if extra and extra not in origins:
        origins.append(extra)
    return origins
