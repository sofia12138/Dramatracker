import cron from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');
let started = false;

function readConfig(): { auto_fetch_enabled: boolean; auto_fetch_time: string } {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return {
        auto_fetch_enabled: raw.auto_fetch_enabled ?? false,
        auto_fetch_time: raw.auto_fetch_time ?? '09:00',
      };
    }
  } catch { /* use defaults */ }
  return { auto_fetch_enabled: false, auto_fetch_time: '09:00' };
}

function updateConfigField(field: string, value: string) {
  try {
    const raw = fs.existsSync(CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      : {};
    raw[field] = value;
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
  } catch (e) {
    console.error(`[auto-scrape] 写入配置失败: ${e}`);
  }
}

function runScraper() {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const args = ['scraper/dataeye_scraper.py'];

  console.log(`[auto-scrape] 开始执行定时抓取...`);
  updateConfigField('last_auto_fetch_at', new Date().toISOString());
  updateConfigField('last_auto_fetch_status', 'running');

  const child = spawn(pythonCmd, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    shell: process.platform === 'win32',
  });

  child.stdout.on('data', (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\n')) {
      if (line.trim()) console.log(`[auto-scrape] ${line.trim()}`);
    }
  });

  child.stderr.on('data', (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\n')) {
      if (line.trim()) console.error(`[auto-scrape] ${line.trim()}`);
    }
  });

  child.on('close', (code) => {
    console.log(`[auto-scrape] 抓取完成，退出码: ${code}`);
    if (code === 0) {
      updateConfigField('last_auto_fetch_success_at', new Date().toISOString());
      updateConfigField('last_auto_fetch_status', 'success');
    } else {
      updateConfigField('last_auto_fetch_status', 'failed');
    }
  });

  child.on('error', (err) => {
    console.error(`[auto-scrape] 启动失败: ${err.message}`);
    updateConfigField('last_auto_fetch_status', 'failed');
  });
}

export function startScheduler() {
  if (started) return;
  started = true;

  cron.schedule('* * * * *', () => {
    const config = readConfig();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    console.log(`[auto-scrape] tick ${currentTime} | enabled=${config.auto_fetch_enabled} target=${config.auto_fetch_time}`);

    if (!config.auto_fetch_enabled) return;

    if (currentTime === config.auto_fetch_time) {
      console.log(`[auto-scrape] ✅ 命中执行时间 ${currentTime}，准备启动爬虫`);
      runScraper();
    }
  });

  console.log('[auto-scrape] 定时调度器已启动（每分钟检查配置）');
}
