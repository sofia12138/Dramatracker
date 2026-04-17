/**
 * POST /api/sync/dramas
 *
 * 本地抓取脚本将剧目基础数据推送到此接口。
 * 写入规则：基于 dedupe_key 做 upsert，只更新抓取字段，绝不触碰 drama_review。
 *
 * 请求体（JSON）：
 * {
 *   source: string,                  // 来源标识，如 "local-scraper"
 *   dramas: DramaSyncItem[]
 * }
 *
 * DramaSyncItem：
 * {
 *   playlet_id: string,
 *   title: string,
 *   language?: string,
 *   description?: string,
 *   cover_url?: string,
 *   first_air_date?: string,         // YYYY-MM-DD
 *   tags?: string[],
 *   creative_count?: number,
 *   first_seen_at?: string,          // YYYY-MM-DD
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkSyncAuth } from '@/lib/sync-auth';
import { isMysqlMode, getMysqlPool, withTransaction } from '@/lib/mysql';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DramaSyncItem {
  playlet_id: string;
  title: string;
  language?: string;
  description?: string;
  cover_url?: string;
  first_air_date?: string;
  tags?: string[];
  creative_count?: number;
  first_seen_at?: string;
}

function normalizeTitle(raw: string): string {
  return (raw || '')
    .replace(/\[Updating\]/gi, '')
    .replace(/\(Updating\)/gi, '')
    .replace(/【更新中】/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDateStr(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function dedupeKey(title: string, language?: string, firstAirDate?: string): string {
  return `${normalizeTitle(title)}|${(language || '').toLowerCase()}|${normalizeDateStr(firstAirDate) || ''}`;
}

async function writeSyncLog(
  pool: ReturnType<typeof getMysqlPool>,
  logId: number,
  status: string,
  counts: { inserted: number; updated: number; skipped: number; failed: number },
  errorMessage?: string
) {
  try {
    await pool.execute(
      `UPDATE sync_log SET status=?, finished_at=NOW(),
         inserted_count=?, updated_count=?, skipped_count=?,
         error_message=?, payload_summary=?
       WHERE id=?`,
      [
        status, counts.inserted, counts.updated, counts.skipped,
        errorMessage ?? null,
        JSON.stringify({ failed: counts.failed }),
        logId,
      ]
    );
  } catch { /* 日志写失败不影响主流程 */ }
}

export async function POST(request: NextRequest) {
  const authErr = checkSyncAuth(request);
  if (authErr) return authErr;

  let body: { source?: string; dramas?: DramaSyncItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体 JSON 解析失败' }, { status: 400 });
  }

  const { source = 'unknown', dramas } = body;
  if (!Array.isArray(dramas) || dramas.length === 0) {
    return NextResponse.json({ error: 'dramas 数组不能为空' }, { status: 400 });
  }

  // 校验必填字段
  for (const d of dramas) {
    if (!d.playlet_id || !d.title) {
      return NextResponse.json({ error: 'dramas 每条必须包含 playlet_id 和 title' }, { status: 400 });
    }
  }

  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

  // ── MySQL 模式 ──────────────────────────────────────────────────────────────
  if (isMysqlMode()) {
    const pool = getMysqlPool();
    let logId: number;

    try {
      const [logResult] = await pool.execute(
        `INSERT INTO sync_log (sync_type, source, started_at, status) VALUES ('dramas', ?, NOW(), 'running')`,
        [source]
      ) as unknown as [{ insertId: number }];
      logId = logResult.insertId;
    } catch {
      logId = 0;
    }

    try {
      await withTransaction(async (conn) => {
        for (const d of dramas) {
          try {
            const dk = dedupeKey(d.title, d.language, d.first_air_date);
            const normalized = normalizeTitle(d.title);
            const firstAirDate = normalizeDateStr(d.first_air_date);
            const firstSeenAt = normalizeDateStr(d.first_seen_at) || firstAirDate;
            const tags = JSON.stringify(d.tags || []);
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

            const [existing] = await conn.execute(
              'SELECT id FROM drama WHERE playlet_id = ? LIMIT 1', [d.playlet_id]
            ) as unknown as [{ id: number }[]];

            if (existing.length > 0) {
              // 已存在 -> 只更新抓取字段，不碰 drama_review
              await conn.execute(
                `UPDATE drama SET
                   title=?, normalized_title=?, description=?, language=?,
                   cover_url=?, first_air_date=?, tags=?, creative_count=?,
                   last_seen_at=?, updated_at=?
                 WHERE playlet_id=?`,
                [
                  d.title, normalized, d.description ?? null, d.language ?? null,
                  d.cover_url ?? null, firstAirDate, tags, d.creative_count ?? 0,
                  now.slice(0, 10), now, d.playlet_id,
                ]
              );
              counts.updated++;
            } else {
              // 新剧 -> 插入 drama，自动创建待审核的 drama_review
              const [insertResult] = await conn.execute(
                `INSERT INTO drama
                   (playlet_id, dedupe_key, title, normalized_title, description, language,
                    cover_url, first_air_date, tags, creative_count, first_seen_at, last_seen_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                  d.playlet_id, dk, d.title, normalized, d.description ?? null,
                  d.language ?? null, d.cover_url ?? null, firstAirDate, tags,
                  d.creative_count ?? 0, firstSeenAt, now.slice(0, 10),
                ]
              ) as unknown as [{ insertId: number }];

              // 自动创建 drama_review（review_status=pending，is_ai_drama=NULL）
              await conn.execute(
                `INSERT IGNORE INTO drama_review (drama_id, review_status) VALUES (?, 'pending')`,
                [insertResult.insertId]
              );
              counts.inserted++;
            }
          } catch (err) {
            console.error(`[sync/dramas] 写入失败 playlet_id=${d.playlet_id}:`, err);
            counts.failed++;
          }
        }
      });

      if (logId) await writeSyncLog(pool, logId, 'success', counts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (logId) await writeSyncLog(pool, logId, 'failed', counts, msg);
      return NextResponse.json({ error: `同步失败: ${msg}` }, { status: 500 });
    }

    console.log(`[sync/dramas] source=${source} inserted=${counts.inserted} updated=${counts.updated} failed=${counts.failed}`);
    return NextResponse.json({ success: true, ...counts, total: dramas.length });
  }

  // ── SQLite 兜底模式 ─────────────────────────────────────────────────────────
  try {
    const db = getDb();
    const upsert = db.transaction((items: DramaSyncItem[]) => {
      for (const d of items) {
        try {
          const existing = db.prepare('SELECT id FROM drama WHERE playlet_id = ?').get(d.playlet_id);
          const tags = JSON.stringify(d.tags || []);

          if (existing) {
            db.prepare(
              `UPDATE drama SET title=?, description=?, language=?, cover_url=?,
               first_air_date=?, tags=?, creative_count=?, updated_at=datetime('now')
               WHERE playlet_id=?`
            ).run(
              d.title, d.description ?? null, d.language ?? null, d.cover_url ?? null,
              normalizeDateStr(d.first_air_date), tags, d.creative_count ?? 0, d.playlet_id
            );
            counts.updated++;
          } else {
            db.prepare(
              `INSERT INTO drama (playlet_id, title, description, language, cover_url,
               first_air_date, tags, creative_count)
               VALUES (?,?,?,?,?,?,?,?)`
            ).run(
              d.playlet_id, d.title, d.description ?? null, d.language ?? null,
              d.cover_url ?? null, normalizeDateStr(d.first_air_date), tags, d.creative_count ?? 0
            );
            counts.inserted++;
          }
        } catch {
          counts.failed++;
        }
      }
    });
    upsert(dramas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `同步失败: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...counts, total: dramas.length });
}
