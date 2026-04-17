# DramaTracker 新服务器部署 SOP

> 适用场景：全新服务器 + Ubuntu/Debian + MySQL（尚未安装）+ 应用从未部署过

---

## 准备工作（在你本地完成）

### 1. 获取服务器 IP 和 SSH 登录方式

你需要知道：
- 服务器公网 IP（例如 `1.2.3.4`）
- SSH 端口（默认 22）
- SSH 用户名（通常是 `root` 或 `ubuntu`）
- SSH 密码 或 私钥文件路径

### 2. 将最新代码推送到 GitHub

```bash
# 在本地项目目录执行（已完成，可跳过）
git push origin main
```

---

## 在服务器上执行（全部命令复制粘贴即可）

### 第一步：SSH 登录服务器

```bash
ssh root@你的服务器IP
# 示例: ssh root@1.2.3.4
```

### 第二步：克隆代码

```bash
git clone https://github.com/sofia12138/Dramatracker.git /opt/dramatracker
cd /opt/dramatracker
```

### 第三步：运行一键部署脚本

> 这个脚本会自动：安装 MySQL → 建库建表 → 安装 Node.js → 安装 PM2 → 构建应用 → 启动服务

```bash
chmod +x scripts/deploy/server-setup.sh
bash scripts/deploy/server-setup.sh
```

**脚本运行完成后，终端会输出类似以下内容（请保存！）：**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  应用地址:      http://1.2.3.4:3000
  MySQL DB:      dramatracker
  MySQL 用户:    dramatracker
  MySQL 密码:    xxxxxxxxxxxxxxxx    ← 保存到安全位置！
  SYNC Token:    xxxxxxxxxxxxxxxxxxxxxxxx ← 本地抓取脚本使用
  JWT Secret:    xxxxxxxxxxxxxxxxxxxxxxxx
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 第四步：运行冒烟验证

```bash
cd /opt/dramatracker
bash scripts/deploy/smoke-test.sh
```

期望结果：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  冒烟验证结果：PASS=7  FAIL=0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 所有冒烟测试通过，灰度切换成功！
```

---

## 数据迁移（把本地 SQLite 数据导入 MySQL）

### 方法：SCP 上传 + 在服务器运行迁移脚本

**在本地执行（上传 SQLite 文件到服务器）：**
```bash
# Windows PowerShell / Git Bash：
scp "d:\Dramatracker - 副本\dramatracker\data\dramatracker.db" root@你的服务器IP:/tmp/dramatracker.db
```

**在服务器上执行：**
```bash
cd /opt/dramatracker
bash scripts/deploy/migrate-from-local.sh /tmp/dramatracker.db
```

迁移完成后会自动运行校验脚本，输出校验报告。

---

## 日常运维命令

```bash
# 查看应用状态
pm2 status

# 查看实时日志（含 MySQL 连接状态）
pm2 logs dramatracker

# 重启应用
pm2 restart dramatracker

# 更新代码后重新部署
cd /opt/dramatracker
git pull origin main
npm run build
pm2 restart dramatracker

# 查看 MySQL 连接池初始化日志
pm2 logs dramatracker | grep mysql
```

---

## 回滚到 SQLite 模式

如果发现 MySQL 有问题，立即执行：

```bash
cd /opt/dramatracker
bash scripts/deploy/rollback.sh
```

或手动执行：
```bash
sed -i 's/USE_MYSQL=true/USE_MYSQL=false/' /opt/dramatracker/.env.local
pm2 restart dramatracker
```

> MySQL 数据不会被删除，随时可以重新切回。

---

## 检查清单（切换成功标准）

| 检查项 | 命令 | 期望结果 |
|---|---|---|
| MySQL 连接 | `pm2 logs dramatracker \| grep mysql` | 看到 `[mysql] 连接池已初始化` |
| dramas 同步 | 冒烟脚本 | `inserted=1` |
| rankings 幂等 | 冒烟脚本 | 二次提交 `updated=1` |
| dashboard 正常 | 冒烟脚本 | HTTP 200 |
| 无 Token 拦截 | 冒烟脚本 | HTTP 401 |

---

## 给本地抓取脚本配置 SYNC_API_TOKEN

安装完成后，本地抓取脚本需要配置以下环境变量（使用 server-setup.sh 输出的值）：

```bash
# 本地 .env.migration 或抓取脚本的环境变量：
DT_SERVER_URL=http://你的服务器IP:3000
DT_SYNC_TOKEN=（server-setup.sh 输出的 SYNC Token）
```

---

## 常见问题

**Q: server-setup.sh 报 `Permission denied`？**
```bash
chmod +x scripts/deploy/server-setup.sh
```

**Q: `npm run build` 失败？**
```bash
# 检查 Node.js 版本是否 >= 18
node -v
# 清理缓存重试
npm run clean && npm run build
```

**Q: PM2 启动后无法访问 3000 端口？**
```bash
# 检查防火墙
ufw status
ufw allow 3000
# 或阿里云/腾讯云安全组开放 3000 端口
```

**Q: MySQL 连接失败（ECONNREFUSED）？**
```bash
# 检查 MySQL 状态
systemctl status mysql
# 检查端口
ss -tlnp | grep 3306
```
