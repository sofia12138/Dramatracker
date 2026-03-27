import { getDb } from './db';

const PENDING_COUNT_SQL = 'SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL';

const PLATFORM_COUNTS_SQL = `
  SELECT rs.platform, COUNT(DISTINCT d.id) as count
  FROM ranking_snapshot rs
  INNER JOIN drama d ON rs.playlet_id = d.playlet_id
  WHERE d.is_ai_drama IS NULL
  GROUP BY rs.platform
  ORDER BY count DESC
`;

export function getPendingReviewTotal(): number {
  const db = getDb();
  return (db.prepare(PENDING_COUNT_SQL).get() as { count: number }).count;
}

export function getPendingReviewCounts() {
  const db = getDb();
  const total = (db.prepare(PENDING_COUNT_SQL).get() as { count: number }).count;
  const platformCounts = db.prepare(PLATFORM_COUNTS_SQL).all() as { platform: string; count: number }[];
  return { total, platformCounts };
}
