import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { countCustomTagsFromRows } from '@/lib/tag-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT genre_tags_manual FROM drama WHERE genre_tags_manual IS NOT NULL AND genre_tags_manual != ''`
    ).all() as { genre_tags_manual: string | null }[];

    const candidates = countCustomTagsFromRows(rows);
    return NextResponse.json({ success: true, data: candidates });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
