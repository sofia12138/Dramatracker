import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse, getUserFromRequest } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_play_count');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const recordWeek = searchParams.get('record_week') || '';
    const platform = searchParams.get('platform') || '';
    const playletId = searchParams.get('playlet_id') || '';
    const mode = searchParams.get('mode') || 'dramas';

    if (mode === 'chart' && playletId) {
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

  try {
    const db = getDb();
    const body = await request.json();
    const items = Array.isArray(body) ? body : [body];
    let saved = 0;

    const upsert = db.prepare(`
      INSERT INTO drama_play_count (playlet_id, platform, app_play_count, record_week, record_date, input_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(playlet_id, platform, record_week) DO UPDATE SET
        app_play_count = excluded.app_play_count,
        input_by = excluded.input_by,
        created_at = datetime('now')
    `);

    const today = new Date().toISOString().slice(0, 10);
    const inputBy = user?.name || user?.username || 'system';

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
