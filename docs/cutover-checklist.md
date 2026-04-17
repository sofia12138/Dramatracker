# DramaTracker 新服务器 MySQL 灰度切换 Checklist

> 每步骤完成后打 [x]。出现 ❌ 立即停止并回滚。

---

## 阶段一：基础准备（切流量前）

### 1. MySQL Schema 初始化

```bash
# 1a. 建库 + 用户
mysql -u root -p -e "
CREATE DATABASE IF NOT EXISTS dramatracker DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'dramatracker'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON dramatracker.* TO 'dramatracker'@'%';
FLUSH PRIVILEGES;
"

# 1b. 建表（执行 Schema）
mysql -u dramatracker -p dramatracker < scripts/db/schema.sql

# 1c. 验证建表
mysql -u dramatracker -p dramatracker -e "SHOW TABLES;"
```

**验收标准：** SHOW TABLES 应输出 10 张表（drama / drama_review / ranking_snapshot / invest_trend / platforms / users / drama_play_count / sync_log / ai_cache / tag_system_extra）

- [ ] Schema 执行成功，10 张表均已创建

---

### 2. 环境变量配置

在服务器 `.env.local` 中设置：

```env
USE_MYSQL=true
MYSQL_HOST=127.0.0.1       # 或内网 IP
MYSQL_PORT=3306
MYSQL_USER=dramatracker
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=dramatracker
SYNC_API_TOKEN=（openssl rand -hex 32 生成）
JWT_SECRET=your_jwt_secret
```

**验收标准：**
- [ ] `.env.local` 已创建，无敏感信息写入 Git
- [ ] `SYNC_API_TOKEN` 已生成并记录到本地安全存储

---

### 3. 数据迁移（SQLite → MySQL）

```bash
# 3a. 创建迁移配置文件
cp .env.local.example .env.migration
# 编辑 .env.migration，填写 SQLITE_PATH 和 MySQL 连接信息

# 3b. 执行迁移（只需执行一次）
node scripts/db/migrate-sqlite-to-mysql.js

# 3c. 保存迁移日志
node scripts/db/migrate-sqlite-to-mysql.js > migration_$(date +%Y%m%d_%H%M%S).log 2>&1
```

**验收标准（迁移日志中的校验表格）：**
- [ ] `drama` 条数：MySQL ≥ SQLite × 95%
- [ ] `drama_review` 条数：MySQL ≥ SQLite × 90%（允许部分无审核记录）
- [ ] `ranking_snapshot` 条数：MySQL ≈ SQLite（允许 5% 误差）

---

### 4. 数据校验（独立脚本）

```bash
# 每次迁移后运行，可重复执行
node scripts/db/validate-migration.js
```

**验收输出要求（必须全部 PASS）：**
- [ ] `drama 条数` PASS
- [ ] `drama_review 命中率` PASS
- [ ] `is_ai_drama=ai_real 命中` PASS
- [ ] `is_ai_drama=ai_manga 命中` PASS
- [ ] `ranking_snapshot 条数` PASS
- [ ] `最新快照日期一致` PASS
- [ ] `孤儿记录检查` PASS
- [ ] `样本审核字段完整性` PASS

---

## 阶段二：服务启动验证（USE_MYSQL=true）

### 5. 启动 Dev/PM2 并检查连接日志

```bash
npm run build && pm2 start ecosystem.config.js
# 或本地开发
npm run dev
```

**检查日志：**
```
[mysql] 连接池已初始化   ← 必须出现
```

- [ ] 无 `ECONNREFUSED` / `ER_ACCESS_DENIED` 错误
- [ ] 服务在 3000 端口可访问

---

### 6. Sync API 冒烟测试

```bash
# 6a. 测试 dramas 同步（新增）
curl -s -X POST http://localhost:3000/api/sync/dramas \
  -H "Authorization: Bearer $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"smoke-test","dramas":[{"playlet_id":"test-001","title":"Test Drama","language":"en"}]}'
# 期望: {"success":true,"inserted":1,"updated":0,"failed":0}

# 6b. 测试 dramas 同步（幂等，重复推送）
curl -s -X POST http://localhost:3000/api/sync/dramas \
  -H "Authorization: Bearer $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"smoke-test","dramas":[{"playlet_id":"test-001","title":"Test Drama Updated","language":"en"}]}'
# 期望: {"success":true,"inserted":0,"updated":1,"failed":0}

# 6c. 测试 rankings 同步
TODAY=$(date +%Y-%m-%d)
curl -s -X POST http://localhost:3000/api/sync/rankings \
  -H "Authorization: Bearer $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"smoke-test\",\"platform\":\"ShortMax\",\"date_key\":\"$TODAY\",\"rankings\":[{\"playlet_id\":\"test-001\",\"rank_position\":1,\"heat_value\":9999}]}"
# 期望: {"success":true,"inserted":1,"updated":0,"skipped":0,"failed":0}

# 6d. 测试重复推送（幂等性）
curl -s -X POST http://localhost:3000/api/sync/rankings \
  -H "Authorization: Bearer $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"smoke-test\",\"platform\":\"ShortMax\",\"date_key\":\"$TODAY\",\"rankings\":[{\"playlet_id\":\"test-001\",\"rank_position\":1,\"heat_value\":9999}]}"
# 期望: {"success":true,"inserted":0,"updated":1,"skipped":0,"failed":0}

# 6e. 清理测试数据
mysql -u dramatracker -p dramatracker -e "DELETE FROM drama WHERE playlet_id='test-001';"
```

- [ ] 6a dramas 新增返回 `inserted=1`
- [ ] 6b dramas 重复推送返回 `updated=1`（人工审核字段未被覆盖）
- [ ] 6c rankings 新增返回 `inserted=1`
- [ ] 6d rankings 重复推送返回 `updated=1`（幂等）
- [ ] 6e 测试数据已清理

---

### 7. 审核功能验证

```bash
# 7a. 查询待审核列表（期望返回数据）
curl -s "http://localhost:3000/api/drama/review" \
  -H "Cookie: dt_token=$YOUR_JWT" | jq '{total:.total, count:(.data|length)}'

# 7b. 执行批量审核（仅用测试 ID）
curl -s -X POST "http://localhost:3000/api/drama/review" \
  -H "Cookie: dt_token=$YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"ids":[1],"is_ai_drama":"ai_real"}'

# 7c. 验证审核字段写入 drama_review，不写 drama.is_ai_drama
mysql -u dramatracker -p dramatracker -e \
  "SELECT drama_id, is_ai_drama, review_status FROM drama_review WHERE drama_id=1;"
# 期望: is_ai_drama='ai_real', review_status='reviewed'
```

- [ ] 待审核列表正常返回
- [ ] 批量审核写入 `drama_review` 表
- [ ] `drama` 表无 `is_ai_drama` 列被修改

---

## 阶段三：页面回归测试

### 8. 核心页面验收

| 页面 | 验收标准 | 状态 |
|---|---|---|
| 首页 / 仪表盘 | 数据正常显示，AI 真人剧 / AI 漫剧计数与迁移前一致 | [ ] |
| 总榜 | 按 heat_value 排序，显示正常 | [ ] |
| 趋势榜 | 按 heat_increment 排序，数据正常 | [ ] |
| 平台榜 | 各平台数据正常 | [ ] |
| 新剧榜 | 按 new_window 筛选，已分类/待审核标识正确 | [ ] |
| 审核页 | 待审核剧目列表，分类操作正常 | [ ] |
| 爆款分析报告 | 报告基于已审核 AI 剧，不含未审核 | [ ] |
| 市场洞察报告 | 报告基于已审核 AI 剧，数据一致 | [ ] |

---

### 9. 数据一致性验证（切流前 vs 切流后对比）

```bash
# 切流前（SQLite 模式）记录基准数据：
# - AI 真人剧数量
# - AI 漫剧数量  
# - 待审核数量
# - 最新快照日期

# 切流后（MySQL 模式）对比以上数据
# 允许误差：条数 ≤ 2% 差异
```

- [ ] AI 真人剧数量一致（误差 ≤ 2%）
- [ ] AI 漫剧数量一致（误差 ≤ 2%）
- [ ] 最新快照日期一致
- [ ] 待审核数量一致（误差 ≤ 5%）

---

## 阶段四：生产流量切换

### 10. 正式切换

```bash
# 10a. 确认 .env.local 中 USE_MYSQL=true
grep USE_MYSQL .env.local

# 10b. 重启服务
pm2 restart all

# 10c. 监控日志（观察 5 分钟）
pm2 logs --lines 100
```

- [ ] `USE_MYSQL=true` 已确认
- [ ] 服务重启成功
- [ ] 无异常错误日志（5 分钟观察期）

---

## 回滚步骤

### 如何立即回滚到 SQLite 模式

```bash
# 步骤1：修改 .env.local
sed -i 's/USE_MYSQL=true/USE_MYSQL=false/' .env.local

# 步骤2：重启服务
pm2 restart all

# 步骤3：验证回滚
curl http://localhost:3000/api/ranking?mode=today | jq '.latestDate'
```

**回滚条件（任意一项触发即回滚）：**
- 核心页面接口报 500 错误
- MySQL 连接失败 / 超时
- 审核数据显示异常
- AI 分析报告数量出现大幅偏差（> 10%）

**回滚后操作：**
1. 定位根因（查看 pm2 logs）
2. 修复问题
3. 重新执行校验脚本
4. 重新切换

---

## 阶段五（可选）：人工审核保护实战验证

### 11. 运行保护验证脚本

```bash
# 前提：已有至少一条 review_status='reviewed' 的剧目，且服务在 3000 端口运行
SYNC_API_TOKEN=<your_token> node scripts/db/test-review-protection.js

# 期望输出（全部 PASS）：
# [OK ✓]  sync/dramas 返回 HTTP 200
# [OK ✓]  sync/dramas 返回 updated=1
# [OK ✓]  drama.title 已更新
# [OK ✓]  drama_review.is_ai_drama 未被修改
# [OK ✓]  drama_review.genre_tags_manual 未被修改
# [OK ✓]  drama_review.reviewed_at 未被修改
# [OK ✓]  drama_review.review_status 未被修改
# ✅ 人工审核保护验证通过
```

- [ ] 保护验证脚本全部 PASS

---

## 附1：sync API 幂等性说明

| 接口 | 重复推送策略 | 返回字段含义 |
|---|---|---|
| `/api/sync/dramas` | ON DUPLICATE KEY UPDATE（仅更新抓取字段） | inserted=新增, updated=覆盖, skipped=drama表无此ID, failed=异常 |
| `/api/sync/rankings` | ON DUPLICATE KEY UPDATE（覆盖数值字段） | inserted=新增, updated=覆盖（幂等操作）, skipped=drama表无此playlet_id, failed=异常 |
| `/api/sync/invest-trends` | ON DUPLICATE KEY UPDATE | 同上 |

**关键：`drama_review` 字段（is_ai_drama / genre_tags_manual 等）在任何同步 API 中均不被覆盖。**

---

## 附2：灰度切换第一阶段的读写分离说明

> ⚠️ 重要：本次灰度切换（第一阶段）读写路径有意分离，属于设计行为，非 bug。

| 功能 | 读来源 | 写目标 | 说明 |
|---|---|---|---|
| 审核页（待审核列表 / 批量审核） | MySQL `drama_review` | MySQL `drama_review` | 完全 MySQL |
| 仪表盘统计（AI 真人剧 / 漫剧数量） | MySQL `drama_review` + `ranking_snapshot` | — | 完全 MySQL |
| Sync API（dramas / rankings / invest-trends） | — | MySQL | 完全 MySQL |
| 榜单页（总榜 / 平台榜 / 新剧榜 / 趋势榜） | SQLite | — | 第一阶段仍读 SQLite |
| AI 分析页（爆款分析 / 市场洞察） | SQLite | — | 第一阶段仍读 SQLite（is_ai_drama 来自迁移前快照） |

**迁移后新同步的分类数据（写入 MySQL `drama_review`）不会立刻体现在榜单和分析页**，这在第一阶段是可接受的。第二阶段再将这些只读路由切至 MySQL。
