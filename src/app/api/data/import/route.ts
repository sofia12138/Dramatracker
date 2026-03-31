import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getDbDir, getDbPath, getDb, resetDb } from '@/lib/db';
import { validateUploadedSqliteReadonly, type UploadDbSnapshot } from '@/lib/db-upload-validate';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const TMP_DIR = path.join(getDbDir(), 'tmp');
const BACKUP_DIR = path.join(getDbDir(), 'backup');

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
 * POST: import database.
 *   mode=merge   (default) — incremental merge, protects review fields
 *   mode=replace — full database replacement with backup + rollback
 */
export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const formData = await request.formData();
    const mode = (formData.get('mode') as string) || 'merge';

    if (mode === 'replace') {
      return handleReplace(formData);
    }
    return handleMerge(formData);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `导入失败：${msg}` }, { status: 500 });
  }
}

// ─── mode=replace ────────────────────────────────────────────────────────────

function fileSizeOrZero(p: string): number {
  try {
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  } catch {
    return 0;
  }
}

function performReplaceRollback(
  dbPath: string,
  walPath: string,
  shmPath: string,
  backupMainPath: string,
  backupWalPath: string,
  backupShmPath: string,
  reason: string,
): void {
  console.error(`[data-import] rollback start: ${reason}`);
  try {
    resetDb();
    console.log('[data-import] resetDb success (rollback)');
  } catch (e) {
    console.error('[data-import] resetDb error (rollback)', e);
  }
  safeUnlink(dbPath);
  safeUnlink(walPath);
  safeUnlink(shmPath);
  if (backupMainPath && fs.existsSync(backupMainPath)) {
    fs.copyFileSync(backupMainPath, dbPath);
    console.log(`[data-import] rollback restored main db from ${backupMainPath}`);
  }
  if (backupWalPath && fs.existsSync(backupWalPath)) {
    fs.copyFileSync(backupWalPath, walPath);
    console.log('[data-import] rollback restored wal');
  }
  if (backupShmPath && fs.existsSync(backupShmPath)) {
    fs.copyFileSync(backupShmPath, shmPath);
    console.log('[data-import] rollback restored shm');
  }
  try {
    getDb();
    console.log('[data-import] rollback reopen getDb success');
  } catch (e) {
    console.error('[data-import] rollback reopen getDb failed', e);
  }
  console.log('[data-import] rollback finished');
}

function assertCountsMatchAfterReplace(
  pre: UploadDbSnapshot,
  postDrama: number,
  postSnap: number,
  postTrend: number,
): void {
  if (postDrama !== pre.drama || postSnap !== pre.ranking_snapshot) {
    throw new Error(
      `替换后行数与上传库不一致：上传 drama=${pre.drama}, ranking_snapshot=${pre.ranking_snapshot}；` +
      `当前 drama=${postDrama}, ranking_snapshot=${postSnap}（可能被错误覆盖或未原子替换）`,
    );
  }
  if (pre.hasInvestTrendTable && pre.invest_trend !== null && postTrend !== pre.invest_trend) {
    throw new Error(
      `替换后 invest_trend 行数不一致：上传 ${pre.invest_trend}，当前 ${postTrend}`,
    );
  }
}

function handleReplace(formData: FormData) {
  const file = formData.get('file') as File | null;
  const walFile = formData.get('walFile') as File | null;

  if (!file) {
    return NextResponse.json({ error: '请选择主库文件（.db）' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `主库文件过大，最大允许 ${formatBytes(MAX_FILE_SIZE)}` }, { status: 400 });
  }
  if (file.size < 100) {
    return NextResponse.json({ error: '主库文件过小，不是有效的 SQLite 数据库' }, { status: 400 });
  }

  const dbPath = getDbPath();
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  const dbPathResolved = path.resolve(dbPath);
  const cwd = process.cwd();

  return (async () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rand = crypto.randomBytes(4).toString('hex');
    const uploadTmpMain = path.join(getDbDir(), `.upload_tmp_${ts}_${rand}.db`);
    const uploadTmpWal = uploadTmpMain + '-wal';

    let backupMainPath = '';
    let backupWalPath = '';
    let backupShmPath = '';
    let preSnapshot: UploadDbSnapshot | null = null;
    let rolledBack = false;
    let replaceReached = false;
    let productionFilesRemoved = false;

    const cleanupUploadTmp = () => {
      safeUnlink(uploadTmpMain);
      safeUnlink(uploadTmpWal);
    };

    console.log('[data-import] mode=replace start');
    console.log(`[data-import] upload received: filename=${file.name}, size=${file.size}, wal=${walFile && walFile.size > 0 ? `${walFile.name}(${walFile.size})` : 'none'}`);
    console.log(`[data-import] runtime cwd=${cwd}`);
    console.log(`[data-import] runtime db path=${dbPathResolved}`);

    try {
      if (!fs.existsSync(getDbDir())) fs.mkdirSync(getDbDir(), { recursive: true });
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

      const mainBuf = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(uploadTmpMain, mainBuf);
      console.log(`[data-import] temp db saved: ${path.resolve(uploadTmpMain)} (${mainBuf.length} bytes)`);

      if (walFile && walFile.size > 0) {
        const walBuf = Buffer.from(await walFile.arrayBuffer());
        fs.writeFileSync(uploadTmpWal, walBuf);
        console.log(`[data-import] temp wal saved: ${path.resolve(uploadTmpWal)} (${walBuf.length} bytes)`);
      }

      try {
        preSnapshot = validateUploadedSqliteReadonly(uploadTmpMain);
      } catch (ve) {
        cleanupUploadTmp();
        const msg = ve instanceof Error ? ve.message : String(ve);
        console.error(`[data-import] error: temp validation failed — ${msg}`);
        return NextResponse.json(
          { success: false, mode: 'replace', rolledBack: false, error: msg, dbPath: dbPathResolved },
          { status: 400 },
        );
      }

      console.log(
        `[data-import] temp db validation passed: drama=${preSnapshot.drama}, ranking_snapshot=${preSnapshot.ranking_snapshot}, ` +
        `invest_trend=${preSnapshot.hasInvestTrendTable ? preSnapshot.invest_trend : 'N/A'}, integrity=ok`,
      );

      const oldMainSize = fileSizeOrZero(dbPath);
      const oldWalSizeBefore = fileSizeOrZero(walPath);
      console.log(`[data-import] old production sizes: main=${oldMainSize}, wal=${oldWalSizeBefore}`);

      try {
        const currentDb = getDb();
        currentDb.pragma('wal_checkpoint(TRUNCATE)');
        console.log('[data-import] wal_checkpoint(TRUNCATE) on current db done');
      } catch {
        console.log('[data-import] wal_checkpoint skipped (no open db or no file)');
      }

      if (fs.existsSync(dbPath)) {
        backupMainPath = path.join(BACKUP_DIR, `dramatracker.db.bak_${ts}`);
        fs.copyFileSync(dbPath, backupMainPath);
        console.log(`[data-import] backup created: ${path.resolve(backupMainPath)}`);
      } else {
        console.log('[data-import] no existing main db to backup');
      }
      if (fs.existsSync(walPath)) {
        backupWalPath = path.join(BACKUP_DIR, `dramatracker.db-wal.bak_${ts}`);
        fs.copyFileSync(walPath, backupWalPath);
        console.log(`[data-import] backup wal: ${backupWalPath}`);
      }
      if (fs.existsSync(shmPath)) {
        backupShmPath = path.join(BACKUP_DIR, `dramatracker.db-shm.bak_${ts}`);
        fs.copyFileSync(shmPath, backupShmPath);
        console.log(`[data-import] backup shm: ${backupShmPath}`);
      }

      console.log('[data-import] resetDb start');
      resetDb();
      console.log('[data-import] resetDb success');

      safeUnlink(dbPath);
      safeUnlink(walPath);
      safeUnlink(shmPath);
      productionFilesRemoved = true;
      console.log('[data-import] removed old production db / wal / shm');

      console.log('[data-import] replace start (rename temp → production)');
      try {
        fs.renameSync(uploadTmpMain, dbPath);
      } catch (renameErr) {
        console.error('[data-import] rename main failed, trying copy+unlink', renameErr);
        fs.copyFileSync(uploadTmpMain, dbPath);
        safeUnlink(uploadTmpMain);
      }

      if (walFile && walFile.size > 0 && fs.existsSync(uploadTmpWal)) {
        try {
          fs.renameSync(uploadTmpWal, walPath);
        } catch {
          fs.copyFileSync(uploadTmpWal, walPath);
          safeUnlink(uploadTmpWal);
        }
      } else {
        safeUnlink(uploadTmpWal);
      }

      replaceReached = true;
      const newMainSize = fileSizeOrZero(dbPath);
      const newWalSize = fileSizeOrZero(walPath);
      console.log(`[data-import] replace success: newMainSize=${newMainSize}, newWalSize=${newWalSize}`);

      console.log('[data-import] reopen db start (getDb)');
      let postDrama: number;
      let postSnap: number;
      let postTrend: number;
      try {
        const db = getDb();
        postDrama = (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c;
        postSnap = (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c;
        postTrend = (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c;
        console.log('[data-import] reopen db success');
      } catch (openErr) {
        const msg = openErr instanceof Error ? openErr.message : String(openErr);
        console.error(`[data-import] error: reopen failed — ${msg}`);
        rolledBack = true;
        performReplaceRollback(dbPath, walPath, shmPath, backupMainPath, backupWalPath, backupShmPath, msg);
        cleanupUploadTmp();
        return NextResponse.json({
          success: false,
          mode: 'replace',
          rolledBack: true,
          error: `替换后无法打开数据库，已回滚：${msg}`,
          dbPath: dbPathResolved,
          backupPath: backupMainPath || null,
        }, { status: 500 });
      }

      try {
        assertCountsMatchAfterReplace(preSnapshot!, postDrama, postSnap, postTrend);
        console.log(
          `[data-import] final validation passed: drama=${postDrama}, ranking_snapshot=${postSnap}, invest_trend=${postTrend}`,
        );
      } catch (assertErr) {
        const msg = assertErr instanceof Error ? assertErr.message : String(assertErr);
        console.error(`[data-import] error: final validation failed — ${msg}`);
        rolledBack = true;
        performReplaceRollback(dbPath, walPath, shmPath, backupMainPath, backupWalPath, backupShmPath, msg);
        cleanupUploadTmp();
        return NextResponse.json({
          success: false,
          mode: 'replace',
          rolledBack: true,
          error: `${msg}（已自动回滚）`,
          dbPath: dbPathResolved,
          validationExpected: preSnapshot,
          validationActual: { drama: postDrama, ranking_snapshot: postSnap, invest_trend: postTrend },
          backupPath: backupMainPath || null,
        }, { status: 500 });
      }

      const walUploaded = !!(walFile && walFile.size > 0);
      console.log('[data-import] mode=replace complete (success)');

      return NextResponse.json({
        success: true,
        verified: true,
        mode: 'replace',
        rolledBack: false,
        message: `整库替换已验证成功：drama ${postDrama} 条，ranking_snapshot ${postSnap} 条${walUploaded ? '，已同步 WAL' : ''}`,
        dbPath: dbPathResolved,
        uploadedFileSize: file.size,
        uploadedWalSize: walFile && walFile.size > 0 ? walFile.size : 0,
        oldFileSize: oldMainSize,
        newFileSize: newMainSize,
        backupPath: backupMainPath ? path.resolve(backupMainPath) : null,
        backupWalPath: backupWalPath ? path.resolve(backupWalPath) : null,
        validationBeforeReplace: preSnapshot,
        newCounts: {
          drama: postDrama,
          ranking_snapshot: postSnap,
          invest_trend: postTrend,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[data-import] error: ${msg}`, error);
      const needRollback =
        backupMainPath && fs.existsSync(backupMainPath) && (replaceReached || productionFilesRemoved);
      if (needRollback) {
        rolledBack = true;
        performReplaceRollback(dbPath, walPath, shmPath, backupMainPath, backupWalPath, backupShmPath, msg);
      }
      cleanupUploadTmp();
      return NextResponse.json({
        success: false,
        mode: 'replace',
        rolledBack,
        error: `整库替换失败：${msg}`,
        dbPath: dbPathResolved,
        backupPath: backupMainPath || null,
      }, { status: 500 });
    }
  })();
}

// ─── mode=merge (existing logic, unchanged) ──────────────────────────────────

async function handleMerge(formData: FormData) {
  console.log('[data-import] mode=merge start');
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

  console.log(`[data-import] merge complete: drama_new=${stats.drama_new} drama_updated=${stats.drama_updated} ranking_inserted=${stats.ranking_inserted}`);

  return NextResponse.json({
    success: true,
    mode: 'merge',
    message: `导入完成：新增 ${stats.drama_new} 部剧集，更新 ${stats.drama_updated} 部元数据，新增 ${stats.ranking_inserted} 条榜单记录`,
    stats,
    newCounts,
    dbPath: path.resolve(getDbPath()),
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function safeUnlink(p: string) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
}

function listBackups() {
  const dirs = [getDbDir(), BACKUP_DIR];
  const files: { name: string; size: number; sizeFormatted: string; createdAt: string }[] = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith('dramatracker.db.bak_')) continue;
        const stat = fs.statSync(path.join(dir, f));
        files.push({ name: f, size: stat.size, sizeFormatted: formatBytes(stat.size), createdAt: stat.mtime.toISOString() });
      }
    } catch { /* ignore */ }
  }
  return files
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
