import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  const { backfill } = await request.json().catch(() => ({ backfill: 0 }));

  const scriptPath = path.join(process.cwd(), 'scraper', 'dataeye_scraper.py');
  const args = ['scraper/dataeye_scraper.py'];
  if (backfill && backfill > 0) {
    args.push('--backfill', String(backfill));
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
        send(`[错误] 无法启动 Python: ${err.message}\n`);
        send(`[提示] 请确保 Python 已安装并在 PATH 中\n`);
        updateConfigField('last_auto_fetch_status', 'failed');
        finish(-1);
      });

      child.on('close', (code) => {
        send(`\n[系统] 脚本执行完毕，退出码: ${code}\n`);
        if (code === 0) {
          updateConfigField('last_auto_fetch_success_at', new Date().toISOString());
          updateConfigField('last_auto_fetch_status', 'success');
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
