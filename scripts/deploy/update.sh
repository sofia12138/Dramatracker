#!/usr/bin/env bash
# ==============================================================
# DramaTracker 一键更新部署脚本
#
# 在服务器上执行：
#   cd /opt/dramatracker
#   bash scripts/deploy/update.sh
#
# 功能：
#   1. 校验工作目录干净（避免本地修改被覆盖）
#   2. git pull origin main（默认）
#   3. npm ci 安装依赖（仅当 package-lock.json 变化时）
#   4. npm run build
#   5. pm2 reload/restart dramatracker
#   6. 健康检查（HTTP 200）+ MySQL 连接日志检测
#   7. 失败自动回滚到上一个 commit
#
# 可选环境变量：
#   APP_DIR      默认 /opt/dramatracker
#   BRANCH       默认 main
#   PM2_NAME     默认 dramatracker
#   BASE_URL     默认 http://localhost:3000
#   SKIP_BUILD   设为 1 时跳过 build（不推荐，仅紧急情况）
# ==============================================================

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/dramatracker}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-dramatracker}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
SKIP_BUILD="${SKIP_BUILD:-0}"

C_RED=$'\033[1;31m'
C_GREEN=$'\033[1;32m'
C_YELLOW=$'\033[1;33m'
C_BLUE=$'\033[1;34m'
C_RESET=$'\033[0m'

log()  { echo -e "${C_BLUE}[INFO]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}[ OK ]${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_RESET} $*"; }
err()  { echo -e "${C_RED}[FAIL]${C_RESET} $*"; }

cd "$APP_DIR" || { err "无法进入 $APP_DIR"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DramaTracker 一键更新部署"
echo "  目录: $APP_DIR  分支: $BRANCH  PM2: $PM2_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. 工作目录检查 ─────────────────────────────────────────
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "$APP_DIR 不是 git 仓库"
  exit 1
fi

DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$DIRTY" ]; then
  warn "工作目录存在未提交修改（不影响 pull，但建议留意）："
  echo "$DIRTY"
fi

PREV_COMMIT=$(git rev-parse HEAD)
log "当前 HEAD: $PREV_COMMIT"

# ── 2. 拉取代码 ─────────────────────────────────────────────
log "拉取远端: git fetch origin $BRANCH"
if ! git fetch origin "$BRANCH"; then
  err "git fetch 失败"
  exit 1
fi

LOCAL=$(git rev-parse "$BRANCH" 2>/dev/null || echo "")
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  ok "代码已是最新（$REMOTE），无需更新"
  read -r -p "仍然要重新 build & restart 吗？[y/N] " ans
  case "${ans:-N}" in
    y|Y) log "继续执行 build/restart" ;;
    *)   ok "已取消"; exit 0 ;;
  esac
fi

log "git checkout $BRANCH && git pull --ff-only"
git checkout "$BRANCH" >/dev/null 2>&1 || true
if ! git pull --ff-only origin "$BRANCH"; then
  err "git pull 失败（可能存在合并冲突），请手动处理"
  exit 1
fi

NEW_COMMIT=$(git rev-parse HEAD)
ok "更新到 commit: $NEW_COMMIT"
git --no-pager log --oneline "$PREV_COMMIT..$NEW_COMMIT" || true

# ── 3. 依赖安装（按 package-lock.json 变化决定）──────────────
if git diff --name-only "$PREV_COMMIT" "$NEW_COMMIT" | grep -q '^package-lock.json$\|^package.json$'; then
  log "package.json/lock 有变化，执行 npm ci"
  if ! npm ci; then
    err "npm ci 失败，开始回滚..."
    git reset --hard "$PREV_COMMIT"
    exit 1
  fi
else
  ok "依赖未变化，跳过 npm ci"
fi

# ── 4. 构建 ─────────────────────────────────────────────────
if [ "$SKIP_BUILD" = "1" ]; then
  warn "SKIP_BUILD=1，跳过 npm run build"
else
  log "执行 npm run build"
  if ! npm run build; then
    err "构建失败，开始回滚..."
    git reset --hard "$PREV_COMMIT"
    warn "已回滚到 $PREV_COMMIT，请手动重新构建并重启"
    exit 1
  fi
fi

# ── 5. 重启 PM2 ─────────────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  err "未发现 pm2 命令"
  exit 1
fi

if pm2 list | grep -q "$PM2_NAME"; then
  log "pm2 reload $PM2_NAME"
  pm2 reload "$PM2_NAME" --update-env || pm2 restart "$PM2_NAME" --update-env
else
  err "PM2 中未找到进程 $PM2_NAME，请先用 server-setup.sh 完成首次部署"
  exit 1
fi

# ── 6. 健康检查 ─────────────────────────────────────────────
log "等待服务启动..."
sleep 5

HEALTH_OK=0
for i in 1 2 3 4 5 6; do
  # /login 是公开页面（无需登录），用于判断 Next.js 服务是否已就绪
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/login" || echo "000")
  if [ "$CODE" = "200" ] || [ "$CODE" = "307" ] || [ "$CODE" = "302" ]; then
    ok "健康检查通过 ($BASE_URL/login → $CODE)"
    HEALTH_OK=1
    break
  fi
  warn "第 $i 次健康检查 HTTP=$CODE，3 秒后重试..."
  sleep 3
done

if [ "$HEALTH_OK" -ne 1 ]; then
  err "健康检查失败，开始回滚..."
  git reset --hard "$PREV_COMMIT"
  if [ "$SKIP_BUILD" != "1" ]; then
    npm run build || warn "回滚后 build 也失败，请手动检查"
  fi
  pm2 reload "$PM2_NAME" --update-env || pm2 restart "$PM2_NAME" --update-env
  err "已回滚到 $PREV_COMMIT。查看日志: pm2 logs $PM2_NAME"
  exit 1
fi

# 检测 MySQL 连接（如启用）
if grep -q '^USE_MYSQL=true' "$APP_DIR/.env.local" 2>/dev/null; then
  if pm2 logs "$PM2_NAME" --lines 200 --nostream 2>/dev/null | grep -q "\[mysql\] 连接池已初始化"; then
    ok "检测到 MySQL 连接池已初始化"
  else
    warn "未检测到 MySQL 初始化日志（可能日志被截断或仍在 warming up）"
  fi
fi

# ── 7. 完成 ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "更新完成"
echo "  旧版本: $PREV_COMMIT"
echo "  新版本: $NEW_COMMIT"
echo "  服务地址: $BASE_URL"
echo ""
echo "下一步建议："
echo "  pm2 status"
echo "  pm2 logs $PM2_NAME --lines 50"
echo "  bash scripts/deploy/smoke-test.sh   # 完整冒烟测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
