#!/usr/bin/env bash
# 领匣数据备份：SQLite 数据库 + 上传文件 + .env
# 部署到服务器 /opt/lingxia/backup.sh，用 cron 每日执行：
#   0 4 * * * /opt/lingxia/backup.sh >> /var/log/lingxia-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lingxia/backend}"
BACKUP_DIR="${BACKUP_DIR:-/opt/lingxia/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

stamp="$(date +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$BACKUP_DIR"

# 用 sqlite 的 backup 接口取一致性快照，避免直接拷贝正在写入的文件
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$APP_DIR/lingxia.db" ".backup '$work/lingxia.db'"
elif [ -x "$APP_DIR/.venv/bin/python" ]; then
  "$APP_DIR/.venv/bin/python" - "$APP_DIR/lingxia.db" "$work/lingxia.db" <<'PY'
import sqlite3
import sys

src, dst = sys.argv[1], sys.argv[2]
source = sqlite3.connect(src)
target = sqlite3.connect(dst)
with target:
    source.backup(target)
source.close()
target.close()
PY
else
  cp "$APP_DIR/lingxia.db" "$work/lingxia.db"
fi

[ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" "$work/env.bak"

tar -czf "$BACKUP_DIR/lingxia-$stamp.tar.gz" \
  -C "$work" . \
  -C "$APP_DIR" uploads

chmod 600 "$BACKUP_DIR/lingxia-$stamp.tar.gz"

# 清理过期备份
find "$BACKUP_DIR" -name 'lingxia-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "[$(date -Is)] backup ok: $BACKUP_DIR/lingxia-$stamp.tar.gz"
