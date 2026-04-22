import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getAIClient, getAIModel } from '@/lib/ai';
import { getMergedTagSystem, getMergedAllTags } from '@/constants/tag-system';
import { PRESET_GENRE_TAGS } from '@/lib/tags';
import {
  normalizeSystemTags,
  normalizeCustomTags,
  validateSystemTags,
  isEmptyTags,
  getTagSourceCompat,
  parseManualTags,
} from '@/lib/tag-utils';
import { isMysqlMode, query, execute } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

function loadMergedSystem(db: ReturnType<typeof getDb>) {
  const extraRows = db.prepare('SELECT category, tag_name FROM tag_system_extra').all() as { category: string; tag_name: string }[];
  return getMergedTagSystem(extraRows);
}

async function loadMergedSystemMysql() {
  const extraRows = await query<{ category: string; tag_name: string }>(
    'SELECT category, tag_name FROM tag_system_extra'
  );
  return getMergedTagSystem(extraRows);
}

export async function GET() {
  try {
    if (isMysqlMode()) {
      const merged = await loadMergedSystemMysql();
      return NextResponse.json({ success: true, data: merged });
    }
    const db = getDb();
    const merged = loadMergedSystem(db);
    return NextResponse.json({ success: true, data: merged });
  } catch {
    const { TAG_SYSTEM } = await import('@/constants/tag-system');
    return NextResponse.json({ success: true, data: TAG_SYSTEM });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = checkPermission(request, 'edit_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const body = await request.json();

    const dramaId = body.drama_id ?? body.id;
    if (!dramaId) {
      return NextResponse.json({ error: 'drama_id required' }, { status: 400 });
    }

    const rawSystemTags = body.systemTags ?? {};
    const rawCustomTags = body.customTags ?? [];

    if (typeof rawSystemTags !== 'object' || Array.isArray(rawSystemTags)) {
      return NextResponse.json({ error: 'systemTags must be an object' }, { status: 400 });
    }
    if (!Array.isArray(rawCustomTags)) {
      return NextResponse.json({ error: 'customTags must be an array' }, { status: 400 });
    }

    // ── MySQL 模式：写 drama_review.genre_tags_manual / genre_source ────────────
    if (isMysqlMode()) {
      const merged = await loadMergedSystemMysql();
      const mergedAll = getMergedAllTags(merged);

      const systemTags = normalizeSystemTags(rawSystemTags, merged);
      const customTags = normalizeCustomTags(rawCustomTags, mergedAll);

      const { valid, errors } = validateSystemTags(systemTags, merged);
      if (!valid) {
        return NextResponse.json({ error: '标签校验失败', details: errors }, { status: 400 });
      }

      const data = { systemTags, customTags };
      const empty = isEmptyTags(data);
      const tagsJson = empty ? null : JSON.stringify(data);

      // 先确认 drama 存在 + 取出 ai/tags 用于推断 source（清空时回退到 ai/抓取标签）
      const dramaRows = await query<{ id: number; tags: unknown }>(
        'SELECT id, tags FROM drama WHERE id = ? LIMIT 1', [dramaId]
      );
      if (!dramaRows[0]) {
        return NextResponse.json({ error: `未找到 id=${dramaId} 的剧集` }, { status: 404 });
      }
      const reviewRows = await query<{ genre_tags_ai: unknown }>(
        'SELECT genre_tags_ai FROM drama_review WHERE drama_id = ? LIMIT 1', [dramaId]
      );

      let source: string | null;
      if (!empty) {
        source = 'manual';
      } else {
        // mysql2 自动 parse JSON 列，统一转字符串再交给 getTagSourceCompat
        const aiStr = reviewRows[0]?.genre_tags_ai == null
          ? null
          : (typeof reviewRows[0].genre_tags_ai === 'string'
              ? reviewRows[0].genre_tags_ai
              : JSON.stringify(reviewRows[0].genre_tags_ai));
        const tagsStr = dramaRows[0].tags == null
          ? null
          : (typeof dramaRows[0].tags === 'string'
              ? dramaRows[0].tags
              : JSON.stringify(dramaRows[0].tags));
        source = getTagSourceCompat(null, aiStr, tagsStr);
        if (source === 'none') source = null;
      }

      // Upsert drama_review，仅更新本接口负责的两个字段
      await execute(
        `INSERT INTO drama_review (drama_id, review_status, genre_tags_manual, genre_source)
         VALUES (?, 'pending', ?, ?)
         ON DUPLICATE KEY UPDATE
           genre_tags_manual = VALUES(genre_tags_manual),
           genre_source      = VALUES(genre_source),
           updated_at        = NOW()`,
        [dramaId, tagsJson, source]
      );

      console.log(`[genre/mysql] save manual drama_id=${dramaId} tags=${tagsJson}`);

      // 候选标签统计：从 drama_review.genre_tags_manual 聚合
      let candidateTags: { tag_name: string; usage_count: number; isNewCandidate: boolean }[] = [];
      if (customTags.length > 0) {
        try {
          const allRows = await query<{ genre_tags_manual: unknown }>(
            `SELECT genre_tags_manual FROM drama_review
             WHERE genre_tags_manual IS NOT NULL`
          );
          const counts = new Map<string, number>();
          for (const row of allRows) {
            const raw = row.genre_tags_manual;
            const str = raw == null ? null : (typeof raw === 'string' ? raw : JSON.stringify(raw));
            if (!str) continue;
            const parsed = parseManualTags(str);
            for (const ct of parsed.customTags) {
              counts.set(ct, (counts.get(ct) || 0) + 1);
            }
          }
          candidateTags = customTags
            .filter(t => (counts.get(t) || 0) >= 1)
            .map(t => ({
              tag_name: t,
              usage_count: counts.get(t) || 0,
              isNewCandidate: (counts.get(t) || 0) >= 3,
            }));
        } catch { /* non-critical */ }
      }

      return NextResponse.json({ success: true, data, changes: 1, candidateTags });
    }

    // ── SQLite 兜底（保留原有逻辑）────────────────────────────────────────────
    const db = getDb();
    const merged = loadMergedSystem(db);
    const mergedAll = getMergedAllTags(merged);

    const systemTags = normalizeSystemTags(rawSystemTags, merged);
    const customTags = normalizeCustomTags(rawCustomTags, mergedAll);

    const { valid, errors } = validateSystemTags(systemTags, merged);
    if (!valid) {
      return NextResponse.json({ error: '标签校验失败', details: errors }, { status: 400 });
    }

    const data = { systemTags, customTags };
    const empty = isEmptyTags(data);
    const tagsJson = empty ? null : JSON.stringify(data);

    let source: string | null;
    if (!empty) {
      source = 'manual';
    } else {
      const row = db.prepare('SELECT genre_tags_ai, tags FROM drama WHERE id = ?').get(dramaId) as
        { genre_tags_ai: string | null; tags: string | null } | undefined;
      source = row ? getTagSourceCompat(null, row.genre_tags_ai, row.tags) : null;
      if (source === 'none') source = null;
    }

    const result = db.prepare(
      `UPDATE drama SET genre_tags_manual = ?, genre_source = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(tagsJson, source, dramaId);

    console.log(`[genre] save manual tags drama_id=${dramaId} tags=${tagsJson} changes=${result.changes}`);

    if (result.changes === 0) {
      return NextResponse.json({ error: `未找到 id=${dramaId} 的剧集` }, { status: 404 });
    }

    let candidateTags: { tag_name: string; usage_count: number; isNewCandidate: boolean }[] = [];
    if (customTags.length > 0) {
      try {
        const allRows = db.prepare(
          `SELECT genre_tags_manual FROM drama WHERE genre_tags_manual IS NOT NULL AND genre_tags_manual != ''`
        ).all() as { genre_tags_manual: string }[];
        const counts = new Map<string, number>();
        for (const row of allRows) {
          const parsed = parseManualTags(row.genre_tags_manual);
          for (const ct of parsed.customTags) {
            counts.set(ct, (counts.get(ct) || 0) + 1);
          }
        }
        candidateTags = customTags
          .filter(t => (counts.get(t) || 0) >= 1)
          .map(t => ({
            tag_name: t,
            usage_count: counts.get(t) || 0,
            isNewCandidate: (counts.get(t) || 0) >= 3,
          }));
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ success: true, data, changes: result.changes, candidateTags });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const { drama_ids } = await request.json() as { drama_ids?: number[] };

    type Row = { id: number; title: string; description: string };

    let rows: Row[];

    if (isMysqlMode()) {
      // MySQL：drama 主表无 genre_*，候选必须 LEFT JOIN drama_review 后再过滤
      if (drama_ids?.length) {
        const placeholders = drama_ids.map(() => '?').join(',');
        rows = await query<Row>(
          `SELECT d.id, d.title, COALESCE(d.description, '') AS description
           FROM drama d
           LEFT JOIN drama_review dr ON dr.drama_id = d.id
           WHERE d.id IN (${placeholders})
             AND (dr.genre_tags_manual IS NULL)
             AND (dr.genre_tags_ai IS NULL)`,
          drama_ids
        );
      } else {
        rows = await query<Row>(
          `SELECT d.id, d.title, COALESCE(d.description, '') AS description
           FROM drama d
           LEFT JOIN drama_review dr ON dr.drama_id = d.id
           WHERE (dr.genre_tags_manual IS NULL)
             AND (dr.genre_tags_ai IS NULL)
             AND (d.tags IS NULL OR JSON_LENGTH(d.tags) = 0)
           LIMIT 20`
        );
      }
    } else {
      const db = getDb();
      rows = (drama_ids?.length
        ? db.prepare(
            `SELECT id, title, description, tags, genre_tags_ai, genre_tags_manual
             FROM drama WHERE id IN (${drama_ids.map(() => '?').join(',')})
             AND genre_tags_manual IS NULL AND genre_tags_ai IS NULL`
          ).all(...drama_ids)
        : db.prepare(
            `SELECT id, title, description, tags, genre_tags_ai, genre_tags_manual
             FROM drama
             WHERE genre_tags_manual IS NULL
               AND (genre_tags_ai IS NULL OR genre_tags_ai = '[]' OR genre_tags_ai = '')
               AND (tags IS NULL OR tags = '[]' OR tags = '')
             LIMIT 20`
          ).all()
      ) as Row[];
    }

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

可选标签：${PRESET_GENRE_TAGS.join('、')}

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
    if (!jsonMatch) {
      return NextResponse.json({ success: true, processed: 0, total: rows.length });
    }
    const results = JSON.parse(jsonMatch[0]) as { id: number; tags: string[] }[];

    if (isMysqlMode()) {
      for (const item of results) {
        const validTags = item.tags.filter(t => PRESET_GENRE_TAGS.includes(t));
        if (validTags.length === 0) continue;
        // 写 drama_review，保持已有 review_status / 其他字段
        await execute(
          `INSERT INTO drama_review (drama_id, review_status, genre_tags_ai, genre_source)
           VALUES (?, 'pending', ?, 'ai')
           ON DUPLICATE KEY UPDATE
             genre_tags_ai = VALUES(genre_tags_ai),
             genre_source  = COALESCE(genre_source, 'ai'),
             updated_at    = NOW()`,
          [item.id, JSON.stringify(validTags)]
        );
        processed++;
      }
    } else {
      const db = getDb();
      const updateStmt = db.prepare(
        `UPDATE drama SET genre_tags_ai = ?, genre_source = 'ai', updated_at = datetime('now') WHERE id = ?`
      );
      const tx = db.transaction((items: { id: number; tags: string[] }[]) => {
        for (const item of items) {
          const validTags = item.tags.filter(t => PRESET_GENRE_TAGS.includes(t));
          if (validTags.length > 0) {
            updateStmt.run(JSON.stringify(validTags), item.id);
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
