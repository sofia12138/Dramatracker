import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { lockDbForScraper, unlockDbAfterScraper } from '@/lib/db';
import { exportDailyDb } from '@/lib/export-daily';
import { triggerMaterialsAsync } from '@/lib/trigger-materials';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

function updateConfigField(field: string, value: string) {
  try {
    const raw = fs.existsSync(CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      : {};
    raw[field] = value;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
  } catch (e) {
    console.error(`[manual-scrape] 写入配置失败: ${e}`);
  }
}

async function triggerReviewAlert(log: (msg: string) => void) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/notify/review-alert`, { method: 'POST' });
    const data = await res.json();
    if (data.notified) {
      log(`[通知] 飞书审核提醒已发送（${data.count}条待审核）\n`);
    } else {
      log('[通知] 无待审核剧集，未发送飞书通知\n');
    }
  } catch (e) {
    log(`[通知] 飞书通知发送失败: ${e instanceof Error ? e.message : e}\n`);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  const { backfill, platform } = await request.json().catch(() => ({ backfill: 0, platform: undefined }));

  const scriptPath = path.join(process.cwd(), 'scraper', 'dataeye_scraper.py');
  const isFullScrape = !platform?.trim() && !(backfill && backfill > 0);
  const args = ['scraper/dataeye_scraper.py'];
  if (backfill && backfill > 0) {
    args.push('--backfill', String(backfill));
  }
  // 单平台抓取（仅当传入 platform 字符串时）；脚本会按 platforms.name/key 大小写不敏感匹配
  if (typeof platform === 'string' && platform.trim()) {
    args.push('--platform', platform.trim());
  }
  // 全量抓取时跳过内嵌 Phase 2：素材抓取由 triggerMaterialsAsync 在抓取成功后单独触发
  if (isFullScrape) {
    args.push('--skip-materials');
  }

  const readable = new ReadableStream({
    start(controller) {
      let closed = false;
      const encoder = new TextEncoder();

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        } catch {
          closed = true;
        }
      };

      const finish = (exitCode: number) => {
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, exitCode })}\n\n`));
          controller.close();
        } catch { /* already closed */ }
      };

      let pythonCmd = 'python';
      const isWin = process.platform === 'win32';
      if (!isWin) pythonCmd = 'python3';

      lockDbForScraper();
      send(`[系统] 已锁定数据库连接\n`);
      send(`[系统] 启动脚本: ${pythonCmd} ${args.join(' ')}\n`);
      send(`[系统] 脚本路径: ${scriptPath}\n`);

      updateConfigField('last_auto_fetch_at', new Date().toISOString());
      updateConfigField('last_auto_fetch_status', 'running');

      const child = spawn(pythonCmd, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        shell: isWin,
      });

      child.stdout.on('data', (data: Buffer) => {
        for (const line of data.toString('utf-8').split('\n')) {
          if (line.trim()) send(line + '\n');
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        for (const line of data.toString('utf-8').split('\n')) {
          if (line.trim()) send(`[STDERR] ${line}\n`);
        }
      });

      child.on('error', (err) => {
        unlockDbAfterScraper();
        send(`[错误] 无法启动 Python: ${err.message}\n`);
        send(`[提示] 请确保 Python 已安装并在 PATH 中\n`);
        updateConfigField('last_auto_fetch_status', 'failed');
        finish(-1);
      });

      child.on('close', async (code) => {
        unlockDbAfterScraper();
        send(`\n[系统] 脚本执行完毕，退出码: ${code}\n`);
        if (code === 0) {
          updateConfigField('last_auto_fetch_success_at', new Date().toISOString());
          updateConfigField('last_auto_fetch_status', 'success');
          const exportResult = exportDailyDb();
          if (exportResult) {
            send(`[系统] 每日数据已导出: ${exportResult.stats.snapshots} snapshots, ${exportResult.stats.dramas} dramas -> ${exportResult.path}\n`);
          }
          await triggerReviewAlert(send);
          // 全量抓取成功后，后台触发素材抓取（单平台/backfill 不触发）
          if (isFullScrape) {
            const triggered = triggerMaterialsAsync('post_manual_scrape');
            send(`[系统] 素材抓取已在后台启动${triggered ? '' : '（Python 不可用，已跳过）'}\n`);
          }
        } else {
          updateConfigField('last_auto_fetch_status', 'failed');
        }
        finish(code ?? 1);
      });
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
