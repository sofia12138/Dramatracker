import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getDbPath, getDb } from '@/lib/db';
import fs from 'fs';

/**
 * GET: download current database file as attachment.
 * Flushes WAL into the main file first so the download is always complete.
 */
export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: '数据库文件不存在' }, { status: 404 });
  }

  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch { /* proceed even if checkpoint fails */ }

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
