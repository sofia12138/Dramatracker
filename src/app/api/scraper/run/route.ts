import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

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
      const send = (text: string) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`));
      };

      let pythonCmd = 'python';
      const isWin = process.platform === 'win32';
      if (!isWin) pythonCmd = 'python3';

      send(`[系统] 启动脚本: ${pythonCmd} ${args.join(' ')}\n`);
      send(`[系统] 脚本路径: ${scriptPath}\n`);

      const child = spawn(pythonCmd, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        shell: isWin,
      });

      child.stdout.on('data', (data: Buffer) => {
        const lines = data.toString('utf-8').split('\n');
        for (const line of lines) {
          if (line.trim()) send(line + '\n');
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const lines = data.toString('utf-8').split('\n');
        for (const line of lines) {
          if (line.trim()) send(`[STDERR] ${line}\n`);
        }
      });

      child.on('error', (err) => {
        send(`[错误] 无法启动 Python: ${err.message}\n`);
        send(`[提示] 请确保 Python 已安装并在 PATH 中\n`);
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true, exitCode: -1 })}\n\n`));
        controller.close();
      });

      child.on('close', (code) => {
        send(`\n[系统] 脚本执行完毕，退出码: ${code}\n`);
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`));
        controller.close();
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
