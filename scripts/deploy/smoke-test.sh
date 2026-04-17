#!/usr/bin/env bash
# ==============================================================
# DramaTracker 切换后冒烟验证脚本
#
# 在服务器上执行：
#   bash scripts/deploy/smoke-test.sh
# ==============================================================

set -e

APP_DIR="${APP_DIR:-/opt/dramatracker}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

# 加载 env
[ -f "$APP_DIR/.env.local" ] && export $(grep -v '^#' "$APP_DIR/.env.local" | xargs)

TOKEN="$SYNC_API_TOKEN"
TODAY=$(date +%Y-%m-%d)

pass=0
fail=0

log()  { echo -e "\033[1;32m[PASS]\033[0m $*"; ((pass++)) || true; }
fail() { echo -e "\033[1;31m[FAIL]\033[0m $*"; ((fail++)) || true; }
info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DramaTracker 冒烟验证 @ $BASE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── A. 检查 MySQL 连接日志 ──────────────────────────────────
info "检查 MySQL 连接池日志..."
if pm2 logs dramatracker --lines 100 --nostream 2>/dev/null | grep -q "\[mysql\] 连接池已初始化"; then
  log "MySQL 连接池已初始化"
else
  fail "未发现 [mysql] 连接池已初始化 日志（待验证：服务是否已重启？）"
fi

# ── B. /api/sync/dramas 新增 ────────────────────────────────
info "测试 /api/sync/dramas（新增）..."
R1=$(curl -s -o /tmp/dt_smoke1.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/sync/dramas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"smoke-test","dramas":[{"playlet_id":"smoke-test-001","title":"Smoke Test Drama","language":"en"}]}')

BODY1=$(cat /tmp/dt_smoke1.json)
info "响应: HTTP $R1 | $BODY1"

[ "$R1" = "200" ] && log "/api/sync/dramas HTTP 200" || fail "/api/sync/dramas HTTP $R1"
echo "$BODY1" | grep -q '"inserted":1' && log "dramas inserted=1" || fail "dramas inserted 不为 1: $BODY1"

# ── C. /api/sync/dramas 幂等复提 ────────────────────────────
info "测试 /api/sync/dramas（幂等复提）..."
R2=$(curl -s -o /tmp/dt_smoke2.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/sync/dramas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"smoke-test","dramas":[{"playlet_id":"smoke-test-001","title":"Smoke Updated","language":"en"}]}')

BODY2=$(cat /tmp/dt_smoke2.json)
info "响应: HTTP $R2 | $BODY2"
echo "$BODY2" | grep -q '"updated":1' && log "dramas updated=1（幂等）" || fail "dramas 重复推送未 updated=1: $BODY2"

# ── D. /api/sync/rankings 新增 ──────────────────────────────
info "测试 /api/sync/rankings（新增）..."
R3=$(curl -s -o /tmp/dt_smoke3.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/sync/rankings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"smoke-test\",\"platform\":\"ShortMax\",\"date_key\":\"$TODAY\",\"rankings\":[{\"playlet_id\":\"smoke-test-001\",\"rank_position\":1,\"heat_value\":9999}]}")

BODY3=$(cat /tmp/dt_smoke3.json)
info "响应: HTTP $R3 | $BODY3"
[ "$R3" = "200" ] && log "/api/sync/rankings HTTP 200" || fail "/api/sync/rankings HTTP $R3"
echo "$BODY3" | grep -q '"inserted":1' && log "rankings inserted=1" || fail "rankings inserted 不为 1: $BODY3"

# ── E. /api/sync/rankings 幂等复提 ──────────────────────────
info "测试 /api/sync/rankings（幂等复提）..."
R4=$(curl -s -o /tmp/dt_smoke4.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/sync/rankings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"smoke-test\",\"platform\":\"ShortMax\",\"date_key\":\"$TODAY\",\"rankings\":[{\"playlet_id\":\"smoke-test-001\",\"rank_position\":1,\"heat_value\":9999}]}")

BODY4=$(cat /tmp/dt_smoke4.json)
info "响应: HTTP $R4 | $BODY4"
echo "$BODY4" | grep -q '"updated":1' && log "rankings updated=1（幂等）" || fail "rankings 重复推送未 updated=1: $BODY4"

# ── F. dashboard/stats ─────────────────────────────────────
info "测试 /api/dashboard/stats..."
R5=$(curl -s -o /tmp/dt_smoke5.json -w "%{http_code}" "$BASE_URL/api/dashboard/stats")
[ "$R5" = "200" ] && log "/api/dashboard/stats HTTP 200" || fail "/api/dashboard/stats HTTP $R5 | $(cat /tmp/dt_smoke5.json)"

# ── G. 鉴权拦截测试 ─────────────────────────────────────────
info "测试无 Token 时拒绝访问..."
R6=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/sync/dramas" \
  -H "Content-Type: application/json" \
  -d '{"dramas":[]}')
[ "$R6" = "401" ] && log "无 Token 正确返回 401" || fail "无 Token 应返回 401，实际 $R6"

# ── H. 清理测试数据 ─────────────────────────────────────────
info "清理测试数据（smoke-test-001）..."
if command -v mysql &>/dev/null; then
  mysql -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
    -e "DELETE FROM drama WHERE playlet_id='smoke-test-001';" 2>/dev/null \
    && log "测试数据已清理" || fail "测试数据清理失败（请手动删除 playlet_id=smoke-test-001）"
else
  fail "mysql CLI 不可用，请手动执行: DELETE FROM drama WHERE playlet_id='smoke-test-001';"
fi

# ── 汇总 ───────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  冒烟验证结果：PASS=$pass  FAIL=$fail"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$fail" -eq 0 ]; then
  echo "✅ 所有冒烟测试通过，灰度切换成功！"
  exit 0
else
  echo "❌ 存在 $fail 个失败项，请检查日志后决定是否回滚"
  exit 1
fi
