import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const totalDramas = (db.prepare('SELECT COUNT(*) as c FROM drama').get() as { c: number }).c;
    const totalSnapshots = (db.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get() as { c: number }).c;
    const pendingReview = (db.prepare('SELECT COUNT(*) as c FROM drama WHERE is_ai_drama IS NULL').get() as { c: number }).c;
    const aiRealCount = (db.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama = 'ai_real'").get() as { c: number }).c;
    const aiMangaCount = (db.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama = 'ai_manga'").get() as { c: number }).c;
    const realCount = (db.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama = 'real'").get() as { c: number }).c;
    const totalInvestTrend = (db.prepare('SELECT COUNT(*) as c FROM invest_trend').get() as { c: number }).c;
    const totalPlayCount = (db.prepare('SELECT COUNT(*) as c FROM drama_play_count').get() as { c: number }).c;

    return NextResponse.json({
      totalDramas, totalSnapshots, pendingReview,
      aiRealCount, aiMangaCount, realCount,
      totalInvestTrend, totalPlayCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const db = getDb();
    db.exec('DELETE FROM ranking_snapshot');
    db.exec('DELETE FROM invest_trend');
    db.exec('DELETE FROM drama_play_count');
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
