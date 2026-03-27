import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getDbPath } from '@/lib/db';
import fs from 'fs';

/**
 * GET: download current database file as attachment
 */
export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: '数据库文件不存在' }, { status: 404 });
  }

  const buffer = fs.readFileSync(dbPath);
  const stat = fs.statSync(dbPath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="dramatracker_backup_${ts}.db"`,
      'Content-Length': String(stat.size),
    },
  });
}
