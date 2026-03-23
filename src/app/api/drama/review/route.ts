import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'review_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '40');
    const offset = (page - 1) * pageSize;

    if (platform) {
      const countSql = `
        SELECT COUNT(DISTINCT d.id) as total
        FROM drama d
        INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
        WHERE d.is_ai_drama IS NULL AND rs.platform = ?
      `;
      const countResult = db.prepare(countSql).get(platform) as { total: number };

      const dataSql = `
        SELECT d.*,
          MAX(rs.heat_value) as max_heat_value,
          GROUP_CONCAT(DISTINCT rs.platform) as platforms_str
        FROM drama d
        INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
        WHERE d.is_ai_drama IS NULL AND rs.platform = ?
        GROUP BY d.id
        ORDER BY max_heat_value DESC
        LIMIT ? OFFSET ?
      `;
      const data = db.prepare(dataSql).all(platform, pageSize, offset);

      return NextResponse.json({ data, total: countResult.total, page, pageSize });
    }

    const countResult = db.prepare('SELECT COUNT(*) as total FROM drama WHERE is_ai_drama IS NULL').get() as { total: number };

    const dataSql = `
      SELECT d.*,
        COALESCE(r.max_heat_value, 0) as max_heat_value,
        COALESCE(r.platforms_str, '') as platforms_str
      FROM drama d
      LEFT JOIN (
        SELECT playlet_id,
          MAX(heat_value) as max_heat_value,
          GROUP_CONCAT(DISTINCT platform) as platforms_str
        FROM ranking_snapshot
        GROUP BY playlet_id
      ) r ON d.playlet_id = r.playlet_id
      WHERE d.is_ai_drama IS NULL
      ORDER BY r.max_heat_value DESC NULLS LAST, d.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    const data = db.prepare(dataSql).all(pageSize, offset);

    return NextResponse.json({ data, total: countResult.total, page, pageSize });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'review_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const body = await request.json();
    const { ids, is_ai_drama } = body as { ids: number[]; is_ai_drama: string };

    if (!ids?.length || !is_ai_drama) {
      return NextResponse.json({ error: 'ids and is_ai_drama required' }, { status: 400 });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE drama SET is_ai_drama = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).run(is_ai_drama, ...ids);

    const remaining = (db.prepare('SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL').get() as { count: number }).count;

    return NextResponse.json({ success: true, updated: ids.length, remaining });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
