from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Callable, Deque, Dict

from fastapi import HTTPException, Request

# 单进程内存限流：后端以 workers=1 运行，够用且不引入额外依赖。
_MAX_AGE = 3600.0
_SWEEP_INTERVAL = 120.0

# 仅当部署在 Cloudflare / Nginx 等反向代理之后（且源站不直接暴露）时，
# 才信任代理写入的客户端 IP 头；否则攻击者可伪造这些头绕过限流。
TRUST_PROXY_HEADERS = (os.getenv("TRUST_PROXY_HEADERS") or "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)


def client_ip(request: Request) -> str:
    """取客户端 IP：信任代理头时读 Cloudflare / Nginx 转发头，否则用直连 IP。"""
    if TRUST_PROXY_HEADERS:
        for header in ("cf-connecting-ip", "x-real-ip"):
            value = (request.headers.get(header) or "").strip()
            if value:
                return value
        forwarded = request.headers.get("x-forwarded-for") or ""
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = 0.0

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < _SWEEP_INTERVAL:
            return
        self._last_sweep = now
        for key in list(self._hits):
            bucket = self._hits[key]
            while bucket and now - bucket[0] >= _MAX_AGE:
                bucket.popleft()
            if not bucket:
                del self._hits[key]

    def hit(self, key: str, limit: int, window: float) -> float:
        """记录一次访问，返回仍需等待的秒数（0 表示放行）。"""
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            bucket = self._hits[key]
            while bucket and now - bucket[0] >= window:
                bucket.popleft()
            if len(bucket) >= limit:
                return max(window - (now - bucket[0]), 1.0)
            bucket.append(now)
            return 0.0

    def count(self, key: str, window: float) -> int:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits[key]
            while bucket and now - bucket[0] >= window:
                bucket.popleft()
            return len(bucket)

    def record(self, key: str) -> None:
        with self._lock:
            self._hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


limiter = SlidingWindowLimiter()


def rate_limit(
    name: str,
    *,
    limit: int,
    window: int,
    detail: str = "操作过于频繁，请稍后再试",
) -> Callable[[Request], None]:
    """按客户端 IP 限流的路由依赖。"""

    def dependency(request: Request) -> None:
        wait = limiter.hit(f"{name}:{client_ip(request)}", limit, window)
        if wait > 0:
            raise HTTPException(
                status_code=429,
                detail=detail,
                headers={"Retry-After": str(int(wait) + 1)},
            )

    return dependency


def guard_failures(name: str, key: str, *, limit: int, window: int, detail: str) -> None:
    """失败次数达到上限时直接拒绝（用于账号级暴力破解防护）。"""
    if limiter.count(f"{name}:{key}", window) >= limit:
        raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": str(window)})


def record_failure(name: str, key: str) -> None:
    limiter.record(f"{name}:{key}")


def clear_failures(name: str, key: str) -> None:
    limiter.reset(f"{name}:{key}")
