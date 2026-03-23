import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = checkPermission(request, 'manage_play_count');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const playletId = searchParams.get('playlet_id');
    const platform = searchParams.get('platform');
    const recordWeek = searchParams.get('record_week');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    let whereClause = '1=1';
    const params: unknown[] = [];

    if (playletId) { whereClause += ' AND pc.playlet_id = ?'; params.push(playletId); }
    if (platform) { whereClause += ' AND pc.platform = ?'; params.push(platform); }
    if (recordWeek) { whereClause += ' AND pc.record_week = ?'; params.push(recordWeek); }

    const sql = `SELECT pc.*, d.title FROM drama_play_count pc LEFT JOIN drama d ON pc.playlet_id = d.playlet_id WHERE ${whereClause} ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`;
    const data = db.prepare(sql).all(...params, pageSize, (page - 1) * pageSize);
    const countSql = `SELECT COUNT(*) as total FROM drama_play_count pc WHERE ${whereClause.replace(/pc\./g, 'pc.')}`;
    const countResult = db.prepare(countSql).get(...params) as { total: number };

    return NextResponse.json({ data, total: countResult.total, page, pageSize });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_play_count');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const body = await request.json();
    const result = db.prepare(
      'INSERT INTO drama_play_count (playlet_id, platform, app_play_count, record_week, record_date, input_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(body.playlet_id, body.platform, body.app_play_count || 0, body.record_week, body.record_date, body.input_by || null, body.note || null);
    return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
