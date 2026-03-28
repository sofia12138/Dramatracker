import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getDbDir, getDb } from '@/lib/db';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const TMP_DIR = path.join(getDbDir(), 'tmp');

const SCRAPER_FIELDS = [
  'title', 'description', 'language', 'cover_url',
  'first_air_date', 'tags', 'creative_count',
] as const;

/**
 * GET: return current database info + recent backup list
 */
export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  let counts: Record<string, number> = {};
  try {
    const db = getDb();
    counts = {
      drama: (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c,
      ranking_snapshot: (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c,
      invest_trend: (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c,
    };
  } catch { /* ignore */ }

  const backups = listBackups();

  return NextResponse.json({ counts, backups });
}

/**
 * POST: safe incremental import — merge scraper data without overwriting review fields.
 *
 * For drama:
 *   - existing record (by playlet_id): UPDATE scraper fields ONLY, never touch is_ai_drama / genre_*
 *   - new record: INSERT with is_ai_drama = NULL (pending review)
 * For ranking_snapshot / invest_trend:
 *   - INSERT OR IGNORE (UNIQUE constraint deduplicates)
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

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    const tmpPath = path.join(TMP_DIR, 'dramatracker.import.db');
    fs.writeFileSync(tmpPath, Buffer.from(await file.arrayBuffer()));

    let srcDb: Database.Database;
    try {
      srcDb = new Database(tmpPath, { readonly: true });
      const tables = (srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
      const missing = ['drama', 'ranking_snapshot'].filter(t => !tables.includes(t));
      if (missing.length > 0) {
        srcDb.close();
        fs.unlinkSync(tmpPath);
        return NextResponse.json({ error: `数据库缺少必要的表：${missing.join(', ')}` }, { status: 400 });
      }
    } catch {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      return NextResponse.json({ error: '上传的文件不是有效的 SQLite 数据库' }, { status: 400 });
    }

    const db = getDb();
    const stats = { drama_new: 0, drama_updated: 0, drama_skipped: 0, ranking_inserted: 0, trend_inserted: 0 };

    const srcDramas = srcDb.prepare(
      'SELECT playlet_id, title, description, language, cover_url, first_air_date, tags, creative_count FROM drama'
    ).all() as Record<string, unknown>[];

    const updateSet = SCRAPER_FIELDS.map(f => `${f} = ?`).join(', ');
    const updateStmt = db.prepare(
      `UPDATE drama SET ${updateSet}, updated_at = datetime('now') WHERE playlet_id = ?`
    );
    const insertStmt = db.prepare(
      `INSERT INTO drama (playlet_id, title, description, language, cover_url, first_air_date, is_ai_drama, tags, creative_count)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    );
    const existsStmt = db.prepare('SELECT id FROM drama WHERE playlet_id = ?');

    const mergeDramas = db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const pid = row.playlet_id as string;
        const existing = existsStmt.get(pid);
        if (existing) {
          updateStmt.run(
            ...SCRAPER_FIELDS.map(f => row[f] ?? null),
            pid,
          );
          stats.drama_updated++;
        } else {
          insertStmt.run(
            pid,
            row.title ?? '', row.description ?? null, row.language ?? null,
            row.cover_url ?? null, row.first_air_date ?? null,
            row.tags ?? '[]', row.creative_count ?? 0,
          );
          stats.drama_new++;
        }
      }
    });
    mergeDramas(srcDramas);

    const srcSnapshots = srcDb.prepare(
      'SELECT playlet_id, platform, rank, heat_value, material_count, invest_days, snapshot_date FROM ranking_snapshot'
    ).all() as Record<string, unknown>[];

    const insertSnapshot = db.prepare(
      `INSERT OR IGNORE INTO ranking_snapshot (playlet_id, platform, rank, heat_value, material_count, invest_days, snapshot_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const mergeSnapshots = db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const r = insertSnapshot.run(
          row.playlet_id, row.platform, row.rank, row.heat_value ?? 0,
          row.material_count ?? 0, row.invest_days ?? 0, row.snapshot_date,
        );
        if (r.changes > 0) stats.ranking_inserted++;
      }
    });
    mergeSnapshots(srcSnapshots);

    const srcTables = (srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
    if (srcTables.includes('invest_trend')) {
      const srcTrends = srcDb.prepare(
        'SELECT playlet_id, platform, date, daily_invest_count FROM invest_trend'
      ).all() as Record<string, unknown>[];

      const insertTrend = db.prepare(
        `INSERT OR IGNORE INTO invest_trend (playlet_id, platform, date, daily_invest_count) VALUES (?, ?, ?, ?)`
      );
      const mergeTrends = db.transaction((rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const r = insertTrend.run(row.playlet_id, row.platform, row.date, row.daily_invest_count ?? 0);
          if (r.changes > 0) stats.trend_inserted++;
        }
      });
      mergeTrends(srcTrends);
    }

    srcDb.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    const newCounts = {
      drama: (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c,
      ranking_snapshot: (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c,
      invest_trend: (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c,
    };

    console.log('[import] merge complete', stats);

    return NextResponse.json({
      success: true,
      message: `导入完成：新增 ${stats.drama_new} 部剧集，更新 ${stats.drama_updated} 部元数据，新增 ${stats.ranking_inserted} 条榜单记录`,
      stats,
      newCounts,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `导入失败：${msg}` }, { status: 500 });
  }
}

function listBackups() {
  const dbDir = getDbDir();
  try {
    return fs.readdirSync(dbDir)
      .filter(f => f.startsWith('dramatracker.db.bak_'))
      .map(f => {
        const stat = fs.statSync(path.join(dbDir, f));
        return { name: f, size: stat.size, sizeFormatted: formatBytes(stat.size), createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
  } catch { return []; }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
