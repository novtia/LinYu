from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ..models import CommissionMessage, CommissionThread
from .chat_hub import hub
from .commission_chat import message_out, thread_out


def _dump_msg(msg: CommissionMessage, role: str, order_status: Optional[str] = None) -> dict:
    return message_out(msg, viewer_role=role, order_status=order_status).model_dump(mode="json")


def _dump_thread(db: Session, thread: CommissionThread) -> dict:
    return thread_out(db, thread).model_dump(mode="json")


def _order_status(db: Session, thread: CommissionThread) -> Optional[str]:
    from ..models import Order

    if not thread.order_id:
        return None
    status = db.query(Order.status).filter(Order.id == thread.order_id).scalar()
    return str(status) if status else None


def emit_message(db: Session, thread: CommissionThread, msg: CommissionMessage) -> None:
    status = _order_status(db, thread)
    hub.publish_sync(
        thread.user_id,
        {
            "type": "message",
            "thread_id": thread.id,
            "message_user": _dump_msg(msg, "user", status),
            "message_admin": _dump_msg(msg, "admin", status),
            "thread": _dump_thread(db, thread),
        },
    )


def emit_recalls(db: Session, thread: CommissionThread, messages: Iterable[CommissionMessage]) -> None:
    rows = [m for m in messages if m is not None]
    if not rows:
        return
    status = _order_status(db, thread)
    hub.publish_sync(
        thread.user_id,
        {
            "type": "recall",
            "thread_id": thread.id,
            "messages_user": [_dump_msg(m, "user", status) for m in rows],
            "messages_admin": [_dump_msg(m, "admin", status) for m in rows],
            "thread": _dump_thread(db, thread),
        },
    )


def emit_read(db: Session, thread: CommissionThread, role: str) -> None:
    hub.publish_sync(
        thread.user_id,
        {
            "type": "read",
            "thread_id": thread.id,
            "role": role,
            "thread": _dump_thread(db, thread),
        },
    )
