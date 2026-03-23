import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const dates = db.prepare('SELECT DISTINCT snapshot_date FROM ranking_snapshot ORDER BY snapshot_date DESC').all() as { snapshot_date: string }[];
    return NextResponse.json(dates.map((d) => d.snapshot_date));
  } catch {
    return NextResponse.json([]);
  }
}
