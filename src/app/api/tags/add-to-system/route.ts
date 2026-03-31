import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { TAG_CATEGORY_LIST } from '@/constants/tag-system';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { tag_name, category } = await request.json();

    if (!tag_name || typeof tag_name !== 'string' || !tag_name.trim()) {
      return NextResponse.json({ error: 'tag_name required' }, { status: 400 });
    }
    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'category required' }, { status: 400 });
    }
    if (!TAG_CATEGORY_LIST.includes(category as typeof TAG_CATEGORY_LIST[number])) {
      return NextResponse.json({ error: `无效分类: ${category}` }, { status: 400 });
    }

    const trimmed = tag_name.trim();

    const existing = db.prepare(
      'SELECT id FROM tag_system_extra WHERE category = ? AND tag_name = ?'
    ).get(category, trimmed);
    if (existing) {
      return NextResponse.json({ error: `标签"${trimmed}"已存在于分类"${category}"中` }, { status: 409 });
    }

    db.prepare(
      'INSERT INTO tag_system_extra (category, tag_name) VALUES (?, ?)'
    ).run(category, trimmed);

    console.log(`[tag-system-extra] added "${trimmed}" to "${category}"`);
    return NextResponse.json({ success: true, tag_name: trimmed, category });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { tag_name, category } = await request.json();

    if (!tag_name || !category) {
      return NextResponse.json({ error: 'tag_name and category required' }, { status: 400 });
    }

    const result = db.prepare(
      'DELETE FROM tag_system_extra WHERE category = ? AND tag_name = ?'
    ).run(category, tag_name);

    if (result.changes === 0) {
      return NextResponse.json({ error: '未找到该扩展标签' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
