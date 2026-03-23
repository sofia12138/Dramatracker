import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const playletId = searchParams.get('playlet_id');

    if (!playletId) {
      return NextResponse.json({ error: 'playlet_id required' }, { status: 400 });
    }

    const drama = db.prepare('SELECT * FROM drama WHERE playlet_id = ?').get(playletId);

    const rankings = db.prepare(`
      SELECT platform, rank, heat_value, material_count, invest_days, snapshot_date
      FROM ranking_snapshot
      WHERE playlet_id = ?
      ORDER BY snapshot_date DESC, platform ASC
      LIMIT 200
    `).all(playletId);

    const investTrend = db.prepare(`
      SELECT platform, date, daily_invest_count
      FROM invest_trend
      WHERE playlet_id = ?
      ORDER BY date ASC
    `).all(playletId);

    // Heat trend: last 30 days per platform
    const heatTrend = db.prepare(`
      SELECT platform, snapshot_date as date, heat_value
      FROM ranking_snapshot
      WHERE playlet_id = ?
        AND snapshot_date >= date('now', '-30 days')
      ORDER BY snapshot_date ASC
    `).all(playletId);

    // Latest rank per platform
    const latestRanks = db.prepare(`
      SELECT rs.platform, rs.rank, rs.heat_value, rs.snapshot_date
      FROM ranking_snapshot rs
      WHERE rs.playlet_id = ?
        AND rs.snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE playlet_id = rs.playlet_id AND platform = rs.platform)
      ORDER BY rs.rank ASC
    `).all(playletId);

    return NextResponse.json({
      drama,
      rankings,
      investTrend,
      heatTrend,
      latestRanks,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
