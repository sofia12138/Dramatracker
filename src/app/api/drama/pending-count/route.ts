import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL').get() as { count: number }).count;

    // Per-platform counts: dramas that appear on each platform's ranking
    const platformCounts = db.prepare(`
      SELECT rs.platform, COUNT(DISTINCT rs.playlet_id) as count
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      WHERE d.is_ai_drama IS NULL
      GROUP BY rs.platform
      ORDER BY count DESC
    `).all() as { platform: string; count: number }[];

    return NextResponse.json({ count: total, platformCounts });
  } catch {
    return NextResponse.json({ count: 0, platformCounts: [] });
  }
}
