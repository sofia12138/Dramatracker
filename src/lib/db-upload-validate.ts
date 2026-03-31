/**
 * Read-only validation of an uploaded SQLite file.
 * Does NOT call initDb / CREATE TABLE — avoids masking empty or wrong schemas.
 */
import Database from 'better-sqlite3';

export interface UploadDbSnapshot {
  drama: number;
  ranking_snapshot: number;
  invest_trend: number | null;
  hasInvestTrendTable: boolean;
}

const DRAMA_COLS = ['playlet_id', 'title'] as const;
const SNAPSHOT_COLS = ['playlet_id', 'platform', 'rank', 'snapshot_date'] as const;
const TREND_COLS = ['playlet_id', 'platform', 'date'] as const;

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map(r => r.name));
}

function requireColumns(table: string, cols: readonly string[], present: Set<string>) {
  const missing = cols.filter(c => !present.has(c));
  if (missing.length > 0) {
    throw new Error(`表 ${table} 缺少列：${missing.join(', ')}`);
  }
}

/**
 * Open path readonly, run integrity_check, verify core tables / columns / counts.
 * If main file has sibling `-wal`, SQLite applies it automatically.
 */
export function validateUploadedSqliteReadonly(dbFilePath: string): UploadDbSnapshot {
  let db: Database.Database;
  try {
    db = new Database(dbFilePath, { readonly: true, fileMustExist: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无法以只读方式打开 SQLite 文件：${msg}`);
  }

  try {
    const ic = db.pragma('integrity_check', { simple: true }) as string;
    if (ic !== 'ok') {
      throw new Error(`PRAGMA integrity_check 未通过：${ic}`);
    }

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map(r => r.name);
    const tableSet = new Set(tables);
    for (const need of ['drama', 'ranking_snapshot'] as const) {
      if (!tableSet.has(need)) {
        throw new Error(`缺少核心表：${need}`);
      }
    }

    requireColumns('drama', DRAMA_COLS, tableColumns(db, 'drama'));
    requireColumns('ranking_snapshot', SNAPSHOT_COLS, tableColumns(db, 'ranking_snapshot'));

    const drama = (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c;
    const ranking_snapshot = (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c;

    if (drama === 0 && ranking_snapshot === 0) {
      throw new Error('上传库中 drama 与 ranking_snapshot 行数均为 0，拒绝替换（可能是空库或错误文件）');
    }

    let invest_trend: number | null = null;
    let hasInvestTrendTable = false;
    if (tableSet.has('invest_trend')) {
      hasInvestTrendTable = true;
      requireColumns('invest_trend', TREND_COLS, tableColumns(db, 'invest_trend'));
      invest_trend = (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c;
    }

    if (drama > 0) {
      db.prepare('SELECT id, playlet_id, title FROM drama LIMIT 1').get();
    }
    if (ranking_snapshot > 0) {
      db.prepare('SELECT playlet_id, platform, rank, snapshot_date FROM ranking_snapshot LIMIT 1').get();
    }

    return { drama, ranking_snapshot, invest_trend, hasInvestTrendTable };
  } finally {
    try {
      db.close();
    } catch { /* ignore */ }
  }
}
