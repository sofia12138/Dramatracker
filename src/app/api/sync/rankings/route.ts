/**
 * POST /api/sync/rankings
 *
 * 推送榜单快照数据。
 * 写入规则：(drama_id, platform, ranking_type, date_key) UNIQUE -> 重复则覆盖数值字段。
 *
 * 请求体（JSON）：
 * {
 *   source: string,
 *   date_key: string,              // YYYY-MM-DD，所有快照的日期
 *   platform: string,
 *   ranking_type?: string,         // 默认 "heat"
 *   rankings: RankingSyncItem[]
 * }
 *
 * RankingSyncItem：
 * {
 *   playlet_id: string,
 *   rank_position: number,
 *   heat_value?: number,
 *   heat_increment?: number,
 *   material_count?: number,
 *   invest_days?: number,
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkSyncAuth } from '@/lib/sync-auth';
import { isMysqlMode, getMysqlPool, withTransaction } from '@/lib/mysql';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RankingSyncItem {
  playlet_id: string;
  rank_position: number;
  heat_value?: number;
  heat_increment?: number;
  material_count?: number;
  invest_days?: number;
}

function normalizeDateStr(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

export async function POST(request: NextRequest) {
  const authErr = checkSyncAuth(request);
  if (authErr) return authErr;

  let body: {
    source?: string;
    date_key?: string;
    platform?: string;
    ranking_type?: string;
    rankings?: RankingSyncItem[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体 JSON 解析失败' }, { status: 400 });
  }

  const { source = 'unknown', date_key, platform, ranking_type = 'heat', rankings } = body;

  if (!date_key || !platform) {
    return NextResponse.json({ error: 'date_key 和 platform 为必填项' }, { status: 400 });
  }
  const normalizedDateKey = normalizeDateStr(date_key);
  if (!normalizedDateKey) {
    return NextResponse.json({ error: 'date_key 格式错误，应为 YYYY-MM-DD' }, { status: 400 });
  }
  if (!Array.isArray(rankings) || rankings.length === 0) {
    return NextResponse.json({ error: 'rankings 数组不能为空' }, { status: 400 });
  }
  for (const r of rankings) {
    if (!r.playlet_id || r.rank_position == null) {
      return NextResponse.json({ error: 'rankings 每条必须包含 playlet_id 和 rank_position' }, { status: 400 });
    }
  }

  // inserted = 新增快照；updated = 已有相同 (drama_id,platform,ranking_type,date_key) 被覆盖；
  // skipped  = 在 drama 表中找不到对应 playlet_id（数据不存在，需先同步剧目）；
  // failed   = 数据库写入异常
  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  const skipReasons: string[] = [];      // 记录 skip 原因样本（最多 5 条）
  const failReasons: string[] = [];      // 记录 fail 原因样本（最多 5 条）

  // ── MySQL 模式 ──────────────────────────────────────────────────────────────
  if (isMysqlMode()) {
    const pool = getMysqlPool();
    let logId = 0;

    try {
      const [logResult] = await pool.execute(
        `INSERT INTO sync_log (sync_type, source, started_at, status) VALUES ('rankings', ?, NOW(), 'running')`,
        [source]
      ) as unknown as [{ insertId: number }];
      logId = logResult.insertId;
    } catch { /* 日志表写失败不阻断主流程 */ }

    try {
      // 批量查 playlet_id -> drama_id 映射（减少逐条查询）
      const playletIds = Array.from(new Set(rankings.map(r => r.playlet_id)));
      const placeholders = playletIds.map(() => '?').join(',');
      const [dramaRowsRaw] = await pool.execute(
        `SELECT id, playlet_id FROM drama WHERE playlet_id IN (${placeholders})`,
        playletIds
      ) as unknown as [{ id: number; playlet_id: string }[][]];
      const dramaRowsArr = dramaRowsRaw as { id: number; playlet_id: string }[];
      const idMap = new Map(dramaRowsArr.map(r => [r.playlet_id, r.id]));

      const missingPlayletIds = playletIds.filter(pid => !idMap.has(pid));
      if (missingPlayletIds.length > 0) {
        console.warn(`[sync/rankings] ${missingPlayletIds.length} 个 playlet_id 未在 drama 表找到，将被 skip。示例: ${missingPlayletIds.slice(0, 3).join(', ')}`);
      }

      await withTransaction(async (conn) => {
        for (const r of rankings) {
          const dramaId = idMap.get(r.playlet_id);
          if (!dramaId) {
            counts.skipped++;
            if (skipReasons.length < 5) skipReasons.push(`playlet_id=${r.playlet_id} not in drama table`);
            continue;
          }
          try {
            // 幂等写入：ON DUPLICATE KEY UPDATE
            // UNIQUE KEY: (drama_id, platform, ranking_type, date_key)
            // 重复推送相同数据 → 覆盖数值字段，inserted_count 仍递增（MySQL 报告受影响行数）
            const [result] = await conn.execute(
              `INSERT INTO ranking_snapshot
                 (drama_id, playlet_id, platform, ranking_type, date_key,
                  rank_position, heat_value, heat_increment, material_count, invest_days, fetched_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,NOW())
               ON DUPLICATE KEY UPDATE
                 rank_position=VALUES(rank_position),
                 heat_value=VALUES(heat_value),
                 heat_increment=VALUES(heat_increment),
                 material_count=VALUES(material_count),
                 invest_days=VALUES(invest_days),
                 fetched_at=NOW()`,
              [
                dramaId, r.playlet_id, platform, ranking_type, normalizedDateKey,
                r.rank_position, r.heat_value ?? 0, r.heat_increment ?? null,
                r.material_count ?? 0, r.invest_days ?? 0,
              ]
            ) as unknown as [{ affectedRows: number }];
            // affectedRows=1 → INSERT（新增）；affectedRows=2 → UPDATE（覆盖）
            if ((result as { affectedRows: number }).affectedRows === 2) {
              counts.updated++;
            } else {
              counts.inserted++;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[sync/rankings] 写入失败 playlet_id=${r.playlet_id}: ${msg}`);
            if (failReasons.length < 5) failReasons.push(`${r.playlet_id}: ${msg}`);
            counts.failed++;
          }
        }
      });

      if (logId) {
        await pool.execute(
          `UPDATE sync_log SET status='success', finished_at=NOW(),
             inserted_count=?, updated_count=?, skipped_count=?,
             error_message=NULL,
             payload_summary=?
           WHERE id=?`,
          [
            counts.inserted, counts.updated, counts.skipped,
            JSON.stringify({ platform, date_key: normalizedDateKey, ranking_type, skipSample: skipReasons }),
            logId,
          ]
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync/rankings] 事务失败: ${msg}`);
      if (logId) {
        await pool.execute(
          `UPDATE sync_log SET status='failed', finished_at=NOW(), error_message=?,
             payload_summary=? WHERE id=?`,
          [msg, JSON.stringify({ failSample: failReasons }), logId]
        );
      }
      return NextResponse.json({
        error: `同步失败: ${msg}`,
        counts, skipSample: skipReasons, failSample: failReasons,
      }, { status: 500 });
    }

    console.log(
      `[sync/rankings] ✓ source=${source} platform=${platform} date=${normalizedDateKey} ` +
      `type=${ranking_type} inserted=${counts.inserted} updated=${counts.updated} ` +
      `skipped=${counts.skipped} failed=${counts.failed} total=${rankings.length}`
    );
    return NextResponse.json({
      success: true,
      idempotency_note: '重复推送同一 (platform,date_key,playlet_id) 会更新数值字段(counted as updated)',
      ...counts,
      total: rankings.length,
      skipSample: skipReasons.length > 0 ? skipReasons : undefined,
      failSample: failReasons.length > 0 ? failReasons : undefined,
    });
  }

  // ── SQLite 兜底模式 ─────────────────────────────────────────────────────────
  try {
    const db = getDb();
    const upsert = db.transaction((items: RankingSyncItem[]) => {
      for (const r of items) {
        try {
          // ON CONFLICT → 更新已有记录（幂等）
          const result = db.prepare(
            `INSERT INTO ranking_snapshot
               (playlet_id, platform, snapshot_date, rank, heat_value, material_count, invest_days)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(playlet_id, platform, snapshot_date) DO UPDATE SET
               rank=excluded.rank, heat_value=excluded.heat_value,
               material_count=excluded.material_count, invest_days=excluded.invest_days`
          ).run(
            r.playlet_id, platform, normalizedDateKey, r.rank_position,
            r.heat_value ?? 0, r.material_count ?? 0, r.invest_days ?? 0
          );
          // SQLite: changes=1 对 INSERT 和 UPDATE 均为 1，无法区分，统一计 inserted
          if (result.changes > 0) counts.inserted++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (failReasons.length < 5) failReasons.push(`${r.playlet_id}: ${msg}`);
          counts.failed++;
        }
      }
    });
    upsert(rankings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sync/rankings] SQLite 写入失败: ${msg}`);
    return NextResponse.json({ error: `同步失败: ${msg}`, counts }, { status: 500 });
  }

  console.log(
    `[sync/rankings] ✓ SQLite source=${source} platform=${platform} date=${normalizedDateKey} ` +
    `inserted=${counts.inserted} failed=${counts.failed}`
  );
  return NextResponse.json({
    success: true,
    idempotency_note: 'ON CONFLICT DO UPDATE：重复推送覆盖数值字段',
    ...counts,
    total: rankings.length,
    failSample: failReasons.length > 0 ? failReasons : undefined,
  });
}
