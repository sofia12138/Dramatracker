import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const totalDramas = (db.prepare('SELECT COUNT(*) as count FROM drama').get() as { count: number }).count;
    const totalPlatforms = (db.prepare('SELECT COUNT(*) as count FROM platforms WHERE is_active = 1').get() as { count: number }).count;
    const pendingReview = (db.prepare('SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL').get() as { count: number }).count;
    const aiRealCount = (db.prepare("SELECT COUNT(*) as count FROM drama WHERE is_ai_drama = 'ai_real'").get() as { count: number }).count;
    const aiMangaCount = (db.prepare("SELECT COUNT(*) as count FROM drama WHERE is_ai_drama = 'ai_manga'").get() as { count: number }).count;
    const realCount = (db.prepare("SELECT COUNT(*) as count FROM drama WHERE is_ai_drama = 'real'").get() as { count: number }).count;
    const latestSnapshot = db.prepare('SELECT snapshot_date FROM ranking_snapshot ORDER BY snapshot_date DESC LIMIT 1').get() as
      | { snapshot_date: string }
      | undefined;
    const todaySnapshots = latestSnapshot
      ? (db.prepare('SELECT COUNT(*) as count FROM ranking_snapshot WHERE snapshot_date = ?').get(latestSnapshot.snapshot_date) as { count: number }).count
      : 0;

    return NextResponse.json({
      totalDramas,
      totalPlatforms,
      pendingReview,
      aiRealCount,
      aiMangaCount,
      realCount,
      todaySnapshots,
      latestSnapshotDate: latestSnapshot?.snapshot_date ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
