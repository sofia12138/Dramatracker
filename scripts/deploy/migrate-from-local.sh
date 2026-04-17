#!/usr/bin/env bash
# ==============================================================
# DramaTracker 数据迁移脚本（本机 → 服务器 MySQL）
#
# 在本地 Windows 机器上操作：
#   1. 将 SQLite db 文件上传到服务器
#   2. 在服务器上运行迁移脚本
#
# 执行方式：在服务器 /opt/dramatracker 目录下运行
#   bash scripts/deploy/migrate-from-local.sh /path/to/dramatracker.db
# ==============================================================

set -e

SQLITE_PATH="${1:-}"
APP_DIR="${APP_DIR:-/opt/dramatracker}"

if [ -z "$SQLITE_PATH" ]; then
  echo "用法: bash scripts/deploy/migrate-from-local.sh <sqlite_db_path>"
  echo "示例: bash scripts/deploy/migrate-from-local.sh /tmp/dramatracker.db"
  exit 1
fi

[ -f "$SQLITE_PATH" ] || { echo "[ERROR] SQLite 文件不存在: $SQLITE_PATH"; exit 1; }
[ -f "$APP_DIR/.env.local" ] || { echo "[ERROR] .env.local 不存在，请先运行 server-setup.sh"; exit 1; }

# 加载环境变量
export $(grep -v '^#' "$APP_DIR/.env.local" | xargs)

log() { echo -e "\n\033[1;32m[$(date '+%H:%M:%S')] $*\033[0m"; }

log "开始迁移 SQLite → MySQL..."
log "源文件: $SQLITE_PATH"
log "目标: ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"

cd "$APP_DIR"

# 设置迁移环境变量
SQLITE_PATH="$SQLITE_PATH" \
MYSQL_HOST="$MYSQL_HOST" \
MYSQL_PORT="$MYSQL_PORT" \
MYSQL_USER="$MYSQL_USER" \
MYSQL_PASSWORD="$MYSQL_PASSWORD" \
MYSQL_DATABASE="$MYSQL_DATABASE" \
  node scripts/db/migrate-sqlite-to-mysql.js 2>&1 | tee /tmp/migration_$(date +%Y%m%d_%H%M%S).log

log "迁移完成！"
log "运行校验脚本..."

SQLITE_PATH="$SQLITE_PATH" \
MYSQL_HOST="$MYSQL_HOST" \
MYSQL_PORT="$MYSQL_PORT" \
MYSQL_USER="$MYSQL_USER" \
MYSQL_PASSWORD="$MYSQL_PASSWORD" \
MYSQL_DATABASE="$MYSQL_DATABASE" \
  node scripts/db/validate-migration.js

log "=== 数据迁移全部完成 ==="
