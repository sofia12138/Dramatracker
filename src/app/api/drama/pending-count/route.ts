import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL').get() as { count: number };
    return NextResponse.json({ count: result.count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
