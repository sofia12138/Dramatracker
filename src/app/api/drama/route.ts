import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { listDramas } from '@/lib/repositories/dramaRepository';
import { isMysqlMode, execute, query } from '@/lib/mysql';

// 与 sync/dramas 路径保持一致的标题归一化与 dedupe_key 计算规则
function normalizeTitle(raw: string): string {
  return (raw || '')
    .replace(/\[Updating\]/gi, '')
    .replace(/\(Updating\)/gi, '')
    .replace(/【更新中】/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeDateStr(raw?: string | null): string | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function dedupeKey(title: string, language?: string | null, firstAirDate?: string | null): string {
  return `${normalizeTitle(title)}|${(language || '').toLowerCase()}|${normalizeDateStr(firstAirDate) || ''}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isAiDrama = searchParams.get('is_ai_drama') ?? undefined;
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (isMysqlMode()) {
      const { data, total } = await listDramas({ isAiDrama, search, page, pageSize });
      return NextResponse.json({ data, total, page, pageSize });
    }

    const db = getDb();
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

    return NextResponse.json({ data: dramas, total: countResult.total, page, pageSize });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_data');
  if (isErrorResponse(auth)) return auth;

  try {
    const body = await request.json();
    const { playlet_id, title, description, language, cover_url, first_air_date, is_ai_drama, tags, creative_count } = body;

    if (!playlet_id || !title) {
      return NextResponse.json({ error: 'playlet_id and title are required' }, { status: 400 });
    }

    if (isMysqlMode()) {
      // MySQL drama 表无 is_ai_drama，且 dedupe_key/normalized_title NOT NULL
      const dk = dedupeKey(title, language, first_air_date);
      const normalized = normalizeTitle(title);
      const fad = normalizeDateStr(first_air_date);
      const today = new Date().toISOString().slice(0, 10);

      // 先看是否已存在同 playlet_id（避免唯一键冲突），存在则直接返回 id
      const existing = await query<{ id: number }>(
        'SELECT id FROM drama WHERE playlet_id = ? LIMIT 1', [playlet_id]
      );
      let id: number;
      if (existing[0]) {
        id = existing[0].id;
      } else {
        const result = await execute(
          `INSERT INTO drama
             (playlet_id, dedupe_key, title, normalized_title, description, language,
              cover_url, first_air_date, tags, creative_count, first_seen_at, last_seen_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            playlet_id, dk, title, normalized, description ?? null, language ?? null,
            cover_url ?? null, fad, JSON.stringify(tags || []), creative_count ?? 0,
            fad || today, today,
          ]
        ) as unknown as { insertId: number };
        id = result.insertId;
      }

      // is_ai_drama 在 MySQL 模式下属于 drama_review，按需 upsert
      if (is_ai_drama) {
        await execute(
          `INSERT INTO drama_review (drama_id, is_ai_drama, review_status)
           VALUES (?, ?, 'reviewed')
           ON DUPLICATE KEY UPDATE
             is_ai_drama = VALUES(is_ai_drama),
             review_status = 'reviewed',
             updated_at = NOW()`,
          [id, is_ai_drama]
        );
      }

      return NextResponse.json({ id }, { status: 201 });
    }

    const db = getDb();
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
