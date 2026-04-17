/**
 * db-compat.ts
 * 双模式（SQLite / MySQL）查询兼容层
 *
 * 解决问题：多处 AI 分析和 Dashboard 路由使用 getDb()（SQLite）并直接引用
 * drama.is_ai_drama。迁移到 MySQL 后，该字段移入 drama_review 表。
 * 此模块统一提供两种模式所需的 SQL 片段与跨模式查询方法。
 */
import { isMysqlMode, query as mysqlQuery } from './mysql';
import { getDb } from './db';

// ── SQL 片段（直接嵌入 SQL 字符串使用）────────────────────────────────────────
export interface SqlParts {
  /** drama JOIN 之后追加，MySQL 模式为 drama_review JOIN，SQLite 为空 */
  reviewJoin: string;
  /** is_ai_drama 的列引用，MySQL → dr.is_ai_drama，SQLite → d.is_ai_drama */
  isAiCol: string;
  /**
   * ranking_snapshot 的快照日期列名
   * SQLite → snapshot_date，MySQL → date_key
   */
  snapshotDateCol: string;
  /**
   * ranking_snapshot 的排名列名
   * SQLite → rank，MySQL → rank_position
   */
  rankCol: string;
}

/**
 * 返回当前模式（MySQL/SQLite）对应的 SQL 片段。
 * 注意：只应在实际使用对应连接的查询中调用。
 * 使用 getDb() 的 SQLite 路由请用 getSqliteOnlyParts()。
 */
export function getSqlParts(): SqlParts {
  const isMySQL = isMysqlMode();
  return {
    reviewJoin:      isMySQL ? 'LEFT JOIN drama_review dr ON d.id = dr.drama_id' : '',
    isAiCol:         isMySQL ? 'dr.is_ai_drama' : 'd.is_ai_drama',
    snapshotDateCol: isMySQL ? 'date_key' : 'snapshot_date',
    rankCol:         isMySQL ? 'rank_position' : 'rank',
  };
}

/**
 * 始终返回 SQLite 兼容的 SQL 片段。
 * 用于"永远读 SQLite"的路由（ranking, ai分析等），避免在 MySQL 模式下
 * 注入 drama_review JOIN 到 SQLite 查询中导致崩溃。
 */
export function getSqliteOnlyParts(): Omit<SqlParts, 'reviewJoin'> & { reviewJoin: '' } {
  return {
    reviewJoin:      '',
    isAiCol:         'd.is_ai_drama',
    snapshotDateCol: 'snapshot_date',
    rankCol:         'rank',
  };
}

// ── 跨模式 COUNT 查询 ────────────────────────────────────────────────────────

/** 按 is_ai_drama 类型统计剧目数量 */
export async function countDramasByType(type: string): Promise<number> {
  if (isMysqlMode()) {
    const [row] = await mysqlQuery<{ c: number }>(
      "SELECT COUNT(*) as c FROM drama_review WHERE is_ai_drama = ?", [type]
    );
    return row?.c ?? 0;
  }
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama = ?").get(type) as { c: number }).c;
}

// ── 跨模式通用查询（供 AI 分析、Dashboard 等使用）────────────────────────────

/**
 * 查询最新榜单中的 AI 剧（过滤指定类型），统一返回结构
 * MySQL 模式：JOIN drama_review
 * SQLite 模式：直接使用 drama.is_ai_drama
 */
export async function queryAiDramaRankings(opts: {
  latestDate: string;
  aiTypes?: string[];   // ['ai_real','ai_manga']，为空则不过滤
  limit?: number;
}): Promise<Array<{
  playlet_id: string; title: string; platform: string; rank: number;
  heat_value: number; language: string; tags: string;
  material_count: number; invest_days: number; is_ai_drama: string | null;
}>> {
  const { latestDate, aiTypes = [], limit = 40 } = opts;
  const { reviewJoin, isAiCol, snapshotDateCol } = getSqlParts();

  const typeFilter = aiTypes.length > 0
    ? `AND ${isAiCol} IN (${aiTypes.map(() => '?').join(',')})`
    : '';
  const params: unknown[] = [latestDate, ...aiTypes, limit];

  if (isMysqlMode()) {
    const mysqlSql = `
      SELECT d.playlet_id, d.title, rs.platform, rs.rank_position as rank, rs.heat_value,
             d.language, d.tags, rs.material_count, rs.invest_days,
             ${isAiCol} as is_ai_drama
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      ${reviewJoin}
      WHERE rs.${snapshotDateCol} = ?
      ${typeFilter}
      ORDER BY rs.heat_value DESC
      LIMIT ?
    `;
    return mysqlQuery(mysqlSql, params);
  }

  const db = getDb();
  const sqliteSql = `
    SELECT d.playlet_id, d.title, rs.platform, rs.rank, rs.heat_value,
           d.language, d.tags, rs.material_count, rs.invest_days,
           d.is_ai_drama
    FROM ranking_snapshot rs
    INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    WHERE rs.snapshot_date = ?
    ${aiTypes.length > 0 ? `AND d.is_ai_drama IN (${aiTypes.map(() => '?').join(',')})` : ''}
    ORDER BY rs.heat_value DESC
    LIMIT ?
  `;
  type Row = { playlet_id: string; title: string; platform: string; rank: number; heat_value: number; language: string; tags: string; material_count: number; invest_days: number; is_ai_drama: string | null };
  return db.prepare(sqliteSql).all(...params) as Row[];
}

/**
 * 平台 × AI类型 剧目数量统计
 */
export async function queryPlatformAiCount(opts: {
  dateFrom: string;
  dateTo: string;
}): Promise<Array<{ platform: string; is_ai_drama: string; cnt: number }>> {
  const { dateFrom, dateTo } = opts;

  if (isMysqlMode()) {
    const { reviewJoin, isAiCol } = getSqlParts();
    return mysqlQuery(`
      SELECT rs.platform, ${isAiCol} as is_ai_drama, COUNT(DISTINCT d.playlet_id) as cnt
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      ${reviewJoin}
      WHERE rs.date_key >= ? AND rs.date_key <= ?
        AND ${isAiCol} IN ('ai_real', 'ai_manga')
      GROUP BY rs.platform, ${isAiCol}
    `, [dateFrom, dateTo]);
  }
  const db = getDb();
  return db.prepare(`
    SELECT rs.platform, d.is_ai_drama, COUNT(DISTINCT d.playlet_id) as cnt
    FROM ranking_snapshot rs
    INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
      AND d.is_ai_drama IN ('ai_real', 'ai_manga')
    GROUP BY rs.platform, d.is_ai_drama
  `).all(dateFrom, dateTo) as Array<{ platform: string; is_ai_drama: string; cnt: number }>;
}

/**
 * 语种分布统计（按 AI 类型过滤）
 */
export async function queryLanguageDistribution(opts: {
  dateFrom: string;
  dateTo: string;
}): Promise<Array<{ language: string; cnt: number }>> {
  const { dateFrom, dateTo } = opts;

  if (isMysqlMode()) {
    const { reviewJoin, isAiCol } = getSqlParts();
    return mysqlQuery(`
      SELECT d.language, COUNT(DISTINCT d.playlet_id) as cnt
      FROM drama d
      INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      ${reviewJoin}
      WHERE rs.date_key >= ? AND rs.date_key <= ?
        AND ${isAiCol} IN ('ai_real', 'ai_manga')
        AND d.language IS NOT NULL AND d.language != ''
      GROUP BY d.language
      ORDER BY cnt DESC
    `, [dateFrom, dateTo]);
  }
  const db = getDb();
  return db.prepare(`
    SELECT d.language, COUNT(DISTINCT d.playlet_id) as cnt
    FROM drama d
    INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
    WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
      AND d.is_ai_drama IN ('ai_real', 'ai_manga')
      AND d.language IS NOT NULL AND d.language != ''
    GROUP BY d.language
    ORDER BY cnt DESC
  `).all(dateFrom, dateTo) as Array<{ language: string; cnt: number }>;
}

/**
 * 题材标签分布统计（按 AI 类型过滤）
 */
export async function queryTagsByAiType(opts: {
  dateFrom: string;
  dateTo: string;
  aiType: string;
}): Promise<Array<{ tags: string }>> {
  const { dateFrom, dateTo, aiType } = opts;

  if (isMysqlMode()) {
    const { reviewJoin, isAiCol } = getSqlParts();
    return mysqlQuery(`
      SELECT DISTINCT d.tags
      FROM drama d
      INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      ${reviewJoin}
      WHERE rs.date_key >= ? AND rs.date_key <= ?
        AND ${isAiCol} = ?
        AND d.tags IS NOT NULL AND d.tags != '[]'
    `, [dateFrom, dateTo, aiType]);
  }
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT d.tags
    FROM drama d
    INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
    WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
      AND d.is_ai_drama = ?
      AND d.tags IS NOT NULL AND d.tags != '[]'
  `).all(dateFrom, dateTo, aiType) as Array<{ tags: string }>;
}

/**
 * 热力增长 Top5（AI 剧，指定日期区间）
 */
export async function queryHeatGrowthTop5(opts: {
  dateFrom: string;
  dateTo: string;
}): Promise<Array<{ title: string; cur_heat: number; prev_heat: number; increment: number }>> {
  const { dateFrom, dateTo } = opts;
  const prevStart = getOffsetDate(dateFrom, -7);
  type Row = { title: string; cur_heat: number; prev_heat: number; increment: number };

  if (isMysqlMode()) {
    const { reviewJoin, isAiCol } = getSqlParts();
    return mysqlQuery<Row>(`
      SELECT d.title,
        COALESCE(cur.heat, 0) as cur_heat,
        COALESCE(prev.heat, 0) as prev_heat,
        COALESCE(cur.heat, 0) - COALESCE(prev.heat, 0) as increment
      FROM drama d
      INNER JOIN (
        SELECT playlet_id, MAX(heat_value) as heat
        FROM ranking_snapshot
        WHERE date_key >= ? AND date_key <= ?
        GROUP BY playlet_id
      ) cur ON d.playlet_id = cur.playlet_id
      LEFT JOIN (
        SELECT playlet_id, MAX(heat_value) as heat
        FROM ranking_snapshot
        WHERE date_key >= ? AND date_key < ?
        GROUP BY playlet_id
      ) prev ON d.playlet_id = prev.playlet_id
      ${reviewJoin}
      WHERE ${isAiCol} IN ('ai_real', 'ai_manga')
        AND COALESCE(prev.heat, 0) > 0
      ORDER BY increment DESC
      LIMIT 5
    `, [dateFrom, dateTo, prevStart, dateFrom]);
  }

  const db = getDb();
  return db.prepare(`
    SELECT d.title,
      COALESCE(cur.heat, 0) as cur_heat,
      COALESCE(prev.heat, 0) as prev_heat,
      COALESCE(cur.heat, 0) - COALESCE(prev.heat, 0) as increment
    FROM drama d
    INNER JOIN (
      SELECT playlet_id, MAX(heat_value) as heat
      FROM ranking_snapshot
      WHERE snapshot_date >= ? AND snapshot_date <= ?
      GROUP BY playlet_id
    ) cur ON d.playlet_id = cur.playlet_id
    LEFT JOIN (
      SELECT playlet_id, MAX(heat_value) as heat
      FROM ranking_snapshot
      WHERE snapshot_date >= ? AND snapshot_date < ?
      GROUP BY playlet_id
    ) prev ON d.playlet_id = prev.playlet_id
    WHERE d.is_ai_drama IN ('ai_real', 'ai_manga')
      AND COALESCE(prev.heat, 0) > 0
    ORDER BY increment DESC
    LIMIT 5
  `).all(dateFrom, dateTo, prevStart, dateFrom) as Row[];
}

function getOffsetDate(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
