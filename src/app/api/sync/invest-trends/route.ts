/**
 * POST /api/sync/invest-trends
 *
 * 推送每日投放趋势数据。
 * 写入规则：(drama_id, platform, date) UNIQUE -> 重复则覆盖数量。
 *
 * 请求体（JSON）：
 * {
 *   source: string,
 *   platform: string,
 *   trends: InvestTrendSyncItem[]
 * }
 *
 * InvestTrendSyncItem：
 * {
 *   playlet_id: string,
 *   date: string,                   // YYYY-MM-DD
 *   daily_invest_count: number,
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkSyncAuth } from '@/lib/sync-auth';
import { isMysqlMode, getMysqlPool, withTransaction } from '@/lib/mysql';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InvestTrendSyncItem {
  playlet_id: string;
  date: string;
  daily_invest_count: number;
}

function normalizeDateStr(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

export async function POST(request: NextRequest) {
  const authErr = checkSyncAuth(request);
  if (authErr) return authErr;

  let body: { source?: string; platform?: string; trends?: InvestTrendSyncItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体 JSON 解析失败' }, { status: 400 });
  }

  const { source = 'unknown', platform, trends } = body;
  if (!platform) return NextResponse.json({ error: 'platform 为必填项' }, { status: 400 });
  if (!Array.isArray(trends) || trends.length === 0) {
    return NextResponse.json({ error: 'trends 数组不能为空' }, { status: 400 });
  }
  for (const t of trends) {
    if (!t.playlet_id || !t.date) {
      return NextResponse.json({ error: 'trends 每条必须包含 playlet_id 和 date' }, { status: 400 });
    }
  }

  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

  if (isMysqlMode()) {
    const pool = getMysqlPool();
    let logId = 0;

    try {
      const [logResult] = await pool.execute(
        `INSERT INTO sync_log (sync_type, source, started_at, status) VALUES ('invest_trends', ?, NOW(), 'running')`,
        [source]
      ) as unknown as [{ insertId: number }];
      logId = logResult.insertId;
    } catch { /* ignore */ }

    try {
      const playletIds = Array.from(new Set(trends.map(t => t.playlet_id)));
      const placeholders = playletIds.map(() => '?').join(',');
      const [dramaRows] = await pool.execute(
        `SELECT id, playlet_id FROM drama WHERE playlet_id IN (${placeholders})`, playletIds
      ) as unknown as [{ id: number; playlet_id: string }[][]];
      const idMap = new Map(dramaRows.map(r => [r.playlet_id, r.id]));

      await withTransaction(async (conn) => {
        for (const t of trends) {
          const dramaId = idMap.get(t.playlet_id);
          if (!dramaId) { counts.skipped++; continue; }
          const date = normalizeDateStr(t.date);
          if (!date) { counts.skipped++; continue; }

          try {
            await conn.execute(
              `INSERT INTO invest_trend (drama_id, playlet_id, platform, date, daily_invest_count)
               VALUES (?,?,?,?,?)
               ON DUPLICATE KEY UPDATE daily_invest_count=VALUES(daily_invest_count)`,
              [dramaId, t.playlet_id, platform, date, t.daily_invest_count || 0]
            );
            counts.inserted++;
          } catch {
            counts.failed++;
          }
        }
      });

      if (logId) {
        await pool.execute(
          `UPDATE sync_log SET status='success', finished_at=NOW(),
             inserted_count=?, skipped_count=? WHERE id=?`,
          [counts.inserted, counts.skipped, logId]
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (logId) {
        await pool.execute(
          `UPDATE sync_log SET status='failed', finished_at=NOW(), error_message=? WHERE id=?`,
          [msg, logId]
        );
      }
      return NextResponse.json({ error: `同步失败: ${msg}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...counts, total: trends.length });
  }

  // SQLite 兜底
  try {
    const db = getDb();
    const upsert = db.transaction((items: InvestTrendSyncItem[]) => {
      for (const t of items) {
        const date = normalizeDateStr(t.date);
        if (!date) { counts.skipped++; continue; }
        try {
          db.prepare(
            `INSERT INTO invest_trend (playlet_id, platform, date, daily_invest_count)
             VALUES (?,?,?,?)
             ON CONFLICT(playlet_id, platform, date) DO UPDATE SET daily_invest_count=excluded.daily_invest_count`
          ).run(t.playlet_id, platform, date, t.daily_invest_count || 0);
          counts.inserted++;
        } catch {
          counts.failed++;
        }
      }
    });
    upsert(trends);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `同步失败: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...counts, total: trends.length });
}
