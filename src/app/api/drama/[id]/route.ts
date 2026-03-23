import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'manage_data');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const body = await request.json();
    const { title, description, language, cover_url, first_air_date, is_ai_drama, tags, creative_count } = body;

    db.prepare(
      `UPDATE drama SET title=?, description=?, language=?, cover_url=?, first_air_date=?, is_ai_drama=?, tags=?, creative_count=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(title, description || null, language || null, cover_url || null, first_air_date || null, is_ai_drama || null, JSON.stringify(tags || []), creative_count || 0, params.id);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'review_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const body = await request.json();
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (key === 'tags') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    fields.push("updated_at = datetime('now')");
    values.push(params.id);

    db.prepare(`UPDATE drama SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'manage_data');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    db.prepare('DELETE FROM drama WHERE id = ?').run(params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
