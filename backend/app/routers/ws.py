from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from ..database import SessionLocal
from ..deps import user_from_token
from ..origins import cors_origins
from ..services.chat_hub import hub, kick, safe_close

logger = logging.getLogger("lingxia.ws")

router = APIRouter()

AUTH_TIMEOUT = 5.0
PING_INTERVAL = 25.0
ALLOWED_ORIGINS = {o.rstrip("/") for o in cors_origins()}


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        return True
    return origin in ALLOWED_ORIGINS


@router.websocket("/api/ws")
async def chat_ws(websocket: WebSocket):
    if not _origin_allowed(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    user_id = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send_json({"type": "error", "detail": "无效的认证消息"})
            await websocket.close(code=1008)
            return
        if not isinstance(payload, dict) or payload.get("type") != "auth":
            await websocket.send_json({"type": "error", "detail": "请先认证"})
            await websocket.close(code=1008)
            return
        token = str(payload.get("token") or "").strip()
        db = SessionLocal()
        try:
            user = user_from_token(token, db)
        finally:
            db.close()
        if not user:
            await websocket.send_json({"type": "error", "detail": "登录已失效"})
            await websocket.close(code=4401)
            return
        user_id = user.id
        is_admin = user.role == "admin"
        dropped = hub.connect(websocket, user.id, is_admin)
        for old in dropped:
            await kick(old, 1008)
        await websocket.send_json({"type": "ready", "role": user.role})
        await _listen(websocket)
    except asyncio.TimeoutError:
        await safe_close(websocket, 1008)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("websocket error user=%s", user_id)
        await safe_close(websocket, 1011)
    finally:
        hub.disconnect(websocket)


async def _listen(websocket: WebSocket) -> None:
    while True:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=PING_INTERVAL)
        except asyncio.TimeoutError:
            await websocket.send_json({"type": "ping"})
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("type") == "ping":
            await websocket.send_json({"type": "pong"})
