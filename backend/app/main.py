from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import Base, SessionLocal, engine
from .migrate import migrate_schema
from .routers import auth, captcha, deliveries, downloads, orders, payment, payment_channels, products, settings, users
from .seed import seed_if_empty
from .services.files import UPLOAD_DIR, ensure_upload_dir


@asynccontextmanager
async def lifespan(_: FastAPI):
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_upload_dir()
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(auth.router)
app.include_router(captcha.router)
app.include_router(products.router)
app.include_router(orders.router)
app.include_router(users.router)
app.include_router(deliveries.router)
app.include_router(downloads.router)
app.include_router(settings.router)
app.include_router(payment_channels.router)
app.include_router(payment.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
