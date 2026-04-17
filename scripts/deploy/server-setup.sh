#!/usr/bin/env bash
# ==============================================================
# DramaTracker 新服务器一键部署脚本
# 适用系统：Ubuntu 20.04 / 22.04 / Debian 11+
#
# 执行方式（在服务器上运行）：
#   chmod +x scripts/deploy/server-setup.sh
#   bash scripts/deploy/server-setup.sh
#
# 注意：请先按照脚本顶部说明填写变量，再执行
# ==============================================================

set -e  # 任意步骤失败立即停止

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ★ 在此处填写你的配置（唯一需要修改的地方）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DB_NAME="dramatracker"
DB_USER="dramatracker"
DB_PASS="$(openssl rand -hex 16)"       # 自动生成随机密码，或手动替换
SYNC_TOKEN="$(openssl rand -hex 32)"    # 自动生成 sync API token
JWT_SECRET="$(openssl rand -hex 32)"    # 自动生成 JWT secret
APP_DIR="/opt/dramatracker"             # 应用部署目录
GIT_REPO="https://github.com/sofia12138/Dramatracker.git"
GIT_BRANCH="main"
APP_PORT=3000
NODE_VERSION="20"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log() { echo -e "\n\033[1;32m[$(date '+%H:%M:%S')] $*\033[0m"; }
err() { echo -e "\n\033[1;31m[ERROR] $*\033[0m" >&2; exit 1; }
warn() { echo -e "\033[1;33m[WARN] $*\033[0m"; }

log "=== DramaTracker 服务器部署开始 ==="
log "应用目录: $APP_DIR"
log "数据库: $DB_NAME @ localhost:3306"

# ── 1. 更新系统包 ───────────────────────────────────────────
log "[1/8] 更新系统包..."
apt-get update -y

# ── 2. 安装 MySQL 8 ─────────────────────────────────────────
log "[2/8] 安装 MySQL 8..."
apt-get install -y mysql-server mysql-client

# 启动并设置开机自启
systemctl enable mysql
systemctl start mysql

# 等待 MySQL 就绪
for i in $(seq 1 10); do
  mysqladmin ping --silent && break
  warn "MySQL 未就绪，等待 $((i*2))s..."
  sleep 2
done
mysqladmin ping --silent || err "MySQL 启动失败，请检查 systemctl status mysql"

log "MySQL 已启动 ✓"

# ── 3. 初始化数据库和用户 ───────────────────────────────────
log "[3/8] 初始化数据库 '$DB_NAME' 和用户 '$DB_USER'..."
mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
log "数据库和用户创建完成 ✓"

# ── 4. 安装 Node.js (通过 NodeSource) ────────────────────────
log "[4/8] 安装 Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
log "Node.js $(node -v) 已安装 ✓"

# 安装 PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi
log "PM2 $(pm2 -v) 已安装 ✓"

# ── 5. 拉取代码 ─────────────────────────────────────────────
log "[5/8] 拉取代码到 $APP_DIR..."
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull origin "$GIT_BRANCH"
  log "代码已更新 ✓"
else
  git clone --branch "$GIT_BRANCH" "$GIT_REPO" "$APP_DIR"
  cd "$APP_DIR"
  log "代码已克隆 ✓"
fi

# ── 6. 生成 .env.local ──────────────────────────────────────
log "[6/8] 生成 .env.local..."
cat > "$APP_DIR/.env.local" <<ENVEOF
# ── 数据库模式 ────────────────────────────────────────────────
USE_MYSQL=true

# ── MySQL 连接 ────────────────────────────────────────────────
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=${DB_USER}
MYSQL_PASSWORD=${DB_PASS}
MYSQL_DATABASE=${DB_NAME}

# ── 同步 API Token ────────────────────────────────────────────
SYNC_API_TOKEN=${SYNC_TOKEN}

# ── JWT ──────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}

# ── AI API（可选，填写后 AI 分析功能启用）─────────────────────
# OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o-mini
ENVEOF
log ".env.local 已生成 ✓"

# ── 7. 初始化 MySQL Schema ──────────────────────────────────
log "[7/8] 执行 MySQL Schema..."
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$APP_DIR/scripts/db/schema.sql"
log "Schema 执行完成 ✓"

# 验证表数量
TABLE_COUNT=$(mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null)
log "已创建 $TABLE_COUNT 张表（期望 10 张）"
[ "$TABLE_COUNT" -ge 10 ] || err "建表数量不足，请检查 schema.sql"

# ── 8. 安装依赖 + 构建 + 启动 ─────────────────────────────
log "[8/8] 安装 npm 依赖并构建..."
cd "$APP_DIR"
npm ci --prefer-offline || npm install
npm run build

# 生成 PM2 配置（如果不存在）
if [ ! -f "$APP_DIR/ecosystem.config.js" ]; then
  cat > "$APP_DIR/ecosystem.config.js" <<PM2EOF
module.exports = {
  apps: [{
    name: 'dramatracker',
    script: 'node_modules/.bin/next',
    args: 'start',
    cwd: '${APP_DIR}',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: ${APP_PORT},
    },
    max_memory_restart: '512M',
    error_file: '/var/log/pm2/dramatracker-error.log',
    out_file: '/var/log/pm2/dramatracker-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
PM2EOF
  mkdir -p /var/log/pm2
fi

# 启动或重启
if pm2 list | grep -q dramatracker; then
  pm2 restart dramatracker
else
  pm2 start ecosystem.config.js
fi
pm2 save

log "=== 部署完成！==="
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  应用地址:      http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "  MySQL DB:      ${DB_NAME}"
echo "  MySQL 用户:    ${DB_USER}"
echo "  MySQL 密码:    ${DB_PASS}    ← 请保存到安全位置！"
echo "  SYNC Token:    ${SYNC_TOKEN} ← 本地抓取脚本使用"
echo "  JWT Secret:    ${JWT_SECRET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "下一步（可选）："
echo "  1. 数据迁移（本机 SQLite → MySQL）："
echo "     node scripts/db/migrate-sqlite-to-mysql.js"
echo ""
echo "  2. 查看应用日志："
echo "     pm2 logs dramatracker"
echo ""
echo "  3. 检查 MySQL 连接日志（应看到 [mysql] 连接池已初始化）："
echo "     pm2 logs dramatracker | grep mysql"
