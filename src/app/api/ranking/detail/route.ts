import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isMysqlMode, query } from '@/lib/mysql';
import { stringifyJsonField } from '@/lib/json-field';

// MySQL 把 JSON 列自动 parse 成 array/object，前端仍按字符串解析会失败。
// 在 detail 出口把 drama 上的 JSON 列归一化为字符串，与 SQLite 模式对齐。
const DRAMA_JSON_COLS = ['tags', 'genre_tags_manual', 'genre_tags_ai'] as const;
function normalizeDramaJsonFields(drama: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!drama) return drama;
  for (const k of DRAMA_JSON_COLS) {
    if (k in drama) drama[k] = stringifyJsonField(drama[k]);
  }
  return drama;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playletId = searchParams.get('playlet_id');

    if (!playletId) {
      return NextResponse.json({ error: 'playlet_id required' }, { status: 400 });
    }

    if (isMysqlMode()) {
      // drama 主表（合并 drama_review 的人审字段，保持响应结构与 SQLite 模式一致）
      const dramaRows = await query<Record<string, unknown>>(
        `SELECT d.*, dr.is_ai_drama, dr.genre_tags_manual, dr.genre_tags_ai,
                dr.genre_source, dr.review_status
         FROM drama d
         LEFT JOIN drama_review dr ON dr.drama_id = d.id
         WHERE d.playlet_id = ? LIMIT 1`,
        [playletId]
      );
      const drama = normalizeDramaJsonFields(dramaRows[0] ?? null);

      // 历史排名（最近 200 条）
      const rankings = await query(
        `SELECT platform, rank_position AS \`rank\`, heat_value, material_count, invest_days,
                DATE_FORMAT(date_key, '%Y-%m-%d') AS snapshot_date
         FROM ranking_snapshot
         WHERE playlet_id = ?
         ORDER BY date_key DESC, platform ASC
         LIMIT 200`,
        [playletId]
      );

      // 投放趋势
      const investTrend = await query(
        `SELECT platform, DATE_FORMAT(date, '%Y-%m-%d') AS date, daily_invest_count
         FROM invest_trend
         WHERE playlet_id = ?
         ORDER BY date ASC`,
        [playletId]
      );

      // 热度趋势：最近 30 天
      const heatTrend = await query(
        `SELECT platform, DATE_FORMAT(date_key, '%Y-%m-%d') AS date, heat_value
         FROM ranking_snapshot
         WHERE playlet_id = ?
           AND date_key >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         ORDER BY date_key ASC`,
        [playletId]
      );

      // 各平台最新一条排名
      const latestRanks = await query(
        `SELECT rs.platform, rs.rank_position AS \`rank\`, rs.heat_value,
                DATE_FORMAT(rs.date_key, '%Y-%m-%d') AS snapshot_date
         FROM ranking_snapshot rs
         WHERE rs.playlet_id = ?
           AND rs.date_key = (
             SELECT MAX(date_key) FROM ranking_snapshot
             WHERE playlet_id = rs.playlet_id AND platform = rs.platform
           )
         ORDER BY rs.rank_position ASC`,
        [playletId]
      );

      return NextResponse.json({ drama, rankings, investTrend, heatTrend, latestRanks });
    }

    // ── SQLite 兜底 ────────────────────────────────────────────────
    const db = getDb();
    const drama = db.prepare('SELECT * FROM drama WHERE playlet_id = ?').get(playletId);

    const rankings = db.prepare(`
      SELECT platform, rank, heat_value, material_count, invest_days, snapshot_date
      FROM ranking_snapshot
      WHERE playlet_id = ?
      ORDER BY snapshot_date DESC, platform ASC
      LIMIT 200
    `).all(playletId);

    const investTrend = db.prepare(`
      SELECT platform, date, daily_invest_count
      FROM invest_trend
      WHERE playlet_id = ?
      ORDER BY date ASC
    `).all(playletId);

    const heatTrend = db.prepare(`
      SELECT platform, snapshot_date as date, heat_value
      FROM ranking_snapshot
      WHERE playlet_id = ?
        AND snapshot_date >= date('now', '-30 days')
      ORDER BY snapshot_date ASC
    `).all(playletId);

    const latestRanks = db.prepare(`
      SELECT rs.platform, rs.rank, rs.heat_value, rs.snapshot_date
      FROM ranking_snapshot rs
      WHERE rs.playlet_id = ?
        AND rs.snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE playlet_id = rs.playlet_id AND platform = rs.platform)
      ORDER BY rs.rank ASC
    `).all(playletId);

    return NextResponse.json({ drama, rankings, investTrend, heatTrend, latestRanks });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
