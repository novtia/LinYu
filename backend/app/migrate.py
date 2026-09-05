from __future__ import annotations

import re
from pathlib import Path
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


def _column_notnull(conn, table: str) -> dict[str, bool]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1]: bool(row[3]) for row in rows}


def _sql_col(existing: dict[str, str], name: str, expr: str | None = None) -> str:
    if name in existing:
        return expr or f"o.{name}"
    return "NULL"


def _migrate_orders_guest_email(conn) -> None:
    """Allow guest orders: nullable user_id + required buyer email."""
    if not _table_exists(conn, "orders"):
        return
    existing = _table_columns(conn, "orders")
    notnull = _column_notnull(conn, "orders")
    has_email = "email" in existing
    user_id_required = notnull.get("user_id", True)
    if has_email and not user_id_required:
        return

    email_expr = (
        "lower(trim(COALESCE(NULLIF(o.email, ''), u.email, '')))"
        if has_email
        else "lower(trim(COALESCE(u.email, '')))"
    )
    conn.execute(text("DROP TABLE IF EXISTS orders_new"))
    conn.execute(
        text(
            """
            CREATE TABLE orders_new (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                user_id VARCHAR(64),
                username VARCHAR(64) NOT NULL,
                email VARCHAR(128) NOT NULL,
                total FLOAT NOT NULL,
                status VARCHAR(16),
                payment_channel_id VARCHAR(64),
                payment_method VARCHAR(32),
                payment_provider VARCHAR(32),
                trade_no VARCHAR(128),
                paid_at DATETIME,
                created_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users (id)
            )
            """
        )
    )
    conn.execute(
        text(
            f"""
            INSERT INTO orders_new (
                id, user_id, username, email, total, status,
                payment_channel_id, payment_method, payment_provider,
                trade_no, paid_at, created_at
            )
            SELECT
                o.id,
                o.user_id,
                o.username,
                {email_expr},
                o.total,
                o.status,
                {_sql_col(existing, "payment_channel_id")},
                {_sql_col(existing, "payment_method")},
                {_sql_col(existing, "payment_provider")},
                {_sql_col(existing, "trade_no")},
                {_sql_col(existing, "paid_at")},
                o.created_at
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            """
        )
    )
    conn.execute(text("DROP TABLE orders"))
    conn.execute(text("ALTER TABLE orders_new RENAME TO orders"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_email ON orders (email)"))


def _migrate_multi_files(conn) -> None:
    """Create product_files / delivery_files and backfill legacy single-file columns.

    `create_all` may already have created empty tables before this runs, so backfill
    is based on missing rows rather than table existence.
    """
    if _table_exists(conn, "products"):
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS product_files (
                    id VARCHAR(64) NOT NULL PRIMARY KEY,
                    product_id INTEGER NOT NULL,
                    file_path VARCHAR(512) NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME,
                    FOREIGN KEY(product_id) REFERENCES products (id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_files_product_id ON product_files (product_id)"))
        rows = conn.execute(
            text(
                """
                SELECT p.id, p.file_path, p.file_name
                FROM products p
                WHERE p.file_path IS NOT NULL AND TRIM(p.file_path) != ''
                  AND NOT EXISTS (SELECT 1 FROM product_files pf WHERE pf.product_id = p.id)
                """
            )
        ).fetchall()
        for i, (pid, path, name) in enumerate(rows):
            conn.execute(
                text(
                    "INSERT INTO product_files (id, product_id, file_path, file_name, sort_order, created_at) "
                    "VALUES (:id, :pid, :path, :name, 0, CURRENT_TIMESTAMP)"
                ),
                {"id": f"pf_m{i:06d}", "pid": pid, "path": path, "name": name or Path(path).name},
            )

    if _table_exists(conn, "deliveries"):
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS delivery_files (
                    id VARCHAR(64) NOT NULL PRIMARY KEY,
                    delivery_id VARCHAR(64) NOT NULL,
                    file_path VARCHAR(512) NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    FOREIGN KEY(delivery_id) REFERENCES deliveries (id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_delivery_files_delivery_id ON delivery_files (delivery_id)"))
        rows = conn.execute(
            text(
                """
                SELECT d.id, d.file_path, d.file_name
                FROM deliveries d
                WHERE d.file_path IS NOT NULL AND TRIM(d.file_path) != ''
                  AND NOT EXISTS (SELECT 1 FROM delivery_files df WHERE df.delivery_id = d.id)
                """
            )
        ).fetchall()
        for i, (did, path, name) in enumerate(rows):
            conn.execute(
                text(
                    "INSERT INTO delivery_files (id, delivery_id, file_path, file_name, sort_order) "
                    "VALUES (:id, :did, :path, :name, 0)"
                ),
                {"id": f"df_m{i:06d}", "did": did, "path": path, "name": name or Path(path).name},
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
        _migrate_orders_guest_email(conn)
        _backfill_paid_file_links(conn)
        _migrate_multi_files(conn)
