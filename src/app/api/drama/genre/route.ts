import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getAIClient, getAIModel } from '@/lib/ai';

export const dynamic = 'force-dynamic';

const GENRE_TAGS = ['情感', '狼人', '复仇', '豪门', '穿越', '逆袭', '悬疑', '家庭', '甜宠', '都市'];

export async function PATCH(request: NextRequest) {
  const auth = checkPermission(request, 'review_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { drama_id, genre_tags_manual } = await request.json();

    if (!drama_id || !Array.isArray(genre_tags_manual)) {
      return NextResponse.json({ error: 'drama_id and genre_tags_manual[] required' }, { status: 400 });
    }

    const valid = genre_tags_manual.filter((t: string) => GENRE_TAGS.includes(t));
    const result = db.prepare(
      `UPDATE drama SET genre_tags_manual = ?, genre_source = 'manual', updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(valid), drama_id);

    console.log(`[genre] save manual tags drama_id=${drama_id} tags=${JSON.stringify(valid)} changes=${result.changes}`);

    if (result.changes === 0) {
      return NextResponse.json({ error: `未找到 id=${drama_id} 的剧集` }, { status: 404 });
    }
    return NextResponse.json({ success: true, tags: valid, changes: result.changes });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const { drama_ids } = await request.json() as { drama_ids?: number[] };

    const rows = drama_ids?.length
      ? db.prepare(
          `SELECT id, title, description, tags, genre_tags_ai, genre_tags_manual
           FROM drama WHERE id IN (${drama_ids.map(() => '?').join(',')})
           AND genre_tags_manual IS NULL AND genre_tags_ai IS NULL`
        ).all(...drama_ids) as { id: number; title: string; description: string; tags: string; genre_tags_ai: string | null; genre_tags_manual: string | null }[]
      : db.prepare(
          `SELECT id, title, description, tags, genre_tags_ai, genre_tags_manual
           FROM drama
           WHERE genre_tags_manual IS NULL
             AND (genre_tags_ai IS NULL OR genre_tags_ai = '[]' OR genre_tags_ai = '')
             AND (tags IS NULL OR tags = '[]' OR tags = '')
           LIMIT 20`
        ).all() as { id: number; title: string; description: string; tags: string; genre_tags_ai: string | null; genre_tags_manual: string | null }[];

    if (rows.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: '无需识别' });
    }

    const client = getAIClient();
    const model = getAIModel();
    let processed = 0;

    const dramas = rows.map(r => ({
      id: r.id,
      title: r.title,
      description: (r.description || '').slice(0, 200),
    }));

    const prompt = `你是海外短剧题材分析专家。请为以下短剧识别题材标签。

可选标签：${GENRE_TAGS.join('、')}

每部剧选1-3个最匹配的标签。严格输出JSON数组，格式：
[{"id":1,"tags":["情感","复仇"]},...]

短剧列表：
${dramas.map(d => `- id:${d.id} 标题:${d.title} 简介:${d.description || '无'}`).join('\n')}

只输出JSON，不要其他文字。`;

    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const text = res.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const results = JSON.parse(jsonMatch[0]) as { id: number; tags: string[] }[];
      const updateStmt = db.prepare(
        `UPDATE drama SET genre_tags_ai = ?, genre_source = 'ai', updated_at = datetime('now') WHERE id = ?`
      );
      const tx = db.transaction((items: { id: number; tags: string[] }[]) => {
        for (const item of items) {
          const valid = item.tags.filter(t => GENRE_TAGS.includes(t));
          if (valid.length > 0) {
            updateStmt.run(JSON.stringify(valid), item.id);
            processed++;
          }
        }
      });
      tx(results);
    }

    return NextResponse.json({ success: true, processed, total: rows.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ tags: GENRE_TAGS });
}
