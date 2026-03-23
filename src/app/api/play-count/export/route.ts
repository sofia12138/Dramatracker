import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_play_count');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const recordWeek = searchParams.get('record_week') || '';
    const platform = searchParams.get('platform') || '';

    if (!recordWeek) {
      return NextResponse.json({ error: 'record_week required' }, { status: 400 });
    }

    let platFilter = '';
    const params: unknown[] = [recordWeek];

    if (platform) {
      platFilter = 'AND rs.platform = ?';
      params.push(platform);
    }

    const sql = `
      SELECT 
        d.title,
        rs.platform,
        MAX(rs.heat_value) as heat_value,
        pc.app_play_count,
        pc.created_at as record_time
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

    const rows = db.prepare(sql).all(...params) as {
      title: string; platform: string; heat_value: number;
      app_play_count: number | null; record_time: string | null;
    }[];

    const BOM = '\uFEFF';
    const header = '剧名,平台,累计热力值,APP内外显播放量,录入时间\n';
    const csvRows = rows.map(r =>
      `"${(r.title || '').replace(/"/g, '""')}","${r.platform}",${r.heat_value || 0},${r.app_play_count ?? ''},${r.record_time || ''}`
    ).join('\n');

    const csv = BOM + header + csvRows;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="play_count_${recordWeek}_${platform || 'all'}.csv"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
