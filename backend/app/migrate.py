from __future__ import annotations

import re
from urllib.parse import unquote

from sqlalchemy import text
from sqlalchemy.engine import Engine


_TYPE_CATEGORY = {
    "key": "卡密",
    "file": "数字文件",
    "code": "兑换码",
}


def _table_columns(conn, table: str) -> dict[str, str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1]: (row[2] or "").upper() for row in rows}


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": table},
    ).fetchone()
    return bool(row)


def _ensure_categories_from_types(conn) -> dict[str, int]:
    """Ensure categories exist for legacy product types; return type -> category_id."""
    mapping: dict[str, int] = {}
    for sort, (ptype, name) in enumerate(_TYPE_CATEGORY.items()):
        row = conn.execute(
            text("SELECT id FROM categories WHERE name = :name"),
            {"name": name},
        ).fetchone()
        if row:
            mapping[ptype] = int(row[0])
            continue
        conn.execute(
            text(
                "INSERT INTO categories (name, sort_order, enabled, created_at) "
                "VALUES (:name, :sort, 1, CURRENT_TIMESTAMP)"
            ),
            {"name": name, "sort": sort},
        )
        cid = conn.execute(text("SELECT last_insert_rowid()")).scalar()
        mapping[ptype] = int(cid)
    return mapping


def _legacy_delivery_content(row: dict) -> str:
    """Build markdown delivery content from legacy file product fields."""
    file_path = row.get("file_path") or ""
    file_name = row.get("file_name") or "下载文件"
    if file_path:
        url = "/uploads/" + str(file_path).replace("\\", "/").lstrip("/")
        return f"[{file_name}]({url})"
    return ""


_PRODUCT_COLUMNS = (
    ("delivery_content", "TEXT"),
    ("category_id", "INTEGER"),
    ("cover_image", "VARCHAR(512)"),
    ("file_path", "VARCHAR(512)"),
    ("file_name", "VARCHAR(255)"),
)


def _ensure_product_columns(conn) -> None:
    cols = _table_columns(conn, "products")
    for name, coltype in _PRODUCT_COLUMNS:
        if name not in cols:
            conn.execute(text(f"ALTER TABLE products ADD COLUMN {name} {coltype}"))


def _migrate_products_schema(conn) -> None:
    if not _table_exists(conn, "products"):
        return

    cols = _table_columns(conn, "products")
    id_type = cols.get("id", "")
    needs_rebuild = not id_type.startswith("INT") or "type" in cols or "delivery_content" not in cols

    if not needs_rebuild:
        _ensure_product_columns(conn)
        return

    type_to_cat = _ensure_categories_from_types(conn) if "type" in cols else {}

    conn.execute(text("DROP TABLE IF EXISTS products_new"))
    conn.execute(
        text(
            """
            CREATE TABLE products_new (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(128) NOT NULL,
                price FLOAT NOT NULL,
                "desc" TEXT,
                delivery_content TEXT,
                cover VARCHAR(16),
                cover_image VARCHAR(512),
                file_path VARCHAR(512),
                file_name VARCHAR(255),
                status VARCHAR(8),
                category_id INTEGER,
                FOREIGN KEY(category_id) REFERENCES categories (id)
            )
            """
        )
    )

    old_rows = conn.execute(text("SELECT * FROM products")).mappings().all()
    id_map: dict[str, int] = {}

    for row in old_rows:
        old_id = str(row["id"])
        ptype = str(row["type"]) if "type" in row and row["type"] else ""
        category_id = type_to_cat.get(ptype)
        delivery = ""
        if "delivery_content" in row and row["delivery_content"]:
            delivery = str(row["delivery_content"])
        elif ptype == "file":
            delivery = _legacy_delivery_content(dict(row))

        conn.execute(
            text(
                """
                INSERT INTO products_new
                    (name, price, "desc", delivery_content, cover, cover_image,
                     file_path, file_name, status, category_id)
                VALUES
                    (:name, :price, :desc, :delivery_content, :cover, :cover_image,
                     :file_path, :file_name, :status, :category_id)
                """
            ),
            {
                "name": row["name"],
                "price": row["price"],
                "desc": row["desc"] or "",
                "delivery_content": delivery,
                "cover": row["cover"] or "p1",
                "cover_image": row["cover_image"] if "cover_image" in row.keys() else None,
                "file_path": row["file_path"] if "file_path" in row.keys() else None,
                "file_name": row["file_name"] if "file_name" in row.keys() else None,
                "status": row["status"] or "on",
                "category_id": category_id,
            },
        )
        new_id = int(conn.execute(text("SELECT last_insert_rowid()")).scalar())
        id_map[old_id] = new_id
        # Also map numeric string form
        id_map[str(new_id)] = new_id

    conn.execute(text("DROP TABLE products"))
    conn.execute(text("ALTER TABLE products_new RENAME TO products"))

    # Remap order_items / deliveries product_id references
    if _table_exists(conn, "order_items"):
        items = conn.execute(text("SELECT id, product_id FROM order_items")).fetchall()
        for item_id, product_id in items:
            key = str(product_id)
            if key in id_map:
                conn.execute(
                    text("UPDATE order_items SET product_id = :pid WHERE id = :id"),
                    {"pid": id_map[key], "id": item_id},
                )

    if _table_exists(conn, "deliveries"):
        deliveries = conn.execute(text("SELECT id, product_id FROM deliveries")).fetchall()
        for delivery_id, product_id in deliveries:
            key = str(product_id)
            if key in id_map:
                conn.execute(
                    text("UPDATE deliveries SET product_id = :pid WHERE id = :id"),
                    {"pid": id_map[key], "id": delivery_id},
                )


_LEGACY_FILE_LINK = re.compile(r"/uploads/(files/[^)\s\"'<>]+)")


def _backfill_paid_file_links(conn) -> None:
    """付费文件不再由 /uploads 公开提供，把历史 markdown 直链回填成鉴权下载。"""
    if _table_exists(conn, "products"):
        rows = conn.execute(
            text("SELECT id, delivery_content FROM products WHERE file_path IS NULL")
        ).fetchall()
        for pid, content in rows:
            hit = _LEGACY_FILE_LINK.search(content or "")
            if not hit:
                continue
            rel = unquote(hit.group(1))
            conn.execute(
                text("UPDATE products SET file_path = :p, file_name = :n WHERE id = :id"),
                {"p": rel, "n": rel.rsplit("/", 1)[-1], "id": pid},
            )

    if _table_exists(conn, "deliveries"):
        rows = conn.execute(
            text("SELECT id, payload FROM deliveries WHERE file_path IS NULL")
        ).fetchall()
        for did, payload in rows:
            hit = _LEGACY_FILE_LINK.search(payload or "")
            if not hit:
                continue
            rel = unquote(hit.group(1))
            conn.execute(
                text("UPDATE deliveries SET file_path = :p, file_name = :n WHERE id = :id"),
                {"p": rel, "n": rel.rsplit("/", 1)[-1], "id": did},
            )


def migrate_schema(engine: Engine) -> None:
    """Add new columns / rebuild legacy tables for SQLite."""
    alterations = {
        "users": [
            ("email", "VARCHAR(128)"),
            ("token_version", "INTEGER DEFAULT 0"),
        ],
        "email_codes": [
            ("attempts", "INTEGER DEFAULT 0"),
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
            if not _table_exists(conn, table):
                continue
            existing = _table_columns(conn, table)
            for name, coltype in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {coltype}"))

        _migrate_products_schema(conn)
        _backfill_paid_file_links(conn)
