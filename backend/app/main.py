from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .auth import check_secret_config
from .database import Base, SessionLocal, engine
from .migrate import migrate_schema
from .routers import auth, captcha, categories, commission_chat, deliveries, downloads, orders, pay, payment, payment_channels, products, settings, users
from .seed import seed_if_empty
from .services.files import ASSET_DIR, COVER_DIR, ensure_upload_dir


@asynccontextmanager
async def lifespan(_: FastAPI):
    check_secret_config()
    ensure_upload_dir()
    Base.metadata.create_all(bind=engine)
    migrate_schema(engine)
    db = SessionLocal()
    try:
        seed_if_empty(db)
    finally:
        db.close()
    yield


app = FastAPI(title="领匣 API", version="1.0.0", lifespan=lifespan)

_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "https://xingx.shop",
    "https://www.xingx.shop",
]
_extra_origin = os.getenv("FRONTEND_URL", "").rstrip("/")
if _extra_origin and _extra_origin not in _cors_origins:
    _cors_origins.append(_extra_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


ensure_upload_dir()
# 仅公开封面与富文本附件；付费文件走 /api/downloads 鉴权发放
app.mount("/uploads/covers", StaticFiles(directory=str(COVER_DIR)), name="covers")
app.mount("/uploads/assets", StaticFiles(directory=str(ASSET_DIR)), name="assets")

app.include_router(auth.router)
app.include_router(captcha.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(orders.router)
app.include_router(commission_chat.router)
app.include_router(pay.router)
app.include_router(users.router)
app.include_router(deliveries.router)
app.include_router(downloads.router)
app.include_router(settings.router)
app.include_router(payment_channels.router)
app.include_router(payment.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
