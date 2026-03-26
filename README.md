# DramaTracker

<img src="public/logo.png" alt="DramaTracker Logo" width="120" />

> 海外短剧榜单智能监控平台 — 实时追踪全球短剧市场动态，AI 驱动数据洞察

<p align="left">
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/Tailwind-4.0-38B2AC?style=flat-square&logo=tailwind-css" />
  <img src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

---

## 🎯 项目简介

DramaTracker 是一个面向海外短剧行业的数据监控与分析后台，自动采集 DataEye 平台的榜单数据，结合 AI 大模型提供市场洞察和竞品分析。

**核心价值：**
- 覆盖 **ShortMax、MoboShort、iDrama** 等 11 个主流海外短剧平台
- 支持 **269+ 部剧集** 的实时监控与分析
- **4 项 AI 分析能力**：市场洞察、单剧点评、爆款规律、增长模式识别
- **5 级权限控制**：适配不同角色需求

---

## ✨ 功能特性

### 📊 数据看板
- 概览数据卡片（监控平台数、AI 短剧总数、本周新上榜、热力增长 TOP1）
- 平台短剧数量对比（分组柱状图）
- 投放语种分布（饼图）
- 题材标签分布（按 AI 真人/AI 漫剧分类 Top5）
- 周环比热力增长 Top5

### 🏆 榜单监控
- 三个独立榜单：**AI 真人剧 / AI 漫剧 / 真人剧**
- 总榜（跨平台去重聚合）+ 各平台 Tab 独立排名
- 时间范围筛选（今天/近7天/近30天/自定义）
- 语种筛选
- 排名变化、热力增量、Sparkline 投放趋势图
- 剧集详情抽屉（基本信息、趋势图表、可编辑简介）

### 🤖 AI 智能分析
| 功能 | 说明 |
|------|------|
| 市场洞察报告 | 基于 Top10 榜单数据生成结构化分析（摘要/洞察/风险/建议） |
| 单剧 AI 点评 | SSE 流式输出，分析目标受众、投放表现、竞品对比 |
| 爆款规律分析 | 分类型识别爆款共同特征，输出选题方向建议 |
| 竞品增长模式识别 | 5 种增长类型分类 + 可复制性评估 + 置信度评分 |

### ✅ 人工审核队列
- 卡片式展示待审核剧集
- 三分类标记（AI 真人剧/AI 漫剧/真人剧）
- 两步确认 + 5 秒撤销机制
- 侧边栏红点实时更新待审核数量

### 📈 播放量管理
- 周维度录入 APP 内外显播放量
- 单条编辑 + 批量录入模式
- CSV 数据导出

### 🔐 用户与权限
- JWT 认证（Edge Runtime 兼容）
- **5 级角色权限**：超级管理员、运营、投放、制作、编剧
- 菜单可见性、页面访问、操作按钮、API 接口四层控制

### 🔔 通知集成
- 飞书群机器人 Webhook
- 待审核剧集自动提醒

---

## 🛠️ 技术架构

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                         │
│   Next.js 15 App Router + TypeScript + Tailwind     │
│   ECharts · Sparkline · SSE Stream · JWT Auth       │
├─────────────────────────────────────────────────────┤
│                   API Routes (27)                    │
│   /api/ranking · /api/dashboard · /api/ai/*         │
│   /api/auth/* · /api/drama/* · /api/play-count      │
├─────────────────────────────────────────────────────┤
│                Middleware (JWT Guard)                │
│   Route Protection · Role Injection · 403/401       │
├─────────────────────────────────────────────────────┤
│                    Data Layer                        │
│    SQLite (better-sqlite3) · WAL Mode · 7 Tables    │
├──────────────────────┬──────────────────────────────┤
│    Python Scraper    │        AI Integration        │
│    DataEye API × 3   │    阿里云百炼 (qwen3.5+)     │
│    11 Platforms      │   OpenAI SDK Compatible      │
│   Sign + Cookie Auth │   Structured JSON + SSE      │
└──────────────────────┴──────────────────────────────┘
```

---

## 📦 快速开始

### 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | >= 18 |
| Python | >= 3.8（仅爬虫） |
| npm / pnpm | 最新版 |

### 安装

```bash
# 克隆项目
git clone https://github.com/sofia12138/Dramatracker.git
cd Dramatracker/dramatracker

# 安装依赖
npm install
# 或
pnpm install

# 配置环境变量
cp .env.local.example .env.local
```

### 环境变量

```env
# 阿里云百炼 AI
BAILIAN_API_KEY=sk-sp-xxx
BAILIAN_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
BAILIAN_MODEL=qwen3.5-plus

# 飞书通知（可选）
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx

# JWT 密钥（可选，有默认值）
JWT_SECRET=your-secret-key
```

### 运行

```bash
# 开发模式
npm run dev

# 构建
npm run build

# 生产模式
npm start
```

访问 **http://localhost:3000**

### 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 超级管理员 |

---

## 🕷️ 数据采集

### 配置 Cookie

首次运行前，需要在 **设置页面** 配置 DataEye Cookie：

1. 登录 [DataEye](https://www.dataeye.com/)
2. 获取 Cookie（浏览器开发者工具 → Network → 任意请求 → Headers）
3. 粘贴到设置页的 Cookie 配置

### 运行爬虫

```bash
# 安装爬虫依赖
pip install -r scraper/requirements.txt

# 方式一：设置页点击"手动抓取"（推荐）

# 方式二：命令行
python scraper/dataeye_scraper.py

# 补抓历史趋势数据（7天）
python scraper/dataeye_scraper.py --backfill 7
```

---

## 📁 项目结构

```
dramatracker/
├── src/
│   ├── app/                  # 页面 + API 路由
│   │   ├── api/              # 27 个 API 端点
│   │   │   ├── ranking/      # 榜单数据
│   │   │   ├── dashboard/    # 看板数据
│   │   │   ├── ai/           # AI 分析接口
│   │   │   ├── auth/         # 认证接口
│   │   │   ├── drama/        # 剧集管理
│   │   │   └── ...
│   │   ├── ranking/          # 三个榜单页
│   │   ├── review/           # 审核队列
│   │   ├── play-count/       # 播放量管理
│   │   ├── settings/         # 设置中心
│   │   └── users/            # 用户管理
│   ├── components/           # UI 组件
│   │   ├── layout/           # 布局组件
│   │   ├── ranking/          # 榜单组件
│   │   ├── dashboard/        # 看板组件
│   │   └── ui/               # 基础组件
│   ├── contexts/             # AuthContext
│   ├── hooks/                # useAIStream 等
│   ├── lib/                  # 工具库
│   │   ├── db.ts             # 数据库操作
│   │   ├── auth.ts           # 认证逻辑
│   │   ├── jwt.ts            # JWT 工具
│   │   └── ai.ts             # AI 调用
│   └── middleware.ts         # JWT 路由守卫
├── scraper/                  # Python 爬虫
│   ├── dataeye_scraper.py    # 主爬虫脚本
│   └── requirements.txt
├── data/                     # SQLite 数据库
├── public/                   # 静态资源
└── package.json
```

---

## 🗺️ 路线图

- [ ] 定时任务：接入 node-cron 实现每日自动抓取
- [ ] 数据导出：支持 PDF 周报导出
- [ ] 多语言：国际化支持（i18n）
- [ ] 移动端适配：响应式优化
- [ ] 更多平台：持续接入新兴短剧分发平台
- [ ] 数据对比：支持跨周期、跨平台对比分析
- [ ] 告警规则：自定义条件触发飞书/邮件告警

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 📄 License

[MIT](LICENSE)

---

## 👤 作者

**Sofia** · 海外短剧从业者

- GitHub: [@sofia12138](https://github.com/sofia12138)
- Telegram: @sofia12138

---

<p align="center">
  Made with ❤️ for overseas short drama industry
</p>
