#!/bin/bash
set -euo pipefail
cd /opt/lingxia/backend
rm -rf app
tar -xf /tmp/lingxia-app.tar
cd /opt/lingxia/frontend
rm -rf dist
tar -xf /tmp/lingxia-dist.tar
systemctl restart lingxia
sleep 3
/opt/lingxia/backend/.venv/bin/python - <<'PY'
from sqlalchemy import create_engine, text
e = create_engine("sqlite:////opt/lingxia/backend/lingxia.db")
with e.connect() as c:
    tables = [r[0] for r in c.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('product_files','delivery_files')")).fetchall()]
    print("tables", ",".join(sorted(tables)))
    pf = c.execute(text("SELECT COUNT(*) FROM product_files")).scalar()
    df = c.execute(text("SELECT COUNT(*) FROM delivery_files")).scalar()
    print("product_files", pf)
    print("delivery_files", df)
PY
curl -sS https://xingx.shop/api/health
echo
