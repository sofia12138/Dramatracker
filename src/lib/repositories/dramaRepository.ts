/**
 * dramaRepository.ts
 * 剧目数据访问层 —— 统一封装 drama + drama_review 查询。
 * 支持 MySQL 模式（USE_MYSQL=true）和 SQLite 兜底（现有逻辑）。
 */
import { isMysqlMode, query, execute } from '../mysql';
import { getDb } from '../db';

export interface DramaRow {
  id: number;
  playlet_id: string;
  title: string;
  description: string | null;
  language: string | null;
  cover_url: string | null;
  first_air_date: string | null;
  tags: string | null;
  creative_count: number;
  created_at: string;
  updated_at: string;
  // 审核字段（来自 drama_review JOIN）
  is_ai_drama: string | null;
  genre_tags_manual: string | null;
  genre_tags_ai: string | null;
  genre_source: string | null;
  review_status: string | null;
}

export interface DramaListResult {
  data: DramaRow[];
  total: number;
}

/** 查询剧目列表（带审核字段），支持分页和过滤 */
export async function listDramas(opts: {
  isAiDrama?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<DramaListResult> {
  const { isAiDrama, search = '', page = 1, pageSize = 20 } = opts;
  const offset = (page - 1) * pageSize;

  if (isMysqlMode()) {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (isAiDrama === 'null') {
      conditions.push('(dr.is_ai_drama IS NULL OR dr.id IS NULL)');
    } else if (isAiDrama) {
      conditions.push('dr.is_ai_drama = ?');
      params.push(isAiDrama);
    }
    if (search) {
      conditions.push('(d.title LIKE ? OR d.playlet_id LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.join(' AND ');
    const baseSql = `
      FROM drama d
      LEFT JOIN drama_review dr ON d.id = dr.drama_id
      WHERE ${where}
    `;

    const [countRow] = await query<{ total: number }>(
      `SELECT COUNT(*) as total ${baseSql}`, params
    );
    const data = await query<DramaRow>(
      `SELECT d.*, dr.is_ai_drama, dr.genre_tags_manual, dr.genre_tags_ai,
              dr.genre_source, dr.review_status
       ${baseSql}
       ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return { data, total: countRow?.total ?? 0 };
  }

  // SQLite 兜底
  const db = getDb();
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (isAiDrama === 'null') {
    conditions.push('is_ai_drama IS NULL');
  } else if (isAiDrama) {
    conditions.push('is_ai_drama = ?');
    params.push(isAiDrama);
  }
  if (search) {
    conditions.push('(title LIKE ? OR playlet_id LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.join(' AND ');
  const countResult = db.prepare(`SELECT COUNT(*) as total FROM drama WHERE ${where}`)
    .get(...params) as { total: number };
  const data = db.prepare(`SELECT * FROM drama WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as DramaRow[];

  return { data, total: countResult.total };
}

/** 按 playlet_id 查询单条剧目（含审核字段） */
export async function getDramaByPlayletId(playletId: string): Promise<DramaRow | null> {
  if (isMysqlMode()) {
    const rows = await query<DramaRow>(
      `SELECT d.*, dr.is_ai_drama, dr.genre_tags_manual, dr.genre_tags_ai,
              dr.genre_source, dr.review_status
       FROM drama d LEFT JOIN drama_review dr ON d.id = dr.drama_id
       WHERE d.playlet_id = ? LIMIT 1`,
      [playletId]
    );
    return rows[0] ?? null;
  }

  const db = getDb();
  return (db.prepare('SELECT * FROM drama WHERE playlet_id = ?').get(playletId) as DramaRow) ?? null;
}

/** 待审核列表（MySQL: drama_review 不存在或 pending；SQLite: is_ai_drama IS NULL） */
export async function listPendingReview(opts: {
  platform?: string;
  page?: number;
  pageSize?: number;
}): Promise<DramaListResult> {
  const { platform = '', page = 1, pageSize = 40 } = opts;
  const offset = (page - 1) * pageSize;

  if (isMysqlMode()) {
    const platformJoin = platform ? 'INNER JOIN ranking_snapshot rs ON d.id = rs.drama_id' : '';
    const platformWhere = platform ? 'AND rs.platform = ?' : '';
    const params: unknown[] = platform ? [platform] : [];

    const countSql = `
      SELECT COUNT(DISTINCT d.id) as total
      FROM drama d
      LEFT JOIN drama_review dr ON d.id = dr.drama_id
      ${platformJoin}
      WHERE (dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL)
      ${platformWhere}
    `;
    const dataSql = `
      SELECT d.*, dr.is_ai_drama, dr.genre_tags_manual, dr.genre_tags_ai,
             dr.genre_source, dr.review_status,
             COALESCE(heat.max_heat_value, 0) as max_heat_value,
             COALESCE(heat.platforms_str, '') as platforms_str
      FROM drama d
      LEFT JOIN drama_review dr ON d.id = dr.drama_id
      ${platformJoin}
      LEFT JOIN (
        SELECT drama_id, MAX(heat_value) as max_heat_value,
               GROUP_CONCAT(DISTINCT platform) as platforms_str
        FROM ranking_snapshot GROUP BY drama_id
      ) heat ON d.id = heat.drama_id
      WHERE (dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL)
      ${platformWhere}
      GROUP BY d.id
      ORDER BY max_heat_value DESC, d.updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const [countRow] = await query<{ total: number }>(countSql, params);
    const data = await query<DramaRow>(dataSql, [...params, pageSize, offset]);
    return { data, total: countRow?.total ?? 0 };
  }

  // SQLite 兜底（原有逻辑）
  const db = getDb();
  if (platform) {
    const countResult = db.prepare(`
      SELECT COUNT(DISTINCT d.id) as total
      FROM drama d
      INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      WHERE d.is_ai_drama IS NULL AND rs.platform = ?
    `).get(platform) as { total: number };

    const data = db.prepare(`
      SELECT d.*, MAX(rs.heat_value) as max_heat_value,
             GROUP_CONCAT(DISTINCT rs.platform) as platforms_str
      FROM drama d
      INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      WHERE d.is_ai_drama IS NULL AND rs.platform = ?
      GROUP BY d.id ORDER BY max_heat_value DESC LIMIT ? OFFSET ?
    `).all(platform, pageSize, offset) as DramaRow[];

    return { data, total: countResult.total };
  }

  const countResult = db.prepare(`SELECT COUNT(*) as total FROM drama WHERE is_ai_drama IS NULL`)
    .get() as { total: number };
  const data = db.prepare(`
    SELECT d.*, COALESCE(r.max_heat_value, 0) as max_heat_value,
           COALESCE(r.platforms_str, '') as platforms_str
    FROM drama d
    LEFT JOIN (
      SELECT playlet_id, MAX(heat_value) as max_heat_value,
             GROUP_CONCAT(DISTINCT platform) as platforms_str
      FROM ranking_snapshot GROUP BY playlet_id
    ) r ON d.playlet_id = r.playlet_id
    WHERE d.is_ai_drama IS NULL
    GROUP BY d.id ORDER BY max_heat_value DESC NULLS LAST, d.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset) as DramaRow[];

  return { data, total: countResult.total };
}

/** 批量审核分类（写 drama_review，不碰 drama 主表抓取字段） */
export async function batchClassifyDramas(
  ids: number[],
  isAiDrama: string,
  reviewedBy?: string
): Promise<number> {
  if (!ids.length) return 0;

  if (isMysqlMode()) {
    const placeholders = ids.map(() => '?').join(',');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 取出这批 drama 的 id -> drama_id 映射
    const dramaRows = await query<{ id: number }>(
      `SELECT id FROM drama WHERE id IN (${placeholders})`, ids
    );

    let updated = 0;
    for (const row of dramaRows) {
      await execute(
        `INSERT INTO drama_review (drama_id, is_ai_drama, review_status, reviewed_by, reviewed_at, updated_at)
         VALUES (?, ?, 'reviewed', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           is_ai_drama=VALUES(is_ai_drama),
           review_status='reviewed',
           reviewed_by=VALUES(reviewed_by),
           reviewed_at=VALUES(reviewed_at),
           updated_at=VALUES(updated_at)`,
        [row.id, isAiDrama, reviewedBy ?? null, now, now]
      );
      updated++;
    }
    return updated;
  }

  // SQLite 兜底
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE drama SET is_ai_drama = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
  ).run(isAiDrama, ...ids);
  return result.changes;
}

/** 更新单条剧目的审核信息（含题材标签等） */
export async function updateDramaReview(
  playletId: string,
  fields: {
    is_ai_drama?: string | null;
    genre_tags_manual?: unknown;
    genre_tags_ai?: unknown;
    genre_source?: string | null;
    review_status?: string;
    reviewed_by?: string;
    review_notes?: string;
  }
): Promise<boolean> {
  if (isMysqlMode()) {
    const [dramaRow] = await query<{ id: number }>(
      'SELECT id FROM drama WHERE playlet_id = ?', [playletId]
    );
    if (!dramaRow) return false;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await execute(
      `INSERT INTO drama_review
         (drama_id, is_ai_drama, genre_tags_manual, genre_tags_ai,
          genre_source, review_status, review_notes, reviewed_by, reviewed_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         is_ai_drama=COALESCE(VALUES(is_ai_drama), is_ai_drama),
         genre_tags_manual=COALESCE(VALUES(genre_tags_manual), genre_tags_manual),
         genre_tags_ai=COALESCE(VALUES(genre_tags_ai), genre_tags_ai),
         genre_source=COALESCE(VALUES(genre_source), genre_source),
         review_status=COALESCE(VALUES(review_status), review_status),
         review_notes=COALESCE(VALUES(review_notes), review_notes),
         reviewed_by=COALESCE(VALUES(reviewed_by), reviewed_by),
         reviewed_at=COALESCE(VALUES(reviewed_at), reviewed_at),
         updated_at=VALUES(updated_at)`,
      [
        dramaRow.id,
        fields.is_ai_drama ?? null,
        fields.genre_tags_manual ? JSON.stringify(fields.genre_tags_manual) : null,
        fields.genre_tags_ai ? JSON.stringify(fields.genre_tags_ai) : null,
        fields.genre_source ?? null,
        fields.review_status ?? 'reviewed',
        fields.review_notes ?? null,
        fields.reviewed_by ?? null,
        now, now,
      ]
    );
    return true;
  }

  // SQLite 兜底
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.is_ai_drama !== undefined) { sets.push('is_ai_drama = ?'); params.push(fields.is_ai_drama); }
  if (fields.genre_tags_manual !== undefined) { sets.push('genre_tags_manual = ?'); params.push(JSON.stringify(fields.genre_tags_manual)); }
  if (fields.genre_tags_ai !== undefined) { sets.push('genre_tags_ai = ?'); params.push(JSON.stringify(fields.genre_tags_ai)); }
  if (fields.genre_source !== undefined) { sets.push('genre_source = ?'); params.push(fields.genre_source); }
  sets.push("updated_at = datetime('now')");

  if (sets.length === 1) return false;
  db.prepare(`UPDATE drama SET ${sets.join(', ')} WHERE playlet_id = ?`).run(...params, playletId);
  return true;
}
