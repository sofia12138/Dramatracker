import { getDb } from './db';
import { isMysqlMode, query } from './mysql';

const SQLITE_PENDING_COUNT_SQL = 'SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL';
const SQLITE_PLATFORM_COUNTS_SQL = `
  SELECT rs.platform, COUNT(DISTINCT d.id) as count
  FROM ranking_snapshot rs
  INNER JOIN drama d ON rs.playlet_id = d.playlet_id
  WHERE d.is_ai_drama IS NULL
  GROUP BY rs.platform
  ORDER BY count DESC
`;

const MYSQL_PENDING_COUNT_SQL = `
  SELECT COUNT(*) as count
  FROM drama d
  LEFT JOIN drama_review dr ON d.id = dr.drama_id
  WHERE dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL
`;
const MYSQL_PLATFORM_COUNTS_SQL = `
  SELECT rs.platform, COUNT(DISTINCT d.id) as count
  FROM ranking_snapshot rs
  INNER JOIN drama d ON rs.drama_id = d.id
  LEFT JOIN drama_review dr ON d.id = dr.drama_id
  WHERE dr.id IS NULL OR dr.review_status = 'pending' OR dr.is_ai_drama IS NULL
  GROUP BY rs.platform
  ORDER BY count DESC
`;

export async function getPendingReviewTotal(): Promise<number> {
  if (isMysqlMode()) {
    const rows = await query<{ count: number }>(MYSQL_PENDING_COUNT_SQL);
    return Number(rows[0]?.count ?? 0);
  }
  const db = getDb();
  return (db.prepare(SQLITE_PENDING_COUNT_SQL).get() as { count: number }).count;
}

export async function getPendingReviewCounts(): Promise<{
  total: number;
  platformCounts: { platform: string; count: number }[];
}> {
  if (isMysqlMode()) {
    const totalRows = await query<{ count: number }>(MYSQL_PENDING_COUNT_SQL);
    const platformRows = await query<{ platform: string; count: number }>(MYSQL_PLATFORM_COUNTS_SQL);
    return {
      total: Number(totalRows[0]?.count ?? 0),
      platformCounts: platformRows.map(r => ({ platform: r.platform, count: Number(r.count) })),
    };
  }
  const db = getDb();
  const total = (db.prepare(SQLITE_PENDING_COUNT_SQL).get() as { count: number }).count;
  const platformCounts = db.prepare(SQLITE_PLATFORM_COUNTS_SQL).all() as {
    platform: string;
    count: number;
  }[];
  return { total, platformCounts };
}
