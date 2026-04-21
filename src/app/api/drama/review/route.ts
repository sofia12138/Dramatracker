import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getPendingReviewTotal, getPendingReviewCounts } from '@/lib/review-count';
import { isMysqlMode, query, execute } from '@/lib/mysql';
import { listPendingReview, batchClassifyDramas } from '@/lib/repositories/dramaRepository';

export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'review_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '40');

    // ── MySQL 模式：通过 Repository 层查询，is_ai_drama 来自 drama_review ─────────
    if (isMysqlMode()) {
      const result = await listPendingReview({ platform, page, pageSize });

      // 统计待审核数量（MySQL 版）
      const [countRow] = await query<{ total: number }>(
        `SELECT COUNT(DISTINCT d.id) as total
         FROM drama d
         LEFT JOIN drama_review dr ON d.id = dr.drama_id
         WHERE dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL`
      );
      const platformCountRows = await query<{ platform: string; count: number }>(
        `SELECT rs.platform, COUNT(DISTINCT d.id) as count
         FROM ranking_snapshot rs
         INNER JOIN drama d ON rs.playlet_id = d.playlet_id
         LEFT JOIN drama_review dr ON d.id = dr.drama_id
         WHERE (dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL)
         GROUP BY rs.platform
         ORDER BY count DESC`
      );
      const pendingCounts = {
        total: countRow?.total ?? 0,
        platformCounts: platformCountRows,
      };

      console.log(`[review/mysql] GET total=${result.total} platform=${platform || '全部'}`);
      return NextResponse.json({
        data: result.data,
        total: result.total,
        page,
        pageSize,
        pendingCounts,
      });
    }

    // ── SQLite 模式（现有逻辑，保持不变）────────────────────────────────────────
    const db = getDb();
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
        SELECT d.id, d.playlet_id, d.title, d.description, d.language,
          d.cover_url, d.first_air_date, d.is_ai_drama, d.tags,
          d.creative_count, d.created_at, d.updated_at,
          d.genre_tags_ai, d.genre_tags_manual, d.genre_source,
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

      console.log(`[review] GET total=${countResult.total} data=${data.length} platform=${platform}`);
      return NextResponse.json({ data, total: countResult.total, page, pageSize });
    }

    const total = await getPendingReviewTotal();

    const dataSql = `
      SELECT d.id, d.playlet_id, d.title, d.description, d.language,
        d.cover_url, d.first_air_date, d.is_ai_drama, d.tags,
        d.creative_count, d.created_at, d.updated_at,
        d.genre_tags_ai, d.genre_tags_manual, d.genre_source,
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
      GROUP BY d.id
      ORDER BY max_heat_value DESC NULLS LAST, d.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    const data = db.prepare(dataSql).all(pageSize, offset);

    console.log(`[review] GET total=${total} data=${data.length} platform=全部`);
    return NextResponse.json({ data, total, page, pageSize });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'review_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const body = await request.json();
    const { ids, is_ai_drama } = body as { ids: number[]; is_ai_drama: string };

    if (!ids?.length || !is_ai_drama) {
      return NextResponse.json({ error: 'ids and is_ai_drama required' }, { status: 400 });
    }

    // ── MySQL 模式：写 drama_review 表，不碰 drama.is_ai_drama ─────────────────
    if (isMysqlMode()) {
      const updated = await batchClassifyDramas(ids, is_ai_drama);

      // MySQL 版待审核统计
      const [countRow] = await query<{ total: number }>(
        `SELECT COUNT(DISTINCT d.id) as total
         FROM drama d
         LEFT JOIN drama_review dr ON d.id = dr.drama_id
         WHERE dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL`
      );
      const platformCountRows = await query<{ platform: string; count: number }>(
        `SELECT rs.platform, COUNT(DISTINCT d.id) as count
         FROM ranking_snapshot rs
         INNER JOIN drama d ON rs.playlet_id = d.playlet_id
         LEFT JOIN drama_review dr ON d.id = dr.drama_id
         WHERE (dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL)
         GROUP BY rs.platform ORDER BY count DESC`
      );

      console.log(`[review/mysql] batch classify ids=[${ids}] as ${is_ai_drama} updated=${updated}`);
      return NextResponse.json({
        success: true,
        updated,
        counts: { total: countRow?.total ?? 0, platformCounts: platformCountRows },
      });
    }

    // ── SQLite 模式（现有逻辑）────────────────────────────────────────────────
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `UPDATE drama SET is_ai_drama = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).run(is_ai_drama, ...ids);

    console.log(`[review] batch classify ids=[${ids}] as ${is_ai_drama} changes=${result.changes}`);

    const counts = await getPendingReviewCounts();
    return NextResponse.json({ success: true, updated: result.changes, counts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
