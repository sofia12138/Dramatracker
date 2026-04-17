#!/usr/bin/env bash
# ==============================================================
# DramaTracker 回滚脚本（MySQL → SQLite）
#
# 在服务器上执行：
#   bash scripts/deploy/rollback.sh
# ==============================================================

APP_DIR="${APP_DIR:-/opt/dramatracker}"
ENV_FILE="$APP_DIR/.env.local"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DramaTracker 回滚：MySQL → SQLite 模式"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 切换环境变量
if grep -q "USE_MYSQL=true" "$ENV_FILE"; then
  sed -i 's/USE_MYSQL=true/USE_MYSQL=false/' "$ENV_FILE"
  echo "[OK] USE_MYSQL 已切回 false"
else
  echo "[WARN] USE_MYSQL 当前已是 false，无需修改"
fi

# 2. 重启服务
echo "[INFO] 重启 PM2 进程..."
pm2 restart dramatracker
sleep 3

# 3. 验证服务状态
if pm2 list | grep -q "dramatracker.*online"; then
  echo "[OK] 服务已重启，状态 online"
else
  echo "[WARN] 服务状态异常，请手动检查: pm2 status"
fi

echo ""
echo "回滚完成。说明："
echo "  - 应用已切回 SQLite 模式（USE_MYSQL=false）"
echo "  - MySQL 数据保留不删，可随时再切换"
echo "  - 查看日志: pm2 logs dramatracker"
echo ""
echo "如需再次切换到 MySQL："
echo "  sed -i 's/USE_MYSQL=false/USE_MYSQL=true/' $ENV_FILE"
echo "  pm2 restart dramatracker"
