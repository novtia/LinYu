from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Optional

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger("lingxia.ws")

MAX_CONNECTIONS_PER_USER = 5


class ChatHub:
    def __init__(self) -> None:
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._by_user: dict[str, set[WebSocket]] = defaultdict(set)
        self._admins: set[WebSocket] = set()
        self._info: dict[WebSocket, tuple[str, bool]] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def connect(self, ws: WebSocket, user_id: str, is_admin: bool) -> list[WebSocket]:
        """Register a socket. Returns sockets that exceeded the per-user cap and should be closed."""
        dropped: list[WebSocket] = []
        existing = self._by_user[user_id]
        while len(existing) >= MAX_CONNECTIONS_PER_USER:
            old = next(iter(existing))
            self.disconnect(old)
            dropped.append(old)
        existing.add(ws)
        if is_admin:
            self._admins.add(ws)
        self._info[ws] = (user_id, is_admin)
        return dropped

    def disconnect(self, ws: WebSocket) -> None:
        info = self._info.pop(ws, None)
        if not info:
            return
        user_id, is_admin = info
        group = self._by_user.get(user_id)
        if group:
            group.discard(ws)
            if not group:
                self._by_user.pop(user_id, None)
        if is_admin:
            self._admins.discard(ws)

    def publish_sync(self, user_id: str, event: dict[str, Any]) -> None:
        loop = self.loop
        if not loop or not event:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(user_id, event), loop)
        except RuntimeError:
            logger.warning("chat hub loop is closed, drop event %s", event.get("type"))

    async def _broadcast(self, user_id: str, event: dict[str, Any]) -> None:
        targets: set[WebSocket] = set(self._by_user.get(user_id) or ())
        targets.update(self._admins)
        dead: list[WebSocket] = []
        for ws in targets:
            if not await _send(ws, event):
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def close_all(self) -> None:
        sockets = list(self._info)
        for ws in sockets:
            self.disconnect(ws)
            await _close(ws, 1001)


hub = ChatHub()


async def _send(ws: WebSocket, data: dict[str, Any]) -> bool:
    if ws.client_state != WebSocketState.CONNECTED:
        return False
    try:
        await ws.send_json(data)
        return True
    except Exception:
        return False


async def _close(ws: WebSocket, code: int) -> None:
    if ws.client_state != WebSocketState.CONNECTED:
        return
    try:
        await ws.close(code=code)
    except Exception:
        pass


async def kick(ws: WebSocket, code: int = 1008) -> None:
    hub.disconnect(ws)
    await _close(ws, code)


async def safe_close(ws: WebSocket, code: int = 1000) -> None:
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.close(code=code)
    except (RuntimeError, Exception):
        pass
