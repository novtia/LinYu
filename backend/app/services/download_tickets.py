from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass
from typing import Optional

TTL_SECONDS = 120
MAX_TICKETS = 400


@dataclass
class DownloadTicket:
    path: str
    filename: str
    exp: float


_lock = threading.Lock()
_tickets: dict[str, DownloadTicket] = {}


def _purge_unlocked(now: float) -> None:
    dead = [k for k, t in _tickets.items() if t.exp <= now]
    for k in dead:
        _tickets.pop(k, None)
    extra = len(_tickets) - MAX_TICKETS
    if extra <= 0:
        return
    oldest = sorted(_tickets.items(), key=lambda kv: kv[1].exp)[:extra]
    for k, _ in oldest:
        _tickets.pop(k, None)


def issue_ticket(path: str, filename: str) -> str:
    now = time.time()
    token = secrets.token_urlsafe(18)
    with _lock:
        _purge_unlocked(now)
        _tickets[token] = DownloadTicket(path=path, filename=filename, exp=now + TTL_SECONDS)
    return token


def get_ticket(token: str) -> Optional[DownloadTicket]:
    now = time.time()
    with _lock:
        row = _tickets.get(token)
        if not row or row.exp <= now:
            _tickets.pop(token, None)
            return None
        return row
