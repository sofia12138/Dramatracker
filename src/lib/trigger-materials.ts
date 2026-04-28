/**
 * [material-trigger] 后台触发素材抓取（fire-and-forget）
 *
 * 调用场景：待审核剧集数由 N→0 时，自动补素材；无需等待。
 * 容错原则：Python 不可用 / cookie 缺失 / 环境不支持 → 只打 console.warn，
 *           绝不影响调用方（审核 API）的正常响应。
 *
 * 进程配置：
 *   detached: true  - 独立于 Next.js 进程，不会被 Node.js GC 回收
 *   stdio: 'ignore' - 不捕获输出，不阻塞事件循环
 *   child.unref()   - Node.js 不等待子进程退出
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const LOCK_FILE = path.join(process.cwd(), 'data', 'materials-running.lock');
const LOG_FILE  = path.join(process.cwd(), 'data', 'material-trigger.log');

function appendLog(msg: string) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch { /* 日志写失败不影响主流程 */ }
}

/**
 * 检查是否已有素材抓取进程在跑（读 lock 文件里的 pid）。
 * lock 文件存在且 pid 仍在运行 → 返回 true（跳过本次触发）。
 */
function isAlreadyRunning(): boolean {
  try {
    if (!fs.existsSync(LOCK_FILE)) return false;
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
    if (!pid || isNaN(pid)) return false;
    process.kill(pid, 0); // 不发信号，只检查进程是否存在
    return true;          // pid 存在 → 正在运行
  } catch {
    // ESRCH: pid 不存在，或 lock 文件读取失败 → 认为没在跑
    return false;
  }
}

/**
 * 在后台 fire-and-forget 启动 `python scraper/dataeye_scraper.py --materials-only`。
 *
 * @param reason 触发原因（仅用于日志）
 * @returns true=spawn 已发起；false=跳过（已在运行 / spawn 失败）
 */
export function triggerMaterialsAsync(reason: string): boolean {
  if (isAlreadyRunning()) {
    console.log(`[material-trigger] 已有素材抓取进程在运行，跳过本次触发 (reason=${reason})`);
    appendLog(`SKIP (already running) reason=${reason}`);
    return false;
  }

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const args = ['scraper/dataeye_scraper.py', '--materials-only'];

  try {
    const child = spawn(pythonCmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      shell: process.platform === 'win32',
      detached: true,
      stdio: 'ignore',
    });

    // 写 lock 文件（进程结束时 Python 侧无法自动删，Node 侧也不监听；
    // isAlreadyRunning 会在 pid 不存在时自动判定为"未运行"，lock 文件自然失效）
    try { fs.writeFileSync(LOCK_FILE, String(child.pid ?? ''), 'utf-8'); } catch { /* ignore */ }

    child.unref(); // 不阻塞 Node.js 事件循环

    const msg = `TRIGGERED pid=${child.pid} reason=${reason}`;
    console.log(`[material-trigger] 🎬 ${msg}`);
    appendLog(msg);
    return true;
  } catch (e) {
    const msg = `FAILED to spawn: ${e instanceof Error ? e.message : String(e)} reason=${reason}`;
    console.warn(`[material-trigger] ⚠️ ${msg}`);
    appendLog(msg);
    return false;
  }
}
