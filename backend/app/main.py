from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .auth import check_secret_config
from .database import Base, SessionLocal, engine
from .migrate import migrate_schema
from .origins import cors_origins
from .routers import auth, captcha, categories, commission_chat, deliveries, downloads, orders, pay, payment, payment_channels, products, reader, settings, users, ws
from .seed import seed_if_empty
from .services.chat_hub import hub
from .services.files import ASSET_DIR, COVER_DIR, ensure_upload_dir
from .services.order_expiry import purge_expired_unpaid_orders
from .services.usdt_payment import poll_pending_usdt_invoices

logger = logging.getLogger("lingxia")


async def _purge_expired_orders_loop() -> None:
    while True:
        await asyncio.sleep(300)
        db = SessionLocal()
        try:
            purge_expired_unpaid_orders(db)
        except Exception:
            logger.exception("清除过期未支付订单失败")
            db.rollback()
        finally:
            db.close()


async def _usdt_monitor_loop() -> None:
    while True:
        await asyncio.sleep(8)
        try:
            await asyncio.to_thread(poll_pending_usdt_invoices)
        except Exception:
            logger.exception("USDT 链上入账轮询异常")


@asynccontextmanager
async def lifespan(_: FastAPI):
    hub.bind_loop(asyncio.get_running_loop())
    check_secret_config()
    ensure_upload_dir()
    Base.metadata.create_all(bind=engine)
    migrate_schema(engine)
    db = SessionLocal()
    try:
        seed_if_empty(db)
        purge_expired_unpaid_orders(db)
    except Exception:
        logger.exception("启动时清除过期未支付订单失败")
        db.rollback()
    finally:
        db.close()
    purge_task = asyncio.create_task(_purge_expired_orders_loop())
    usdt_task = asyncio.create_task(_usdt_monitor_loop())
    yield
    usdt_task.cancel()
    purge_task.cancel()
    await hub.close_all()


app = FastAPI(title="领匣 API", version="1.0.0", lifespan=lifespan)

_cors_origins = cors_origins()

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
app.include_router(ws.router)
app.include_router(pay.router)
app.include_router(users.router)
app.include_router(deliveries.router)
app.include_router(downloads.router)
app.include_router(reader.router)
app.include_router(settings.router)
app.include_router(payment_channels.router)
app.include_router(payment.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
