import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isMysqlMode, query } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (isMysqlMode()) {
      const rows = await query<{ d: string }>(
        "SELECT DISTINCT DATE_FORMAT(date_key, '%Y-%m-%d') AS d FROM ranking_snapshot ORDER BY d DESC"
      );
      return NextResponse.json(rows.map((r) => r.d));
    }

    const db = getDb();
    const dates = db.prepare('SELECT DISTINCT snapshot_date FROM ranking_snapshot ORDER BY snapshot_date DESC').all() as { snapshot_date: string }[];
    return NextResponse.json(dates.map((d) => d.snapshot_date));
  } catch {
    return NextResponse.json([]);
  }
}
