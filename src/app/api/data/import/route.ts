import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getDbPath, getDbDir, resetDb, getDb } from '@/lib/db';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const TMP_DIR = path.join(getDbDir(), 'tmp');

/**
 * GET: return current database file info + recent backup list
 */
export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  const dbPath = getDbPath();
  let dbInfo = { exists: false, size: 0, sizeFormatted: '', modifiedAt: '' };

  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    dbInfo = {
      exists: true,
      size: stat.size,
      sizeFormatted: formatBytes(stat.size),
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  // List recent backups
  const dbDir = getDbDir();
  const backups = fs.readdirSync(dbDir)
    .filter(f => f.startsWith('dramatracker.db.bak_'))
    .map(f => {
      const stat = fs.statSync(path.join(dbDir, f));
      return { name: f, size: stat.size, sizeFormatted: formatBytes(stat.size), createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);

  // DB row counts for quick health check
  let counts: Record<string, number> = {};
  try {
    const db = getDb();
    counts = {
      drama: (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c,
      ranking_snapshot: (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c,
      invest_trend: (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c,
    };
  } catch { /* ignore if db not ready */ }

  return NextResponse.json({ dbInfo, backups, counts });
}

/**
 * POST: upload and replace the database file
 * Workflow: receive file → save to tmp → validate SQLite → backup old → replace → reset connection
 */
export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请选择要上传的数据库文件' }, { status: 400 });
    }

    if (!file.name.endsWith('.db')) {
      return NextResponse.json({ error: '仅支持 .db 格式文件' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `文件过大，最大允许 ${formatBytes(MAX_FILE_SIZE)}` }, { status: 400 });
    }

    if (file.size < 100) {
      return NextResponse.json({ error: '文件过小，不是有效的 SQLite 数据库' }, { status: 400 });
    }

    // Step 1: Save to temp file
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
    const tmpPath = path.join(TMP_DIR, `dramatracker.import.db`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    // Step 2: Validate the uploaded file is a valid SQLite database
    let importedCounts: Record<string, number> = {};
    try {
      const tmpDb = new Database(tmpPath, { readonly: true });
      const tables = tmpDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as { name: string }[];
      const tableNames = tables.map(t => t.name);

      const required = ['drama', 'ranking_snapshot'];
      const missing = required.filter(t => !tableNames.includes(t));
      if (missing.length > 0) {
        tmpDb.close();
        fs.unlinkSync(tmpPath);
        return NextResponse.json({ error: `数据库缺少必要的表：${missing.join(', ')}` }, { status: 400 });
      }

      for (const t of ['drama', 'ranking_snapshot', 'invest_trend']) {
        if (tableNames.includes(t)) {
          importedCounts[t] = (tmpDb.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
        }
      }

      tmpDb.close();
    } catch (e) {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      return NextResponse.json({ error: '上传的文件不是有效的 SQLite 数据库' }, { status: 400 });
    }

    // Step 3: Close current DB connection to release file locks
    resetDb();

    const dbPath = getDbPath();

    // Step 4: Backup current database
    let backupName = '';
    if (fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      backupName = `dramatracker.db.bak_${ts}`;
      const backupPath = path.join(getDbDir(), backupName);
      fs.copyFileSync(dbPath, backupPath);

      // Also backup WAL/SHM files if they exist
      for (const suffix of ['-wal', '-shm']) {
        const walPath = dbPath + suffix;
        if (fs.existsSync(walPath)) {
          fs.copyFileSync(walPath, backupPath + suffix);
        }
      }
    }

    // Step 5: Replace database file
    fs.copyFileSync(tmpPath, dbPath);
    fs.unlinkSync(tmpPath);

    // Remove stale WAL/SHM from old DB
    for (const suffix of ['-wal', '-shm']) {
      const walPath = dbPath + suffix;
      if (fs.existsSync(walPath)) {
        try { fs.unlinkSync(walPath); } catch { /* ignore */ }
      }
    }

    // Step 6: Re-open database to validate and run migrations
    let newCounts: Record<string, number> = {};
    try {
      const db = getDb();
      newCounts = {
        drama: (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c,
        ranking_snapshot: (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c,
        invest_trend: (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c,
      };
    } catch (e) {
      // Rollback: restore backup
      if (backupName) {
        const backupPath = path.join(getDbDir(), backupName);
        if (fs.existsSync(backupPath)) {
          resetDb();
          fs.copyFileSync(backupPath, dbPath);
          getDb(); // re-open
        }
      }
      return NextResponse.json({ error: '导入的数据库无法正常打开，已自动回滚' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '数据库导入成功',
      backup: backupName,
      importedCounts,
      newCounts,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `导入失败：${msg}` }, { status: 500 });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
