import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') || '';
    const isAiDrama = searchParams.get('is_ai_drama') || '';
    const mode = searchParams.get('mode') || 'today';
    const startDate = searchParams.get('start_date') || '';
    const endDate = searchParams.get('end_date') || '';
    const limit = parseInt(searchParams.get('limit') || '50');

    const latestDateRow = db.prepare(
      'SELECT MAX(snapshot_date) as d FROM ranking_snapshot'
    ).get() as { d: string | null };
    const latestDate = latestDateRow?.d || '';

    const distinctDaysRow = db.prepare(
      'SELECT COUNT(DISTINCT snapshot_date) as cnt FROM ranking_snapshot'
    ).get() as { cnt: number };
    const snapshotDays = distinctDaysRow?.cnt || 0;

    const requiredDays = mode === '7days' ? 7 : mode === '30days' ? 30 : 1;
    const dataAccumulating = snapshotDays < requiredDays && mode !== 'today' && mode !== 'yesterday' && mode !== 'custom';
    const minAppearances = mode === '7days' ? 2 : mode === '30days' ? 3 : 0;

    let dateFilter = '';
    const params: unknown[] = [];

    if (mode === 'today') {
      dateFilter = 'rs.snapshot_date = ?';
      params.push(latestDate);
    } else if (mode === 'yesterday') {
      dateFilter = "rs.snapshot_date = date(?, '-1 day')";
      params.push(latestDate);
    } else if (mode === '7days') {
      dateFilter = "rs.snapshot_date >= date(?, '-6 days') AND rs.snapshot_date <= ?";
      params.push(latestDate, latestDate);
    } else if (mode === '30days') {
      dateFilter = "rs.snapshot_date >= date(?, '-29 days') AND rs.snapshot_date <= ?";
      params.push(latestDate, latestDate);
    } else if (mode === 'custom' && startDate && endDate) {
      dateFilter = 'rs.snapshot_date >= ? AND rs.snapshot_date <= ?';
      params.push(startDate, endDate);
    } else {
      dateFilter = 'rs.snapshot_date = ?';
      params.push(latestDate);
    }

    let whereClause = dateFilter;
    if (isAiDrama) {
      whereClause += ' AND d.is_ai_drama = ?';
      params.push(isAiDrama);
    }

    if (platform && platform !== 'all') {
      whereClause += ' AND rs.platform = ?';
      params.push(platform);

      // Per-platform: get min rank over date range, order by rank
      const sql = `
        SELECT 
          rs.playlet_id,
          rs.platform,
          MIN(rs.rank) as rank,
          MAX(rs.heat_value) as heat_value,
          MAX(rs.material_count) as material_count,
          MAX(rs.invest_days) as invest_days,
          MAX(rs.snapshot_date) as snapshot_date,
          d.title, d.description, d.cover_url, d.language, d.is_ai_drama,
          COALESCE(d.genre_tags_manual, d.genre_tags_ai, d.tags) as tags,
          d.first_air_date, d.creative_count
        FROM ranking_snapshot rs
        LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
        WHERE ${whereClause}
        GROUP BY rs.playlet_id, rs.platform
        ${minAppearances > 0 ? `HAVING COUNT(DISTINCT rs.snapshot_date) >= ${minAppearances}` : ''}
        ORDER BY rank ASC
        LIMIT ?
      `;
      const data = db.prepare(sql).all(...params, limit) as RankingRow[];

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
      const prevData = getPreviousPeriodRanks(db, platform, isAiDrama, effectiveMode, latestDate, startDate, endDate);
      const firstAppearances = getFirstAppearances(db);
      const periodStart = computePeriodStartDate(effectiveMode, latestDate, startDate);
      const baselineDate = getBaselineDate(db, effectiveMode, latestDate, startDate, endDate);
      const baselineHeatMap = baselineDate ? getHeatValuesOnDate(db, baselineDate, isAiDrama) : null;

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

      const sparklines = getInvestTrendSparklines(
        db, enriched.map(i => ({ playlet_id: i.playlet_id, platform }))
      );

      const result = enriched.map((item, index) => ({
        ...item,
        orig_rank: item.rank,
        rank: index + 1,
        sparkline: sparklines.get(item.playlet_id) || [],
      }));

      return NextResponse.json({ data: result, latestDate, total: result.length, dataAccumulating, snapshotDays });
    }

    // "总榜" mode: deduplicate, aggregate across platforms
    const sql = `
      SELECT 
        rs.playlet_id,
        rs.platform,
        rs.rank,
        rs.heat_value,
        rs.material_count,
        rs.invest_days,
        rs.snapshot_date,
        d.title, d.description, d.cover_url, d.language, d.is_ai_drama,
        COALESCE(d.genre_tags_manual, d.genre_tags_ai, d.tags) as tags,
        d.first_air_date, d.creative_count
      FROM ranking_snapshot rs
      LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
      WHERE ${whereClause}
      ORDER BY rs.heat_value DESC
    `;
    const rawData = db.prepare(sql).all(...params) as RankingRow[];

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
    const firstAppearances = getFirstAppearances(db);
    const periodStart = computePeriodStartDate(effectiveMode, latestDate, startDate);
    const baselineDate = getBaselineDate(db, effectiveMode, latestDate, startDate, endDate);
    const baselineHeatMap = baselineDate ? getHeatValuesOnDate(db, baselineDate, isAiDrama) : null;

    // Deduplicate: keep the platform record with max heat increment for each drama
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
        if (row.heat_value > existing.maxHeatValue) {
          existing.maxHeatValue = row.heat_value;
        }
        const existingInc = existing.heatIncrement ?? -Infinity;
        const newInc = increment ?? -Infinity;
        if (newInc > existingInc) {
          existing.heatIncrement = increment;
          existing.item = row;
          existing.bestPlatform = row.platform;
        }
      }
    }

    // Sort: valid increments first (desc), then nulls (by heat value desc)
    const sorted = Array.from(dramaMap.values())
      .sort((a, b) => {
        const ai = a.heatIncrement, bi = b.heatIncrement;
        if (ai !== null && bi !== null) return bi - ai;
        if (ai !== null) return -1;
        if (bi !== null) return 1;
        return b.maxHeatValue - a.maxHeatValue;
      })
      .slice(0, limit);

    const prevRankMap = getPreviousPeriodOverallRanks(db, isAiDrama, effectiveMode, latestDate, startDate, endDate);

    const sparklines = getInvestTrendSparklines(
      db, sorted.map(e => ({ playlet_id: e.item.playlet_id, platform: e.bestPlatform }))
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

    return NextResponse.json({ data: result, latestDate, total: result.length, dataAccumulating, snapshotDays });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getPreviousPeriodRanks(
  db: ReturnType<typeof getDb>,
  platform: string,
  isAiDrama: string,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string
) {
  const map = new Map<string, { rank: number }>();
  let prevDateFilter = '';
  const params: unknown[] = [];

  if (mode === 'today') {
    prevDateFilter = 'rs.snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < ?)';
    params.push(latestDate);
  } else if (mode === 'yesterday') {
    prevDateFilter = "rs.snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < date(?, '-1 day'))";
    params.push(latestDate);
  } else if (mode === '7days') {
    prevDateFilter = "rs.snapshot_date >= date(?, '-13 days') AND rs.snapshot_date < date(?, '-6 days')";
    params.push(latestDate, latestDate);
  } else if (mode === '30days') {
    prevDateFilter = "rs.snapshot_date >= date(?, '-59 days') AND rs.snapshot_date < date(?, '-29 days')";
    params.push(latestDate, latestDate);
  } else if (mode === 'custom' && startDate && endDate) {
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    prevDateFilter = `rs.snapshot_date >= date(?, '-${days} days') AND rs.snapshot_date < ?`;
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
    where += ' AND d.is_ai_drama = ?';
    params.push(isAiDrama);
  }

  const sql = `
    SELECT rs.playlet_id, rs.platform, MIN(rs.rank) as rank
    FROM ranking_snapshot rs
    LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
    WHERE ${where}
    GROUP BY rs.playlet_id, rs.platform
  `;

  try {
    const rows = db.prepare(sql).all(...params) as { playlet_id: string; platform: string; rank: number }[];
    for (const row of rows) {
      map.set(`${row.playlet_id}:${row.platform}`, { rank: row.rank });
    }
  } catch { /* empty */ }
  return map;
}

function getPreviousHeatValues(
  db: ReturnType<typeof getDb>,
  isAiDrama: string,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string
) {
  const map = new Map<string, number>();
  let prevDateFilter = '';
  const params: unknown[] = [];

  if (mode === 'today') {
    prevDateFilter = 'rs.snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < ?)';
    params.push(latestDate);
  } else if (mode === 'yesterday') {
    prevDateFilter = "rs.snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < date(?, '-1 day'))";
    params.push(latestDate);
  } else if (mode === '7days') {
    prevDateFilter = "rs.snapshot_date >= date(?, '-13 days') AND rs.snapshot_date < date(?, '-6 days')";
    params.push(latestDate, latestDate);
  } else if (mode === '30days') {
    prevDateFilter = "rs.snapshot_date >= date(?, '-59 days') AND rs.snapshot_date < date(?, '-29 days')";
    params.push(latestDate, latestDate);
  } else if (mode === 'custom' && startDate && endDate) {
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    prevDateFilter = `rs.snapshot_date >= date(?, '-${days} days') AND rs.snapshot_date < ?`;
    params.push(startDate, startDate);
  } else {
    return map;
  }

  let where = prevDateFilter;
  if (isAiDrama) {
    where += ' AND d.is_ai_drama = ?';
    params.push(isAiDrama);
  }

  const sql = `
    SELECT rs.playlet_id, rs.platform, MAX(rs.heat_value) as heat_value
    FROM ranking_snapshot rs
    LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
    WHERE ${where}
    GROUP BY rs.playlet_id, rs.platform
  `;

  try {
    const rows = db.prepare(sql).all(...params) as { playlet_id: string; platform: string; heat_value: number }[];
    for (const row of rows) {
      map.set(`${row.playlet_id}:${row.platform}`, row.heat_value);
    }
  } catch { /* empty */ }
  return map;
}

function getPreviousPeriodOverallRanks(
  db: ReturnType<typeof getDb>,
  isAiDrama: string,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string
) {
  const prevHeatMap = getPreviousHeatValues(db, isAiDrama, mode, latestDate, startDate, endDate);
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

function getInvestTrendSparklines(
  db: ReturnType<typeof getDb>,
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
      const sql = `
        SELECT playlet_id, date, daily_invest_count
        FROM invest_trend
        WHERE playlet_id IN (${placeholders}) AND platform = ?
        ORDER BY date ASC
      `;

      const rows = db.prepare(sql).all(...pids, platform) as {
        playlet_id: string; date: string; daily_invest_count: number;
      }[];

      const grouped = new Map<string, number[]>();
      for (const row of rows) {
        if (!grouped.has(row.playlet_id)) grouped.set(row.playlet_id, []);
        grouped.get(row.playlet_id)!.push(row.daily_invest_count);
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

function getFirstAppearances(db: ReturnType<typeof getDb>): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const rows = db.prepare(
      'SELECT playlet_id, MIN(snapshot_date) as first_date FROM ranking_snapshot GROUP BY playlet_id'
    ).all() as { playlet_id: string; first_date: string }[];
    for (const row of rows) map.set(row.playlet_id, row.first_date);
  } catch { /* empty */ }
  return map;
}

function getBaselineDate(
  db: ReturnType<typeof getDb>,
  mode: string,
  latestDate: string,
  startDate: string,
  endDate: string,
): string | null {
  let sql = '';
  const params: unknown[] = [];

  if (mode === 'today') {
    sql = "SELECT snapshot_date as d FROM ranking_snapshot WHERE snapshot_date = date(?, '-1 day') LIMIT 1";
    params.push(latestDate);
  } else if (mode === 'yesterday') {
    sql = "SELECT snapshot_date as d FROM ranking_snapshot WHERE snapshot_date = date(?, '-2 days') LIMIT 1";
    params.push(latestDate);
  } else if (mode === '7days') {
    sql = "SELECT MAX(snapshot_date) as d FROM ranking_snapshot WHERE snapshot_date <= date(?, '-7 days') AND snapshot_date >= date(?, '-10 days')";
    params.push(latestDate, latestDate);
  } else if (mode === '30days') {
    sql = "SELECT MAX(snapshot_date) as d FROM ranking_snapshot WHERE snapshot_date <= date(?, '-30 days') AND snapshot_date >= date(?, '-34 days')";
    params.push(latestDate, latestDate);
  } else if (mode === 'custom' && startDate && endDate) {
    sql = "SELECT MAX(snapshot_date) as d FROM ranking_snapshot WHERE snapshot_date < ? AND snapshot_date >= date(?, '-4 days')";
    params.push(startDate, startDate);
  } else {
    return null;
  }

  try {
    const row = db.prepare(sql).get(...params) as { d: string | null } | undefined;
    return row?.d || null;
  } catch { return null; }
}

function getHeatValuesOnDate(
  db: ReturnType<typeof getDb>,
  baselineDate: string,
  isAiDrama: string,
): Map<string, number> {
  const map = new Map<string, number>();
  const params: unknown[] = [baselineDate];
  let where = 'rs.snapshot_date = ?';
  if (isAiDrama) { where += ' AND d.is_ai_drama = ?'; params.push(isAiDrama); }

  try {
    const rows = db.prepare(`
      SELECT rs.playlet_id, rs.platform, MAX(rs.heat_value) as heat_value
      FROM ranking_snapshot rs
      LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
      WHERE ${where}
      GROUP BY rs.playlet_id, rs.platform
    `).all(...params) as { playlet_id: string; platform: string; heat_value: number }[];
    for (const row of rows) map.set(`${row.playlet_id}:${row.platform}`, row.heat_value);
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
