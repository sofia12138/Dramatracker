import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isMysqlMode, query } from '@/lib/mysql';

/**
 * 方言信息：根据 isMysqlMode() 在两套 schema 之间切换。
 * - SQLite: ranking_snapshot 用 snapshot_date / rank, drama 表自带 is_ai_drama 等
 * - MySQL : ranking_snapshot 用 date_key / rank_position, 人审字段在 drama_review
 *           （好在 MySQL 的 ranking_snapshot 也有 playlet_id 业务键，可继续用 playlet_id 作 join key）
 */
interface Dialect {
  isMySQL: boolean;
  dateCol: string;          // rs.snapshot_date / rs.date_key
  rankCol: string;          // rs.rank / rs.rank_position
  reviewJoin: string;       // '' / LEFT JOIN drama_review dr ON dr.drama_id = rs.drama_id
  isAiCol: string;          // d.is_ai_drama / dr.is_ai_drama
  tagsExpr: string;         // COALESCE(...)
  dateMinusDays: (n: number) => string;
  /** 在 MySQL ONLY_FULL_GROUP_BY 下包裹非聚合列；SQLite 透传 */
  anyValue: (expr: string) => string;
  /** 执行 SELECT 并返回行 */
  exec: <T = Record<string, unknown>>(sql: string, params: unknown[]) => Promise<T[]>;
}

function makeDialect(): Dialect {
  if (isMysqlMode()) {
    return {
      isMySQL: true,
      dateCol: 'rs.date_key',
      rankCol: 'rs.rank_position',
      // ranking_snapshot 已带 drama_id；直接关 drama_review，省一次 JOIN drama
      reviewJoin: 'LEFT JOIN drama_review dr ON dr.drama_id = rs.drama_id',
      isAiCol: 'dr.is_ai_drama',
      tagsExpr: 'COALESCE(dr.genre_tags_manual, dr.genre_tags_ai, d.tags)',
      dateMinusDays: (n: number) => `DATE_SUB(?, INTERVAL ${n} DAY)`,
      anyValue: (expr: string) => `ANY_VALUE(${expr})`,
      exec: async <T,>(sql: string, params: unknown[]) => (await query<T>(sql, params)) as T[],
    };
  }
  return {
    isMySQL: false,
    dateCol: 'rs.snapshot_date',
    rankCol: 'rs.rank',
    reviewJoin: '',
    isAiCol: 'd.is_ai_drama',
    tagsExpr: 'COALESCE(d.genre_tags_manual, d.genre_tags_ai, d.tags)',
    dateMinusDays: (n: number) => `date(?, '-${n} day${n > 1 ? 's' : ''}')`,
    anyValue: (expr: string) => expr,
    exec: async <T,>(sql: string, params: unknown[]) => {
      const db = getDb();
      return db.prepare(sql).all(...params) as T[];
    },
  };
}

interface RankingRow {
  playlet_id: string;
  platform: string;
  rank: number;
  heat_value: number;
  material_count: number;
  invest_days: number;
  snapshot_date: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  language: string | null;
  is_ai_drama: string | null;
  tags: string | null;
  first_air_date: string | null;
  creative_count: number | null;
}

function normalizeTitle(raw: unknown): string {
  return ((raw as string) || '')
    .replace(/\[Updating\]/gi, '')
    .replace(/\(Updating\)/gi, '')
    .replace(/【更新中】/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeDateStr(raw: unknown): string {
  const s = ((raw as string) || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

function getDramaDedupeKey(title: unknown, language: unknown, firstAirDate: unknown, platform?: unknown): string {
  const t = normalizeTitle(title);
  const l = ((language as string) || '').trim().toLowerCase();
  const d = normalizeDateStr(firstAirDate);
  const parts = platform ? [`${platform}`, t, l, d] : [t, l, d];
  return parts.join('|');
}

export async function GET(request: NextRequest) {
  try {
    const dia = makeDialect();
    const { isMySQL, dateCol, rankCol, reviewJoin, isAiCol, tagsExpr, dateMinusDays, anyValue, exec } = dia;
    // SQLite 路径仍需要 db 句柄给老 helper（仅在 SQLite 模式被调用）
    const db = isMySQL ? null : getDb();

    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') || '';
    const isAiDrama = searchParams.get('is_ai_drama') || '';
    const mode = searchParams.get('mode') || 'today';
    const startDate = searchParams.get('start_date') || '';
    const endDate = searchParams.get('end_date') || '';
    const limit = parseInt(searchParams.get('limit') || '50');
    // 'total'：总榜（按 heat_value 排序）；'trending'：趋势榜（按 heat_increment 排序）；'new'：新剧榜
    const rankingMode = searchParams.get('ranking_mode') || 'total';
    // 新剧榜专属参数
    const newWindow = searchParams.get('new_window') || '7d'; // today | yesterday | 7d | 30d
    const sortBy = searchParams.get('sort_by') || 'heat';     // heat | increment | new
    // 新剧榜分类过滤：all 全部(默认) | classified 仅已分类 | pending 仅待审核
    const classifyFilter = searchParams.get('classify_filter') || 'all';

    const latestDateRows = isMySQL
      ? await query<{ d: string | null }>(
          "SELECT DATE_FORMAT(MAX(date_key), '%Y-%m-%d') AS d FROM ranking_snapshot"
        )
      : (db!.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').all() as { d: string | null }[]);
    const latestDate = latestDateRows[0]?.d || '';

    const distinctDaysRows = isMySQL
      ? await query<{ cnt: number }>('SELECT COUNT(DISTINCT date_key) AS cnt FROM ranking_snapshot')
      : (db!.prepare('SELECT COUNT(DISTINCT snapshot_date) as cnt FROM ranking_snapshot').all() as { cnt: number }[]);
    const snapshotDays = distinctDaysRows[0]?.cnt || 0;

    const requiredDays = mode === '7days' ? 7 : mode === '30days' ? 30 : 1;
    const dataAccumulating = snapshotDays < requiredDays && mode !== 'today' && mode !== 'yesterday' && mode !== 'custom';
    const minAppearances = mode === '7days' ? 2 : mode === '30days' ? 3 : 0;

    let dateFilter = '';
    const params: unknown[] = [];

    if (mode === 'today') {
      dateFilter = `${dateCol} = ?`;
      params.push(latestDate);
    } else if (mode === 'yesterday') {
      dateFilter = `${dateCol} = ${dateMinusDays(1)}`;
      params.push(latestDate);
    } else if (mode === '7days') {
      dateFilter = `${dateCol} >= ${dateMinusDays(6)} AND ${dateCol} <= ?`;
      params.push(latestDate, latestDate);
    } else if (mode === '30days') {
      dateFilter = `${dateCol} >= ${dateMinusDays(29)} AND ${dateCol} <= ?`;
      params.push(latestDate, latestDate);
    } else if (mode === 'custom' && startDate && endDate) {
      dateFilter = `${dateCol} >= ? AND ${dateCol} <= ?`;
      params.push(startDate, endDate);
    } else {
      dateFilter = `${dateCol} = ?`;
      params.push(latestDate);
    }

    let whereClause = dateFilter;
    if (isAiDrama) {
      whereClause += ` AND ${isAiCol} = ?`;
      params.push(isAiDrama);
    }

    if (platform && platform !== 'all') {
      whereClause += ' AND rs.platform = ?';
      params.push(platform);

      // Per-platform: get min rank over date range, order by rank
      const safeLimit = Math.max(1, Math.floor(limit));
      const dateAlias = isMySQL ? `DATE_FORMAT(MAX(${dateCol}), '%Y-%m-%d')` : `MAX(${dateCol})`;
      // 非聚合列在 MySQL ONLY_FULL_GROUP_BY 下需 ANY_VALUE 包裹（SQLite 透传）
      const firstAirAny = isMySQL
        ? "DATE_FORMAT(ANY_VALUE(d.first_air_date), '%Y-%m-%d') AS first_air_date"
        : 'd.first_air_date AS first_air_date';
      const sql = `
        SELECT
          rs.playlet_id,
          rs.platform,
          MIN(${rankCol}) as \`rank\`,
          MAX(rs.heat_value) as heat_value,
          MAX(rs.material_count) as material_count,
          MAX(rs.invest_days) as invest_days,
          ${dateAlias} as snapshot_date,
          ${anyValue('d.title')} as title,
          ${anyValue('d.description')} as description,
          ${anyValue('d.cover_url')} as cover_url,
          ${anyValue('d.language')} as language,
          ${anyValue(isAiCol)} as is_ai_drama,
          ${anyValue(tagsExpr)} as tags,
          ${firstAirAny},
          ${anyValue('d.creative_count')} as creative_count
        FROM ranking_snapshot rs
        LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
        ${reviewJoin}
        WHERE ${whereClause}
        GROUP BY rs.playlet_id, rs.platform
        ${minAppearances > 0 ? `HAVING COUNT(DISTINCT ${dateCol}) >= ${minAppearances}` : ''}
        ORDER BY \`rank\` ASC
        LIMIT ${safeLimit}
      `;
      const data = await exec<RankingRow>(sql, params);

      // Drama-level dedup: merge iOS/Android records (different playlet_id, same drama)
      const dedupMap = new Map<string, RankingRow>();
      for (const row of data) {
        const key = getDramaDedupeKey(row.title, row.language, row.first_air_date, row.platform);
        const existing = dedupMap.get(key);
        if (!existing || row.rank < existing.rank) {
          dedupMap.set(key, row);
        }
      }
      const dedupedRows = Array.from(dedupMap.values())
        .sort((a, b) => a.rank - b.rank);

      const effectiveMode = dataAccumulating ? 'today' : mode;
      const prevData = await getPreviousPeriodRanks(dia, platform, isAiDrama, effectiveMode, latestDate, startDate, endDate);
      const firstAppearances = await getFirstAppearances(dia);
      const periodStart = computePeriodStartDate(effectiveMode, latestDate, startDate);
      const baselineDate = await getBaselineDate(dia, effectiveMode, latestDate, startDate, endDate);
      const baselineHeatMap = baselineDate ? await getHeatValuesOnDate(dia, baselineDate, isAiDrama) : null;

      const enriched = dedupedRows.map((item) => {
        const prev = prevData.get(`${item.playlet_id}:${item.platform}`);
        const firstDate = firstAppearances.get(item.playlet_id);
        const isNew = !!firstDate && firstDate >= periodStart;

        let heatIncrement: number | null = null;
        if (!isNew && baselineHeatMap) {
          const baseHeat = baselineHeatMap.get(`${item.playlet_id}:${item.platform}`);
          if (baseHeat !== undefined) {
            heatIncrement = item.heat_value - baseHeat;
          }
        }

        return {
          ...item,
          prev_rank: prev?.rank ?? null,
          rank_change: prev ? prev.rank - item.rank : null,
          is_new: isNew,
          heat_increment: heatIncrement,
        };
      });

      const sparklines = await getInvestTrendSparklines(
        dia, enriched.map(i => ({ playlet_id: i.playlet_id, platform }))
      );

      const result = enriched.map((item, index) => ({
        ...item,
        orig_rank: item.rank,
        rank: index + 1,
        sparkline: sparklines.get(item.playlet_id) || [],
      }));

      return NextResponse.json({ data: result, latestDate, total: result.length, dataAccumulating, snapshotDays, rankingMode: 'platform' });
    }

    // ── 新剧榜 ──────────────────────────────────────────────────────────────
    if (rankingMode === 'new') {
      // 取最新 snapshot 全量数据（排序/筛选均在内存中做）
      // 新剧榜的 is_ai_drama 过滤策略：包含"匹配的类型"或"尚未分类(NULL)"
      // 原因：新剧刚进入系统时 is_ai_drama 通常为 NULL（待审核），若严格过滤会导致
      //       今天/昨天的新剧全部消失。新剧榜的核心价值正是发现这些未分类的新剧。
      const dateAliasNew = isMySQL ? `DATE_FORMAT(${dateCol}, '%Y-%m-%d')` : dateCol;
      const firstAirSelNew = isMySQL ? "DATE_FORMAT(d.first_air_date, '%Y-%m-%d') AS first_air_date" : 'd.first_air_date';
      const newSql = `
        SELECT
          rs.playlet_id, rs.platform, ${rankCol} as \`rank\`, rs.heat_value,
          rs.material_count, rs.invest_days, ${dateAliasNew} as snapshot_date,
          d.title, d.description, d.cover_url, d.language, ${isAiCol} as is_ai_drama,
          ${tagsExpr} as tags,
          ${firstAirSelNew}, d.creative_count
        FROM ranking_snapshot rs
        LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
        ${reviewJoin}
        WHERE ${dateCol} = ?${isAiDrama ? ` AND (${isAiCol} = ? OR ${isAiCol} IS NULL)` : ''}
        ORDER BY rs.heat_value DESC
      `;
      const newSqlParams: unknown[] = [latestDate];
      if (isAiDrama) newSqlParams.push(isAiDrama);
      const allLatest = await exec<RankingRow>(newSql, newSqlParams);

      // first_seen_date：首次进入系统的日期（MIN snapshot_date / date_key）
      const firstSeenMap = await getFirstAppearances(dia);

      // 计算 new_window 时间范围（以 latestDate 为基准，筛 effective_new_date）
      // Bug fix: windowEnd 必须是 let，且 yesterday 需独立设置 windowEnd = windowStart
      const latestD = new Date(latestDate + 'T00:00:00Z');
      let windowStart = latestDate;
      let windowEnd = latestDate;
      if (newWindow === 'today') {
        // windowStart = windowEnd = latestDate（已默认）
      } else if (newWindow === 'yesterday') {
        const yd = new Date(latestD);
        yd.setUTCDate(yd.getUTCDate() - 1);
        windowStart = yd.toISOString().slice(0, 10);
        windowEnd = windowStart; // 精确匹配昨天，不含今天
      } else if (newWindow === '7d') {
        const s = new Date(latestD);
        s.setUTCDate(s.getUTCDate() - 6);
        windowStart = s.toISOString().slice(0, 10);
        // windowEnd = latestDate（已默认）
      } else if (newWindow === '30d') {
        const s = new Date(latestD);
        s.setUTCDate(s.getUTCDate() - 29);
        windowStart = s.toISOString().slice(0, 10);
        // windowEnd = latestDate（已默认）
      }

      // 新剧榜 heat_increment 固定用"日增量"（最新日 vs 前一日 baseline）
      const newBaselineDate = await getBaselineDate(dia, 'today', latestDate, '', '');
      const newBaselineHeatMap = newBaselineDate ? await getHeatValuesOnDate(dia, newBaselineDate, isAiDrama) : null;

      // 跨平台去重：key 不含 platform，始终选 heat_value 最大的记录作为代表
      type NewEntry = {
        item: RankingRow;
        platforms: { name: string; rank: number }[];
        heatIncrement: number | null;
        maxHeatValue: number;
        bestPlatform: string;
        firstSeenDate: string | null;
        effectiveNewDate: string | null;
      };
      const newDramaMap = new Map<string, NewEntry>();

      for (const row of allLatest) {
        const firstSeenDate = firstSeenMap.get(row.playlet_id) || null;
        const normalizedAirDate = normalizeDateStr(row.first_air_date) || null;

        // effective_new_date 判定逻辑（修复版）：
        // - 优先用 first_air_date，但仅当它落在时间窗口内时才算"新剧"依据
        // - 若 first_air_date 不在窗口（可能是很久以前上线的剧刚被系统收录），
        //   则 fallback 到 first_seen_date，判断该剧是否"新进入追踪"
        // - 两者都不在窗口内 → 不是新剧，跳过
        const airInWindow = !!normalizedAirDate && normalizedAirDate >= windowStart && normalizedAirDate <= windowEnd;
        const seenInWindow = !!firstSeenDate && firstSeenDate >= windowStart && firstSeenDate <= windowEnd;

        if (!airInWindow && !seenInWindow) continue;

        // 展示用的 effective_new_date：窗口内的 first_air_date 优先，否则用 first_seen_date
        const effectiveNewDate = airInWindow ? normalizedAirDate! : firstSeenDate!;

        let increment: number | null = null;
        if (newBaselineHeatMap) {
          const baseHeat = newBaselineHeatMap.get(`${row.playlet_id}:${row.platform}`);
          if (baseHeat !== undefined) increment = row.heat_value - baseHeat;
        }

        const dramaKey = getDramaDedupeKey(row.title, row.language, row.first_air_date);
        const existing = newDramaMap.get(dramaKey);

        if (!existing) {
          newDramaMap.set(dramaKey, {
            item: row,
            platforms: [{ name: row.platform, rank: row.rank }],
            heatIncrement: increment,
            maxHeatValue: row.heat_value,
            bestPlatform: row.platform,
            firstSeenDate,
            effectiveNewDate,
          });
        } else {
          if (!existing.platforms.some(p => p.name === row.platform)) {
            existing.platforms.push({ name: row.platform, rank: row.rank });
          }
          // 代表记录固定选 heat_value 最大
          if (row.heat_value > existing.maxHeatValue) {
            existing.maxHeatValue = row.heat_value;
            existing.item = row;
            existing.bestPlatform = row.platform;
            existing.firstSeenDate = firstSeenDate;
            existing.effectiveNewDate = effectiveNewDate;
          }
          // 始终记录最大 heat_increment（用于排序/展示）
          const existingInc = existing.heatIncrement ?? -Infinity;
          const newInc = increment ?? -Infinity;
          if (newInc > existingInc) existing.heatIncrement = increment;
        }
      }

      // 按 sort_by 排序（对全量去重结果排序，之后再统计 meta、过滤、截断）
      const allEntries = Array.from(newDramaMap.values())
        .sort((a, b) => {
          if (sortBy === 'heat') {
            if (b.maxHeatValue !== a.maxHeatValue) return b.maxHeatValue - a.maxHeatValue;
            const ai = a.heatIncrement ?? -Infinity, bi = b.heatIncrement ?? -Infinity;
            if (bi !== ai) return bi - ai;
            return (b.effectiveNewDate || '').localeCompare(a.effectiveNewDate || '');
          } else if (sortBy === 'increment') {
            const ai = a.heatIncrement, bi = b.heatIncrement;
            if (ai !== null && bi !== null && ai !== bi) return bi - ai;
            if (ai !== null && bi === null) return -1;
            if (ai === null && bi !== null) return 1;
            if (b.maxHeatValue !== a.maxHeatValue) return b.maxHeatValue - a.maxHeatValue;
            return (b.effectiveNewDate || '').localeCompare(a.effectiveNewDate || '');
          } else {
            // sort_by === 'new'：上新时间 DESC → heat_value DESC → increment DESC
            const dc = (b.effectiveNewDate || '').localeCompare(a.effectiveNewDate || '');
            if (dc !== 0) return dc;
            if (b.maxHeatValue !== a.maxHeatValue) return b.maxHeatValue - a.maxHeatValue;
            const ai = a.heatIncrement ?? -Infinity, bi = b.heatIncrement ?? -Infinity;
            return bi - ai;
          }
        });

      // meta 统计：在 classify_filter 过滤之前计算，反映完整数量
      const metaTotal = allEntries.length;
      const metaClassified = allEntries.filter(e => !!e.item.is_ai_drama).length;
      const metaPending = metaTotal - metaClassified;

      // 按 classify_filter 筛选（默认 all 不过滤）
      let filteredEntries = allEntries;
      if (classifyFilter === 'classified') {
        filteredEntries = allEntries.filter(e => !!e.item.is_ai_drama);
      } else if (classifyFilter === 'pending') {
        filteredEntries = allEntries.filter(e => !e.item.is_ai_drama);
      }

      const newSorted = filteredEntries.slice(0, limit);

      const newSparklines = await getInvestTrendSparklines(
        dia, newSorted.map(e => ({ playlet_id: e.item.playlet_id, platform: e.bestPlatform }))
      );

      const newResult = newSorted.map((entry, index) => {
        // is_ai_drama 有值 → 已分类；NULL → 待审核
        const classificationStatus = entry.item.is_ai_drama ? 'classified' : 'pending_review';
        return {
          ...entry.item,
          rank: index + 1,
          orig_rank: entry.item.rank,
          prev_rank: null,
          rank_change: null,
          is_new: true,
          heat_increment: entry.heatIncrement,
          current_heat_value: entry.maxHeatValue,
          platforms_list: entry.platforms,
          best_platform: entry.bestPlatform,
          first_seen_date: entry.firstSeenDate,
          effective_new_date: entry.effectiveNewDate,
          classification_status: classificationStatus as 'classified' | 'pending_review',
          sparkline: newSparklines.get(entry.item.playlet_id) || [],
        };
      });

      return NextResponse.json({
        data: newResult,
        latestDate,
        total: newResult.length,
        dataAccumulating: false,
        snapshotDays,
        rankingMode: 'new',
        newWindow,
        sortBy,
        meta: {
          total_count: metaTotal,
          classified_count: metaClassified,
          pending_count: metaPending,
        },
      });
    }

    // 总榜 / 趋势榜：跨平台去重聚合
    const dateAliasOverall = isMySQL ? `DATE_FORMAT(${dateCol}, '%Y-%m-%d')` : dateCol;
    const firstAirSelOverall = isMySQL ? "DATE_FORMAT(d.first_air_date, '%Y-%m-%d') AS first_air_date" : 'd.first_air_date';
    const sql = `
      SELECT
        rs.playlet_id,
        rs.platform,
        ${rankCol} as \`rank\`,
        rs.heat_value,
        rs.material_count,
        rs.invest_days,
        ${dateAliasOverall} as snapshot_date,
        d.title, d.description, d.cover_url, d.language, ${isAiCol} as is_ai_drama,
        ${tagsExpr} as tags,
        ${firstAirSelOverall}, d.creative_count
      FROM ranking_snapshot rs
      LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
      ${reviewJoin}
      WHERE ${whereClause}
      ORDER BY rs.heat_value DESC
    `;
    const rawData = await exec<RankingRow>(sql, params);

    let filteredData = rawData;
    if (minAppearances > 0) {
      const dateCounts = new Map<string, Set<string>>();
      for (const row of rawData) {
        if (!dateCounts.has(row.playlet_id)) dateCounts.set(row.playlet_id, new Set());
        dateCounts.get(row.playlet_id)!.add(row.snapshot_date);
      }
      filteredData = rawData.filter(row => (dateCounts.get(row.playlet_id)?.size ?? 0) >= minAppearances);
    }

    const effectiveMode = dataAccumulating ? 'today' : mode;
    const firstAppearances = await getFirstAppearances(dia);
    const periodStart = computePeriodStartDate(effectiveMode, latestDate, startDate);
    const baselineDate = await getBaselineDate(dia, effectiveMode, latestDate, startDate, endDate);
    const baselineHeatMap = baselineDate ? await getHeatValuesOnDate(dia, baselineDate, isAiDrama) : null;

    // Deduplicate across platforms:
    // - total mode:   keep the record with max heat_value as representative
    // - trending mode: keep the record with max heat_increment as representative
    // Both modes always track maxHeatValue and maxHeatIncrement for sorting/display.
    const dramaMap = new Map<string, {
      item: RankingRow;
      platforms: { name: string; rank: number }[];
      heatIncrement: number | null;
      maxHeatValue: number;
      bestPlatform: string;
    }>();

    for (const row of filteredData) {
      let increment: number | null = null;
      if (baselineHeatMap) {
        const baseHeat = baselineHeatMap.get(`${row.playlet_id}:${row.platform}`);
        if (baseHeat !== undefined) {
          increment = row.heat_value - baseHeat;
        }
      }

      const dramaKey = getDramaDedupeKey(row.title, row.language, row.first_air_date);
      const existing = dramaMap.get(dramaKey);
      if (!existing) {
        dramaMap.set(dramaKey, {
          item: row,
          platforms: [{ name: row.platform, rank: row.rank }],
          heatIncrement: increment,
          maxHeatValue: row.heat_value,
          bestPlatform: row.platform,
        });
      } else {
        if (!existing.platforms.some(p => p.name === row.platform)) {
          existing.platforms.push({ name: row.platform, rank: row.rank });
        }

        // 总榜：选 heat_value 最大的平台记录作为代表
        if (row.heat_value > existing.maxHeatValue) {
          existing.maxHeatValue = row.heat_value;
          if (rankingMode === 'total') {
            existing.item = row;
            existing.bestPlatform = row.platform;
          }
        }

        // 始终记录最大 heat_increment（总榜用于展示参考，趋势榜用于排序和选代表）
        const existingInc = existing.heatIncrement ?? -Infinity;
        const newInc = increment ?? -Infinity;
        if (newInc > existingInc) {
          existing.heatIncrement = increment;
          if (rankingMode === 'trending') {
            existing.item = row;
            existing.bestPlatform = row.platform;
          }
        }
      }
    }

    // 总榜：按 heat_value DESC，rank ASC 兜底
    // 趋势榜：按 heat_increment DESC，heat_value DESC 兜底
    const sorted = Array.from(dramaMap.values())
      .sort((a, b) => {
        if (rankingMode === 'total') {
          if (b.maxHeatValue !== a.maxHeatValue) return b.maxHeatValue - a.maxHeatValue;
          return a.item.rank - b.item.rank;
        } else {
          const ai = a.heatIncrement, bi = b.heatIncrement;
          if (ai !== null && bi !== null) return bi - ai;
          if (ai !== null) return -1;
          if (bi !== null) return 1;
          return b.maxHeatValue - a.maxHeatValue;
        }
      })
      .slice(0, limit);

    const prevRankMap = await getPreviousPeriodOverallRanks(dia, isAiDrama, effectiveMode, latestDate, startDate, endDate);

    const sparklines = await getInvestTrendSparklines(
      dia, sorted.map(e => ({ playlet_id: e.item.playlet_id, platform: e.bestPlatform }))
    );

    const result = sorted.map((entry, index) => {
      const newRank = index + 1;
      const prevRank = prevRankMap.get(entry.item.playlet_id);
      const firstDate = firstAppearances.get(entry.item.playlet_id);
      const isNew = !!firstDate && firstDate >= periodStart;

      return {
        ...entry.item,
        rank: newRank,
        orig_rank: entry.item.rank,
        prev_rank: prevRank ?? null,
        rank_change: prevRank ? prevRank - newRank : null,
        is_new: isNew,
        heat_increment: isNew ? null : entry.heatIncrement,
        current_heat_value: entry.maxHeatValue,
        platforms_list: entry.platforms,
        best_platform: entry.bestPlatform,
        sparkline: sparklines.get(entry.item.playlet_id) || [],
      };
    });

    return NextResponse.json({ data: result, latestDate, total: result.length, dataAccumulating, snapshotDays, rankingMode });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function getPreviousPeriodRanks(
  dia: Dialect,
  platform: string,
  isAiDrama: string,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string,
) {
  const map = new Map<string, { rank: number }>();
  const { dateCol, rankCol, reviewJoin, isAiCol, dateMinusDays, exec, isMySQL } = dia;
  let prevDateFilter = '';
  const params: unknown[] = [];

  if (mode === 'today') {
    const inner = isMySQL
      ? 'SELECT MAX(date_key) FROM ranking_snapshot WHERE date_key < ?'
      : 'SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < ?';
    prevDateFilter = `${dateCol} = (${inner})`;
    params.push(latestDate);
  } else if (mode === 'yesterday') {
    const inner = isMySQL
      ? `SELECT MAX(date_key) FROM ranking_snapshot WHERE date_key < ${dateMinusDays(1)}`
      : "SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < date(?, '-1 day')";
    prevDateFilter = `${dateCol} = (${inner})`;
    params.push(latestDate);
  } else if (mode === '7days') {
    prevDateFilter = `${dateCol} >= ${dateMinusDays(13)} AND ${dateCol} < ${dateMinusDays(6)}`;
    params.push(latestDate, latestDate);
  } else if (mode === '30days') {
    prevDateFilter = `${dateCol} >= ${dateMinusDays(59)} AND ${dateCol} < ${dateMinusDays(29)}`;
    params.push(latestDate, latestDate);
  } else if (mode === 'custom' && startDate && endDate) {
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    prevDateFilter = `${dateCol} >= ${dateMinusDays(days)} AND ${dateCol} < ?`;
    params.push(startDate, startDate);
  } else {
    return map;
  }

  let where = prevDateFilter;
  if (platform && platform !== 'all') {
    where += ' AND rs.platform = ?';
    params.push(platform);
  }
  if (isAiDrama) {
    where += ` AND ${isAiCol} = ?`;
    params.push(isAiDrama);
  }

  const sql = `
    SELECT rs.playlet_id, rs.platform, MIN(${rankCol}) as \`rank\`
    FROM ranking_snapshot rs
    LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE ${where}
    GROUP BY rs.playlet_id, rs.platform
  `;

  try {
    const rows = await exec<{ playlet_id: string; platform: string; rank: number }>(sql, params);
    for (const row of rows) {
      map.set(`${row.playlet_id}:${row.platform}`, { rank: Number(row.rank) });
    }
  } catch { /* empty */ }
  return map;
}

async function getPreviousHeatValues(
  dia: Dialect,
  isAiDrama: string,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string,
) {
  const map = new Map<string, number>();
  const { dateCol, reviewJoin, isAiCol, dateMinusDays, exec, isMySQL } = dia;
  let prevDateFilter = '';
  const params: unknown[] = [];

  if (mode === 'today') {
    const inner = isMySQL
      ? 'SELECT MAX(date_key) FROM ranking_snapshot WHERE date_key < ?'
      : 'SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < ?';
    prevDateFilter = `${dateCol} = (${inner})`;
    params.push(latestDate);
  } else if (mode === 'yesterday') {
    const inner = isMySQL
      ? `SELECT MAX(date_key) FROM ranking_snapshot WHERE date_key < ${dateMinusDays(1)}`
      : "SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < date(?, '-1 day')";
    prevDateFilter = `${dateCol} = (${inner})`;
    params.push(latestDate);
  } else if (mode === '7days') {
    prevDateFilter = `${dateCol} >= ${dateMinusDays(13)} AND ${dateCol} < ${dateMinusDays(6)}`;
    params.push(latestDate, latestDate);
  } else if (mode === '30days') {
    prevDateFilter = `${dateCol} >= ${dateMinusDays(59)} AND ${dateCol} < ${dateMinusDays(29)}`;
    params.push(latestDate, latestDate);
  } else if (mode === 'custom' && startDate && endDate) {
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    prevDateFilter = `${dateCol} >= ${dateMinusDays(days)} AND ${dateCol} < ?`;
    params.push(startDate, startDate);
  } else {
    return map;
  }

  let where = prevDateFilter;
  if (isAiDrama) {
    where += ` AND ${isAiCol} = ?`;
    params.push(isAiDrama);
  }

  const sql = `
    SELECT rs.playlet_id, rs.platform, MAX(rs.heat_value) as heat_value
    FROM ranking_snapshot rs
    LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE ${where}
    GROUP BY rs.playlet_id, rs.platform
  `;

  try {
    const rows = await exec<{ playlet_id: string; platform: string; heat_value: number }>(sql, params);
    for (const row of rows) {
      map.set(`${row.playlet_id}:${row.platform}`, Number(row.heat_value));
    }
  } catch { /* empty */ }
  return map;
}

async function getPreviousPeriodOverallRanks(
  dia: Dialect,
  isAiDrama: string,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string,
) {
  const prevHeatMap = await getPreviousHeatValues(dia, isAiDrama, mode, latestDate, startDate, endDate);
  const dramaHeats = new Map<string, number>();
  prevHeatMap.forEach((heat, key) => {
    const pid = key.split(':')[0];
    const existing = dramaHeats.get(pid) || 0;
    if (heat > existing) dramaHeats.set(pid, heat);
  });
  const sorted = Array.from(dramaHeats.entries()).sort((a, b) => b[1] - a[1]);
  const rankMap = new Map<string, number>();
  sorted.forEach(([pid], i) => rankMap.set(pid, i + 1));
  return rankMap;
}

async function getInvestTrendSparklines(
  dia: Dialect,
  entries: Array<{ playlet_id: string; platform: string }>,
) {
  const map = new Map<string, number[]>();
  if (entries.length === 0) return map;

  const byPlatform = new Map<string, string[]>();
  for (const e of entries) {
    if (!byPlatform.has(e.platform)) byPlatform.set(e.platform, []);
    const arr = byPlatform.get(e.platform)!;
    if (!arr.includes(e.playlet_id)) arr.push(e.playlet_id);
  }

  try {
    const platforms = Array.from(byPlatform.keys());
    for (let pi = 0; pi < platforms.length; pi++) {
      const platform = platforms[pi];
      const pids = byPlatform.get(platform)!;
      const placeholders = pids.map(() => '?').join(',');
      const dateSel = dia.isMySQL ? "DATE_FORMAT(date, '%Y-%m-%d') AS date" : 'date';
      const sql = `
        SELECT playlet_id, ${dateSel}, daily_invest_count
        FROM invest_trend
        WHERE playlet_id IN (${placeholders}) AND platform = ?
        ORDER BY date ASC
      `;

      const rows = await dia.exec<{ playlet_id: string; date: string; daily_invest_count: number }>(
        sql, [...pids, platform]
      );

      const grouped = new Map<string, number[]>();
      for (const row of rows) {
        if (!grouped.has(row.playlet_id)) grouped.set(row.playlet_id, []);
        grouped.get(row.playlet_id)!.push(Number(row.daily_invest_count));
      }

      const groupedKeys = Array.from(grouped.keys());
      for (let gi = 0; gi < groupedKeys.length; gi++) {
        const pid = groupedKeys[gi];
        const values = grouped.get(pid)!;
        const startIdx = values.findIndex(v => v > 0);
        if (startIdx === -1) continue;
        const filtered = values.slice(startIdx);
        map.set(pid, filtered.slice(-14));
      }
    }
  } catch { /* empty */ }
  return map;
}

function computePeriodStartDate(mode: string, latestDate: string, startDate: string): string {
  if (mode === 'today') return latestDate;
  const d = new Date(latestDate + 'T00:00:00Z');
  if (mode === 'yesterday') { d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  if (mode === '7days') { d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10); }
  if (mode === '30days') { d.setUTCDate(d.getUTCDate() - 29); return d.toISOString().slice(0, 10); }
  return startDate || latestDate;
}

async function getFirstAppearances(dia: Dialect): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const sql = dia.isMySQL
      ? "SELECT playlet_id, DATE_FORMAT(MIN(date_key), '%Y-%m-%d') AS first_date FROM ranking_snapshot GROUP BY playlet_id"
      : 'SELECT playlet_id, MIN(snapshot_date) as first_date FROM ranking_snapshot GROUP BY playlet_id';
    const rows = await dia.exec<{ playlet_id: string; first_date: string }>(sql, []);
    for (const row of rows) map.set(row.playlet_id, row.first_date);
  } catch { /* empty */ }
  return map;
}

async function getBaselineDate(
  dia: Dialect,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const { dateCol, dateMinusDays, exec, isMySQL } = dia;
  const dAlias = isMySQL ? `DATE_FORMAT(${dateCol}, '%Y-%m-%d')` : dateCol;
  const dMaxAlias = isMySQL ? `DATE_FORMAT(MAX(${dateCol}), '%Y-%m-%d')` : `MAX(${dateCol})`;
  let sql = '';
  const params: unknown[] = [];

  if (mode === 'today') {
    sql = `SELECT ${dAlias} as d FROM ranking_snapshot rs WHERE ${dateCol} = ${dateMinusDays(1)} LIMIT 1`;
    params.push(latestDate);
  } else if (mode === 'yesterday') {
    sql = `SELECT ${dAlias} as d FROM ranking_snapshot rs WHERE ${dateCol} = ${dateMinusDays(2)} LIMIT 1`;
    params.push(latestDate);
  } else if (mode === '7days') {
    sql = `SELECT ${dMaxAlias} as d FROM ranking_snapshot rs WHERE ${dateCol} <= ${dateMinusDays(7)} AND ${dateCol} >= ${dateMinusDays(10)}`;
    params.push(latestDate, latestDate);
  } else if (mode === '30days') {
    sql = `SELECT ${dMaxAlias} as d FROM ranking_snapshot rs WHERE ${dateCol} <= ${dateMinusDays(30)} AND ${dateCol} >= ${dateMinusDays(34)}`;
    params.push(latestDate, latestDate);
  } else if (mode === 'custom' && startDate && endDate) {
    sql = `SELECT ${dMaxAlias} as d FROM ranking_snapshot rs WHERE ${dateCol} < ? AND ${dateCol} >= ${dateMinusDays(4)}`;
    params.push(startDate, startDate);
  } else {
    return null;
  }

  try {
    const rows = await exec<{ d: string | null }>(sql, params);
    return rows[0]?.d || null;
  } catch { return null; }
}

async function getHeatValuesOnDate(
  dia: Dialect,
  baselineDate: string,
  isAiDrama: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { dateCol, reviewJoin, isAiCol, exec } = dia;
  const params: unknown[] = [baselineDate];
  let where = `${dateCol} = ?`;
  if (isAiDrama) { where += ` AND ${isAiCol} = ?`; params.push(isAiDrama); }

  try {
    const rows = await exec<{ playlet_id: string; platform: string; heat_value: number }>(`
      SELECT rs.playlet_id, rs.platform, MAX(rs.heat_value) as heat_value
      FROM ranking_snapshot rs
      LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
      ${reviewJoin}
      WHERE ${where}
      GROUP BY rs.playlet_id, rs.platform
    `, params);
    for (const row of rows) map.set(`${row.playlet_id}:${row.platform}`, Number(row.heat_value));
  } catch { /* empty */ }
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const items = Array.isArray(body) ? body : [body];

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ranking_snapshot (playlet_id, platform, rank, heat_value, material_count, invest_days, snapshot_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = db.transaction((rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        stmt.run(
          row.playlet_id, row.platform, row.rank,
          (row.heat_value as number | undefined) ?? 0,
          (row.material_count as number | undefined) ?? 0,
          (row.invest_days as number | undefined) ?? 0,
          row.snapshot_date
        );
      }
    });

    insertMany(items as Array<Record<string, unknown>>);
    return NextResponse.json({ success: true, count: items.length }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
