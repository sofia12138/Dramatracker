# DramaTracker MySQL 模式联调文档

> 默认模式（`USE_MYSQL=false`）使用本地 SQLite，不影响当前开发。  
> 切换到 MySQL 只需配置下列环境变量，无需改业务代码。

---

## 一、前置要求

| 项目 | 说明 |
|---|---|
| MySQL ≥ 8.0 | 字符集 `utf8mb4`，时区 `+00:00` |
| Node.js ≥ 18 | 与 Next.js 14 兼容 |
| `mysql2` 已安装 | `npm install mysql2`（已完成） |

---

## 二、环境变量配置

复制 `.env.local.example` 为 `.env.local` 并填写：

```env
USE_MYSQL=true

MYSQL_HOST=127.0.0.1       # 或服务器 IP
MYSQL_PORT=3306
MYSQL_USER=dramatracker
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=dramatracker

SYNC_API_TOKEN=生成一个随机 token（openssl rand -hex 32）
JWT_SECRET=your_jwt_secret
```

---

## 三、数据库初始化

```bash
# 建库
mysql -u root -p -e "CREATE DATABASE dramatracker DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'dramatracker'@'%' IDENTIFIED BY 'your_password';"
mysql -u root -p -e "GRANT ALL ON dramatracker.* TO 'dramatracker'@'%';"

# 建表（执行 Schema）
mysql -u dramatracker -p dramatracker < scripts/db/schema.sql
```

---

## 四、一次性数据迁移（SQLite → MySQL）

```bash
# 在 .env.migration 中配置 MySQL 连接 + SQLITE_PATH
cp .env.local.example .env.migration
# 编辑 .env.migration ...

# 执行迁移
node scripts/db/migrate-sqlite-to-mysql.js
```

脚本结束后会打印校验表格，确认各表行数与 SQLite 原始数据一致。

---

## 五、验收步骤

### 5.1 连接验证

```bash
# 启动 dev server（USE_MYSQL=true）
npm run dev

# 检查日志是否出现：
# [mysql] 连接池已初始化
```

### 5.2 审核页验证（V1 / V2）

**目标：`drama_review` 是审核字段的唯一写入点，`drama` 主表不含 `is_ai_drama`。**

```bash
# 查询一条待审核剧目（期望返回数据）
curl "http://localhost:3000/api/drama/review" \
  -H "Cookie: dt_token=<your_jwt>"

# 批量审核（分类到 ai_real）
curl -X POST "http://localhost:3000/api/drama/review" \
  -H "Cookie: dt_token=<your_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"ids":[1,2],"is_ai_drama":"ai_real"}'

# 验证：MySQL drama 表无 is_ai_drama 列变化
mysql -u dramatracker -p dramatracker -e "SELECT id,playlet_id FROM drama LIMIT 3;"
# drama_review 表应有 is_ai_drama='ai_real' 记录
mysql -u dramatracker -p dramatracker -e "SELECT drama_id,is_ai_drama,review_status FROM drama_review LIMIT 5;"
```

**预期结果：**
- `drama` 表：无 `is_ai_drama` 列（MySQL 模式）
- `drama_review` 表：`is_ai_drama='ai_real'`，`review_status='reviewed'`

---

### 5.3 榜单页验证（V3）

**目标：榜单 SQL 通过 `drama_review` JOIN 读取 `is_ai_drama`，不直接访问 `drama.is_ai_drama`。**

```bash
# 总榜（无过滤）
curl "http://localhost:3000/api/ranking?mode=today" \
  -H "Cookie: dt_token=<your_jwt>"

# 按 AI 剧类型过滤（此时应命中 drama_review.is_ai_drama）
curl "http://localhost:3000/api/ranking?mode=today&is_ai_drama=ai_real" \
  -H "Cookie: dt_token=<your_jwt>"

# 新剧榜
curl "http://localhost:3000/api/ranking?ranking_mode=new&new_window=7d" \
  -H "Cookie: dt_token=<your_jwt>"
```

**预期结果：**
- 接口正常返回（不报 `Unknown column 'd.is_ai_drama'`）
- 按 `is_ai_drama` 过滤时只显示已审核的对应类型剧目

---

### 5.4 同步 API 验证（V3 — sync/dramas 人工数据保护）

**目标：同步不覆盖 `drama_review` 中的人工审核字段。**

```bash
# 1. 先审核某剧（设为 ai_real）
curl -X POST "http://localhost:3000/api/drama/review" \
  -H "Cookie: dt_token=<your_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"ids":[1],"is_ai_drama":"ai_real"}'

# 2. 查询审核结果
mysql -u dramatracker -p dramatracker \
  -e "SELECT drama_id,is_ai_drama FROM drama_review WHERE drama_id=1;"

# 3. 通过同步 API 重新推送该剧数据（模拟抓取器更新）
curl -X POST "http://localhost:3000/api/sync/dramas" \
  -H "Authorization: Bearer <SYNC_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "test",
    "dramas": [{
      "playlet_id": "<该剧的 playlet_id>",
      "title": "新标题（来自抓取）",
      "language": "en"
    }]
  }'

# 4. 验证审核字段未被覆盖
mysql -u dramatracker -p dramatracker \
  -e "SELECT drama_id,is_ai_drama FROM drama_review WHERE drama_id=1;"
```

**预期结果：**
- `drama.title` 被更新为"新标题（来自抓取）"
- `drama_review.is_ai_drama` 仍为 `'ai_real'`（未被覆盖 ✅）

---

## 六、字段归属速查表

| 字段 | SQLite 表 | MySQL 表 | 写入方 |
|---|---|---|---|
| `title` | `drama` | `drama` | 抓取器 / sync API |
| `language` | `drama` | `drama` | 抓取器 / sync API |
| `cover_url` | `drama` | `drama` | 抓取器 / sync API |
| `first_air_date` | `drama` | `drama` | 抓取器 / sync API |
| `tags` | `drama` | `drama` | 抓取器 / sync API |
| `is_ai_drama` | `drama` | **`drama_review`** | 人工审核 |
| `genre_tags_manual` | `drama` | **`drama_review`** | 人工审核 |
| `genre_tags_ai` | `drama` | **`drama_review`** | AI 分析 |
| `review_status` | _(无)_ | **`drama_review`** | 人工审核 |

---

## 七、常见问题

| 错误 | 原因 | 处理 |
|---|---|---|
| `Unknown column 'd.is_ai_drama'` | 旧代码未适配 MySQL | 确认 ranking/review API 已更新 |
| `ECONNREFUSED` | MySQL 未启动或 HOST 错误 | 检查 MYSQL_HOST / MYSQL_PORT |
| `ER_ACCESS_DENIED_ERROR` | 用户名/密码错误 | 检查 MYSQL_USER / MYSQL_PASSWORD |
| sync 返回 401 | SYNC_API_TOKEN 不匹配 | 检查环境变量与请求 Header |
| 迁移后审核数据丢失 | `drama.is_ai_drama` 为空 | 核查 SQLite 数据，重新迁移 `drama_review` |

---

## 八、回滚方案

如需回退到 SQLite，在 `.env.local` 中：

```env
USE_MYSQL=false
```

重启服务即可，无需任何代码修改。
