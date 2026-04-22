import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';
import { getPendingReviewCounts } from '@/lib/review-count';
import { isMysqlMode, execute, query } from '@/lib/mysql';

// 属于 drama_review 表的人工审核字段，MySQL 模式下须分流，不能写入 drama 主表
const REVIEW_FIELDS = new Set(['is_ai_drama', 'genre_tags_manual', 'genre_tags_ai', 'genre_source', 'review_status', 'review_notes']);

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'manage_data');
  if (isErrorResponse(auth)) return auth;

  try {
    const body = await request.json();
    const { title, description, language, cover_url, first_air_date, tags, creative_count } = body;

    if (isMysqlMode()) {
      await execute(
        `UPDATE drama SET title=?, description=?, language=?, cover_url=?, first_air_date=?,
         tags=?, creative_count=?, updated_at=NOW()
         WHERE id=?`,
        [title, description ?? null, language ?? null, cover_url ?? null,
         first_air_date ?? null, JSON.stringify(tags || []), creative_count ?? 0, params.id]
      );
      // is_ai_drama 在 MySQL 模式下不属于 drama 表，PUT 不处理审核字段
      return NextResponse.json({ success: true });
    }

    // SQLite 模式（保留 is_ai_drama，兼容原有逻辑）
    const { is_ai_drama } = body;
    const db = getDb();
    db.prepare(
      `UPDATE drama SET title=?, description=?, language=?, cover_url=?, first_air_date=?, is_ai_drama=?, tags=?, creative_count=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(title, description || null, language || null, cover_url || null,
      first_air_date || null, is_ai_drama || null,
      JSON.stringify(tags || []), creative_count || 0, params.id);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'edit_drama');
  if (isErrorResponse(auth)) return auth;

  try {
    const body = await request.json();

    // ── MySQL 模式：按字段归属，分别写 drama / drama_review ─────────────────────
    if (isMysqlMode()) {
      const dramaFields: Record<string, unknown> = {};
      const reviewFields: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(body)) {
        if (REVIEW_FIELDS.has(key)) {
          reviewFields[key] = value;
        } else {
          dramaFields[key] = value;
        }
      }

      // 更新 drama 表（只包含抓取/基础字段）
      if (Object.keys(dramaFields).length > 0) {
        const sets: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(dramaFields)) {
          if (k === 'tags') {
            sets.push('tags = ?');
            values.push(JSON.stringify(v));
          } else {
            sets.push(`${k} = ?`);
            values.push(v);
          }
        }
        sets.push('updated_at = NOW()');
        values.push(params.id);
        await execute(`UPDATE drama SET ${sets.join(', ')} WHERE id = ?`, values);
      }

      // 更新 drama_review 表（人工审核字段）
      if (Object.keys(reviewFields).length > 0) {
        const [dramaRow] = await query<{ id: number; playlet_id: string }>(
          'SELECT id, playlet_id FROM drama WHERE id = ? LIMIT 1', [params.id]
        );
        if (!dramaRow) {
          return NextResponse.json({ error: `未找到 id=${params.id} 的剧集` }, { status: 404 });
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        let touchedReviewStatus = false;
        for (const [k, v] of Object.entries(reviewFields)) {
          if (k === 'genre_tags_manual' || k === 'genre_tags_ai') {
            sets.push(`${k} = ?`);
            values.push(v != null ? JSON.stringify(v) : null);
          } else {
            sets.push(`${k} = ?`);
            values.push(v);
          }
          if (k === 'review_status') touchedReviewStatus = true;
        }

        // 关键修复：根据本次 PATCH 的 is_ai_drama 自动推进 / 回退 review_status。
        // - is_ai_drama 非 null：视作"完成审核" → 'reviewed' + reviewed_at=NOW
        // - is_ai_drama 显式 null（撤销）：回退到 'pending' + 清 reviewed_at
        // 调用方若显式传了 review_status 则尊重调用方。
        if (!touchedReviewStatus && Object.prototype.hasOwnProperty.call(reviewFields, 'is_ai_drama')) {
          const aiVal = reviewFields['is_ai_drama'];
          if (aiVal === null) {
            sets.push("review_status = 'pending'");
            sets.push('reviewed_at = NULL');
          } else {
            sets.push("review_status = 'reviewed'");
            sets.push('reviewed_at = NOW()');
          }
        }

        sets.push('updated_at = NOW()');
        values.push(dramaRow.id);

        // Upsert drama_review（保证存在）
        await execute(
          `INSERT INTO drama_review (drama_id, review_status) VALUES (?, 'pending')
           ON DUPLICATE KEY UPDATE drama_id=drama_id`,
          [dramaRow.id]
        );
        await execute(
          `UPDATE drama_review SET ${sets.join(', ')} WHERE drama_id = ?`,
          values
        );
      }

      console.log(`[drama/mysql] PATCH id=${params.id} drama=${JSON.stringify(dramaFields)} review=${JSON.stringify(reviewFields)}`);
      const counts = await getPendingReviewCounts();
      return NextResponse.json({ success: true, changes: 1, counts });
    }

    // ── SQLite 模式（现有逻辑，保持不变）────────────────────────────────────────
    const db = getDb();
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

    const result = db.prepare(`UPDATE drama SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    console.log(`[drama] PATCH id=${params.id} body=${JSON.stringify(body)} changes=${result.changes}`);

    if (result.changes === 0) {
      return NextResponse.json({ error: `未找到 id=${params.id} 的剧集，未做任何修改` }, { status: 404 });
    }
    const counts = await getPendingReviewCounts();
    return NextResponse.json({ success: true, changes: result.changes, counts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'manage_data');
  if (isErrorResponse(auth)) return auth;

  try {
    if (isMysqlMode()) {
      // drama_review 有外键 ON DELETE CASCADE，删除 drama 会自动清理
      await execute('DELETE FROM drama WHERE id = ?', [params.id]);
      return NextResponse.json({ success: true });
    }

    const db = getDb();
    db.prepare('DELETE FROM drama WHERE id = ?').run(params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
