import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isMysqlMode, query, withTransaction } from '@/lib/mysql';
import { checkPermission, isErrorResponse, getUserFromRequest } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_play_count');
  if (isErrorResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const recordWeek = searchParams.get('record_week') || '';
    const platform = searchParams.get('platform') || '';
    const playletId = searchParams.get('playlet_id') || '';
    const mode = searchParams.get('mode') || 'dramas';

    const useMysql = isMysqlMode();

    // === Chart：单部剧最近 8 周播放总和 ===
    if (mode === 'chart' && playletId) {
      if (useMysql) {
        const rows = await query<{ record_week: string; total: number | string }>(
          `SELECT record_week, SUM(app_play_count) as total
           FROM drama_play_count
           WHERE playlet_id = ?
           GROUP BY record_week
           ORDER BY record_week DESC
           LIMIT 8`,
          [playletId]
        );
        return NextResponse.json(
          rows.map(r => ({ record_week: r.record_week, total: Number(r.total) })).reverse()
        );
      }

      const db = getDb();
      const rows = db.prepare(`
        SELECT record_week, SUM(app_play_count) as total
        FROM drama_play_count
        WHERE playlet_id = ?
        GROUP BY record_week
        ORDER BY record_week DESC
        LIMIT 8
      `).all(playletId) as { record_week: string; total: number }[];
      return NextResponse.json(rows.reverse());
    }

    if (!recordWeek) {
      return NextResponse.json({ error: 'record_week required' }, { status: 400 });
    }

    // === 主查询：所有已分类剧 × 平台 × 该周播放数 ===
    if (useMysql) {
      const params: unknown[] = [recordWeek];
      let platFilter = '';
      if (platform) {
        platFilter = 'AND rs.platform = ?';
        params.push(platform);
      }
      // MySQL ONLY_FULL_GROUP_BY 下，非聚合列须用 ANY_VALUE 包裹；
      // is_ai_drama 来自 drama_review（drama_id 1:1），用 LEFT JOIN 后 ANY_VALUE
      const sql = `
        SELECT
          ANY_VALUE(d.id) as drama_id,
          d.playlet_id,
          ANY_VALUE(d.title) as title,
          ANY_VALUE(d.cover_url) as cover_url,
          ANY_VALUE(dr.is_ai_drama) as is_ai_drama,
          rs.platform,
          MAX(rs.heat_value) as heat_value,
          ANY_VALUE(pc.id) as pc_id,
          ANY_VALUE(pc.app_play_count) as app_play_count,
          ANY_VALUE(pc.input_by) as input_by,
          ANY_VALUE(pc.created_at) as pc_created_at
        FROM drama d
        LEFT JOIN drama_review dr ON dr.drama_id = d.id
        INNER JOIN (
          SELECT playlet_id, platform, MAX(heat_value) as heat_value
          FROM ranking_snapshot
          GROUP BY playlet_id, platform
        ) rs ON d.playlet_id = rs.playlet_id
        LEFT JOIN drama_play_count pc
          ON d.playlet_id = pc.playlet_id
          AND rs.platform = pc.platform
          AND pc.record_week = ?
        WHERE dr.is_ai_drama IS NOT NULL
          ${platFilter}
        GROUP BY d.playlet_id, rs.platform
        ORDER BY heat_value DESC
      `;
      type Row = {
        drama_id: number | string;
        playlet_id: string;
        title: string;
        cover_url: string | null;
        is_ai_drama: string | null;
        platform: string;
        heat_value: number | string | null;
        pc_id: number | string | null;
        app_play_count: number | string | null;
        input_by: string | null;
        pc_created_at: string | null;
      };
      const raw = await query<Row>(sql, params);
      // MySQL DECIMAL/BIGINT 默认以字符串返回，统一转为数字保持与 SQLite 输出一致
      const data = raw.map(r => ({
        ...r,
        drama_id: r.drama_id == null ? null : Number(r.drama_id),
        heat_value: r.heat_value == null ? 0 : Number(r.heat_value),
        pc_id: r.pc_id == null ? null : Number(r.pc_id),
        app_play_count: r.app_play_count == null ? null : Number(r.app_play_count),
      }));
      return NextResponse.json({ data });
    }

    const db = getDb();
    let platFilter = '';
    const params: unknown[] = [];
    if (platform) {
      platFilter = 'AND rs.platform = ?';
      params.push(platform);
    }

    const sql = `
      SELECT
        d.id as drama_id,
        d.playlet_id,
        d.title,
        d.cover_url,
        d.is_ai_drama,
        rs.platform,
        MAX(rs.heat_value) as heat_value,
        pc.id as pc_id,
        pc.app_play_count,
        pc.input_by,
        pc.created_at as pc_created_at
      FROM drama d
      INNER JOIN (
        SELECT playlet_id, platform, MAX(heat_value) as heat_value
        FROM ranking_snapshot
        GROUP BY playlet_id, platform
      ) rs ON d.playlet_id = rs.playlet_id
      LEFT JOIN drama_play_count pc
        ON d.playlet_id = pc.playlet_id
        AND rs.platform = pc.platform
        AND pc.record_week = ?
      WHERE d.is_ai_drama IS NOT NULL
        ${platFilter}
      GROUP BY d.playlet_id, rs.platform
      ORDER BY rs.heat_value DESC
    `;

    const data = db.prepare(sql).all(recordWeek, ...params);
    return NextResponse.json({ data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_play_count');
  if (isErrorResponse(auth)) return auth;

  const user = getUserFromRequest(request);
  const useMysql = isMysqlMode();

  try {
    const body = await request.json();
    const items = Array.isArray(body) ? body : [body];
    const today = new Date().toISOString().slice(0, 10);
    const inputBy = user?.name || user?.username || 'system';

    if (useMysql) {
      // drama_play_count 在 MySQL 没有 UNIQUE 约束，且需要 drama_id（NOT NULL）。
      // 用 DELETE+INSERT 在事务内模拟 upsert，并通过 drama 表反查 drama_id。
      let saved = 0;
      await withTransaction(async (conn) => {
        for (const row of items) {
          if (row.app_play_count == null || row.app_play_count === '') continue;
          const [dramaRows] = (await conn.execute(
            'SELECT id FROM drama WHERE playlet_id = ? LIMIT 1',
            [row.playlet_id]
          )) as unknown as [Array<{ id: number }>, unknown];
          const dramaId = dramaRows[0]?.id;
          if (!dramaId) continue;

          await conn.execute(
            `DELETE FROM drama_play_count
             WHERE playlet_id = ? AND platform = ? AND record_week = ?`,
            [row.playlet_id, row.platform, row.record_week]
          );
          await conn.execute(
            `INSERT INTO drama_play_count
               (drama_id, playlet_id, platform, app_play_count, record_week, record_date, input_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              dramaId,
              row.playlet_id,
              row.platform,
              parseInt(row.app_play_count) || 0,
              row.record_week,
              row.record_date || today,
              row.input_by || inputBy,
            ]
          );
          saved++;
        }
      });
      return NextResponse.json({ success: true, saved }, { status: 201 });
    }

    const db = getDb();
    let saved = 0;
    const upsert = db.prepare(`
      INSERT INTO drama_play_count (playlet_id, platform, app_play_count, record_week, record_date, input_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(playlet_id, platform, record_week) DO UPDATE SET
        app_play_count = excluded.app_play_count,
        input_by = excluded.input_by,
        created_at = datetime('now')
    `);

    const runBatch = db.transaction((rows: typeof items) => {
      for (const row of rows) {
        if (row.app_play_count == null || row.app_play_count === '') continue;
        upsert.run(
          row.playlet_id,
          row.platform,
          parseInt(row.app_play_count) || 0,
          row.record_week,
          row.record_date || today,
          row.input_by || inputBy
        );
        saved++;
      }
    });

    runBatch(items);
    return NextResponse.json({ success: true, saved }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
