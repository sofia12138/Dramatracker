import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const isAiDrama = searchParams.get('is_ai_drama');
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const offset = (page - 1) * pageSize;

    let whereClause = '1=1';
    const params: unknown[] = [];

    if (isAiDrama === 'null') {
      whereClause += ' AND is_ai_drama IS NULL';
    } else if (isAiDrama) {
      whereClause += ' AND is_ai_drama = ?';
      params.push(isAiDrama);
    }

    if (search) {
      whereClause += ' AND (title LIKE ? OR playlet_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const countResult = db.prepare(`SELECT COUNT(*) as total FROM drama WHERE ${whereClause}`).get(...params) as { total: number };
    const dramas = db.prepare(`SELECT * FROM drama WHERE ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);

    return NextResponse.json({
      data: dramas,
      total: countResult.total,
      page,
      pageSize,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_data');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const body = await request.json();
    const { playlet_id, title, description, language, cover_url, first_air_date, is_ai_drama, tags, creative_count } = body;

    const result = db.prepare(
      `INSERT INTO drama (playlet_id, title, description, language, cover_url, first_air_date, is_ai_drama, tags, creative_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(playlet_id, title, description || null, language || null, cover_url || null, first_air_date || null, is_ai_drama || null, JSON.stringify(tags || []), creative_count || 0);

    return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
