from __future__ import annotations

import base64
import io
import random
import uuid
from datetime import datetime, timedelta

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from ..models import Captcha


CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def create_captcha(db: Session) -> tuple:
    code = "".join(random.choice(CHARS) for _ in range(4))
    captcha_id = str(uuid.uuid4())

    # cleanup old captchas
    cutoff = datetime.utcnow() - timedelta(minutes=10)
    db.query(Captcha).filter(Captcha.created_at < cutoff).delete()

    db.add(Captcha(id=captcha_id, code=code))
    db.commit()

    img = Image.new("RGB", (110, 42), (232, 241, 238))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except Exception:
        font = ImageFont.load_default()

    for _ in range(30):
        x, y = random.randint(0, 109), random.randint(0, 41)
        color = (
            random.randint(40, 180),
            random.randint(40, 180),
            random.randint(40, 180),
        )
        draw.point((x, y), fill=color)

    for i, ch in enumerate(code):
        x = 12 + i * 24
        y = random.randint(6, 12)
        color = (
            random.randint(20, 80),
            random.randint(40, 100),
            random.randint(30, 90),
        )
        draw.text((x, y), ch, fill=color, font=font)

    for _ in range(3):
        draw.line(
            (
                random.randint(0, 110),
                random.randint(0, 42),
                random.randint(0, 110),
                random.randint(0, 42),
            ),
            fill=(
                random.randint(60, 160),
                random.randint(60, 160),
                random.randint(60, 160),
            ),
            width=1,
        )

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return captcha_id, "data:image/png;base64," + b64


def verify_captcha(db: Session, captcha_id: str, code: str) -> bool:
    row = db.query(Captcha).filter(Captcha.id == captcha_id).first()
    if not row:
        return False
    ok = row.code.upper() == (code or "").strip().upper()
    db.delete(row)
    db.commit()
    return ok
