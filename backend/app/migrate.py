from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def migrate_schema(engine: Engine) -> None:
    """Add new columns to existing SQLite tables if missing."""
    alterations = {
        "products": [
            ("file_path", "VARCHAR(512)"),
            ("file_name", "VARCHAR(255)"),
            ("cover_image", "VARCHAR(512)"),
        ],
        "deliveries": [
            ("file_path", "VARCHAR(512)"),
            ("file_name", "VARCHAR(255)"),
        ],
        "orders": [
            ("payment_channel_id", "VARCHAR(64)"),
            ("payment_method", "VARCHAR(32)"),
            ("payment_provider", "VARCHAR(32)"),
            ("trade_no", "VARCHAR(128)"),
            ("paid_at", "DATETIME"),
        ],
    }
    with engine.begin() as conn:
        for table, cols in alterations.items():
            existing = {
                row[1]
                for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            }
            for name, coltype in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {coltype}"))
