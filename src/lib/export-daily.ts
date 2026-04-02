import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'dramatracker.db');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');

export function exportDailyDb(dateStr?: string): { path: string; stats: { snapshots: number; trends: number; dramas: number } } | null {
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);

  try {
    if (!fs.existsSync(EXPORT_DIR)) {
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
    }

    const outPath = path.join(EXPORT_DIR, `export_${targetDate}.db`);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

    const src = new Database(DB_PATH, { readonly: true });
    const dst = new Database(outPath);

    const copyTable = (tableName: string, whereClause: string, params: unknown[]): number => {
      const schema = src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(tableName) as { sql: string } | undefined;
      if (!schema) return 0;
      dst.exec(schema.sql);
      const rows = src.prepare(`SELECT * FROM ${tableName} WHERE ${whereClause}`).all(...params) as Record<string, unknown>[];
      if (rows.length === 0) return 0;
      const cols = Object.keys(rows[0]);
      const insert = dst.prepare(`INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      dst.transaction((items: Record<string, unknown>[]) => {
        for (const r of items) insert.run(...cols.map(c => r[c]));
      })(rows);
      return rows.length;
    };

    const snapshots = copyTable('ranking_snapshot', 'snapshot_date = ?', [targetDate]);
    const trends = copyTable('invest_trend', 'date = ?', [targetDate]);

    const dramaSchema = src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='drama'`).get() as { sql: string } | undefined;
    let dramas = 0;
    if (dramaSchema) {
      dst.exec(dramaSchema.sql);
      const dramaRows = src.prepare(`
        SELECT d.* FROM drama d
        WHERE d.playlet_id IN (SELECT DISTINCT playlet_id FROM ranking_snapshot WHERE snapshot_date = ?)
      `).all(targetDate) as Record<string, unknown>[];
      if (dramaRows.length > 0) {
        const cols = Object.keys(dramaRows[0]);
        const insert = dst.prepare(`INSERT INTO drama (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        dst.transaction((items: Record<string, unknown>[]) => {
          for (const r of items) insert.run(...cols.map(c => r[c]));
        })(dramaRows);
        dramas = dramaRows.length;
      }
    }

    src.close();
    dst.close();

    const size = fs.statSync(outPath).size;
    console.log(`[export-daily] ${targetDate}: snapshots=${snapshots} trends=${trends} dramas=${dramas} size=${(size / 1024).toFixed(1)}KB -> ${outPath}`);

    return { path: outPath, stats: { snapshots, trends, dramas } };
  } catch (e) {
    console.error(`[export-daily] 导出失败: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
