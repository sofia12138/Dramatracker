import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isMysqlMode, query as mysqlQuery } from '@/lib/mysql';
import {
  countDramasByType,
  queryPlatformAiCount,
  queryLanguageDistribution,
  queryTagsByAiType,
  queryHeatGrowthTop5,
} from '@/lib/db-compat';
import { parseJsonField } from '@/lib/json-field';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const useMysql = isMysqlMode();

    // platforms 表：MySQL/SQLite 列名相同（id/name/is_active），同一 SQL 即可
    const PLATFORMS = useMysql
      ? (await mysqlQuery<{ name: string }>(
          "SELECT name FROM platforms WHERE is_active = 1 ORDER BY id"
        )).map(r => r.name)
      : (db.prepare("SELECT name FROM platforms WHERE is_active = 1 ORDER BY id").all() as { name: string }[]).map(r => r.name);

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'today';
    const startDate = searchParams.get('start_date') || '';
    const endDate = searchParams.get('end_date') || '';

    // ranking_snapshot：MySQL 用 date_key，SQLite 用 snapshot_date
    let latestDate: string;
    if (useMysql) {
      const [mysqlLatest] = await mysqlQuery<{ d: string | null }>(
        "SELECT DATE_FORMAT(MAX(date_key), '%Y-%m-%d') as d FROM ranking_snapshot"
      );
      latestDate = mysqlLatest?.d || new Date().toISOString().slice(0, 10);
    } else {
      const latestRow = db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string | null };
      latestDate = latestRow?.d || new Date().toISOString().slice(0, 10);
    }

    let dateFrom = latestDate;
    let dateTo = latestDate;

    if (mode === '7days') {
      dateFrom = getOffsetDate(latestDate, -6);
    } else if (mode === '30days') {
      dateFrom = getOffsetDate(latestDate, -29);
    } else if (mode === 'custom' && startDate && endDate) {
      dateFrom = startDate;
      dateTo = endDate;
    }

    // === Overview cards ===
    const platformCount = useMysql
      ? Number(((await mysqlQuery<{ c: number | string }>(
          'SELECT COUNT(*) as c FROM platforms WHERE is_active = 1'
        ))[0]?.c) || 0)
      : (db.prepare('SELECT COUNT(*) as c FROM platforms WHERE is_active = 1').get() as { c: number }).c;
    // is_ai_drama 路由到 drama_review（MySQL）或 drama（SQLite）
    const [aiRealCount, aiMangaCount] = await Promise.all([
      countDramasByType('ai_real'),
      countDramasByType('ai_manga'),
    ]);

    const weekStart = getWeekStart(latestDate);
    let newThisWeek: number;
    if (useMysql) {
      const rows = await mysqlQuery<{ c: number | string }>(
        `SELECT COUNT(DISTINCT rs.playlet_id) as c
         FROM ranking_snapshot rs
         WHERE rs.date_key >= ?
           AND rs.playlet_id NOT IN (
             SELECT DISTINCT playlet_id FROM ranking_snapshot WHERE date_key < ?
           )`,
        [weekStart, weekStart]
      );
      newThisWeek = Number(rows[0]?.c || 0);
    } else {
      newThisWeek = (db.prepare(`
        SELECT COUNT(DISTINCT rs.playlet_id) as c
        FROM ranking_snapshot rs
        WHERE rs.snapshot_date >= ?
          AND rs.playlet_id NOT IN (
            SELECT DISTINCT playlet_id FROM ranking_snapshot WHERE snapshot_date < ?
          )
      `).get(weekStart, weekStart) as { c: number }).c;
    }

    let topHeatRow: { title: string; increment: number } | undefined;
    if (useMysql) {
      const rows = await mysqlQuery<{ title: string; increment: number | string }>(
        `SELECT d.title,
                COALESCE(cur.heat, 0) - COALESCE(prev.heat, 0) as increment
         FROM drama d
         LEFT JOIN (
           SELECT playlet_id, MAX(heat_value) as heat
           FROM ranking_snapshot WHERE date_key >= ?
           GROUP BY playlet_id
         ) cur ON d.playlet_id = cur.playlet_id
         LEFT JOIN (
           SELECT playlet_id, MAX(heat_value) as heat
           FROM ranking_snapshot WHERE date_key < ?
           GROUP BY playlet_id
         ) prev ON d.playlet_id = prev.playlet_id
         WHERE cur.heat IS NOT NULL
         ORDER BY increment DESC
         LIMIT 1`,
        [weekStart, weekStart]
      );
      const r = rows[0];
      topHeatRow = r ? { title: r.title, increment: Number(r.increment) } : undefined;
    } else {
      topHeatRow = db.prepare(`
        SELECT d.title,
          COALESCE(cur.heat, 0) - COALESCE(prev.heat, 0) as increment
        FROM drama d
        LEFT JOIN (
          SELECT playlet_id, MAX(heat_value) as heat
          FROM ranking_snapshot WHERE snapshot_date >= ?
          GROUP BY playlet_id
        ) cur ON d.playlet_id = cur.playlet_id
        LEFT JOIN (
          SELECT playlet_id, MAX(heat_value) as heat
          FROM ranking_snapshot WHERE snapshot_date < ?
          GROUP BY playlet_id
        ) prev ON d.playlet_id = prev.playlet_id
        WHERE cur.heat IS NOT NULL
        ORDER BY increment DESC
        LIMIT 1
      `).get(weekStart, weekStart) as { title: string; increment: number } | undefined;
    }

    // === Chart 1: Platform AI drama count（兼容 drama_review）===
    const platformAiRows = await queryPlatformAiCount({ dateFrom, dateTo });

    const platformAiCount = PLATFORMS.map(p => {
      const aiReal = platformAiRows.find(r => r.platform === p && r.is_ai_drama === 'ai_real')?.cnt || 0;
      const aiManga = platformAiRows.find(r => r.platform === p && r.is_ai_drama === 'ai_manga')?.cnt || 0;
      return { platform: p, ai_real: aiReal, ai_manga: aiManga };
    });

    // === Chart 2: Language distribution（兼容 drama_review）===
    const langRows = await queryLanguageDistribution({ dateFrom, dateTo });

    // === Chart 3: Tag distribution by type（兼容 drama_review）===
    const getTagsByType = async (aiType: string): Promise<{ tag: string; count: number }[]> => {
      const rows = await queryTagsByAiType({ dateFrom, dateTo, aiType });

      const m = new Map<string, number>();
      for (const row of rows) {
        for (const t of parseJsonField<string[]>(row.tags, [])) {
          if (t) m.set(t, (m.get(t) || 0) + 1);
        }
      }
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count }));
    };

    const tagDistribution = {
      ai_real:  await getTagsByType('ai_real'),
      ai_comic: await getTagsByType('ai_manga'),
    };

    // combined for backward compat
    const allTags = new Map<string, number>();
    for (const list of [tagDistribution.ai_real, tagDistribution.ai_comic]) {
      for (const t of list) allTags.set(t.tag, (allTags.get(t.tag) || 0) + t.count);
    }
    const tagDistributionFlat = Array.from(allTags.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

    // === Chart 4: Weekly heat growth by platform (last 8 weeks) ===
    // 一次性拉出所有 weeks 覆盖范围内 (platform, date) 的 heat 之和，
    // 在 Node 内做按周分桶，避免 N×M 串行小查询（SSH tunnel 下会超时）
    const weeks = getRecentWeeks(latestDate, 8);
    const minStart = weeks[0].start;
    const maxEnd = weeks[weeks.length - 1].end;

    type DailyRow = { platform: string; d: string; h: number };
    let dailyRows: DailyRow[];
    if (useMysql) {
      const raw = await mysqlQuery<{ platform: string; d: string; h: number | string }>(
        `SELECT platform,
                DATE_FORMAT(date_key, '%Y-%m-%d') AS d,
                SUM(heat_value) AS h
         FROM ranking_snapshot
         WHERE date_key >= ? AND date_key <= ?
         GROUP BY platform, date_key`,
        [minStart, maxEnd]
      );
      dailyRows = raw.map(r => ({ platform: r.platform, d: r.d, h: Number(r.h || 0) }));
    } else {
      const raw = db.prepare(
        `SELECT platform, snapshot_date AS d, SUM(heat_value) AS h
         FROM ranking_snapshot
         WHERE snapshot_date >= ? AND snapshot_date <= ?
         GROUP BY platform, snapshot_date`
      ).all(minStart, maxEnd) as Array<{ platform: string; d: string; h: number }>;
      dailyRows = raw.map(r => ({ platform: r.platform, d: r.d, h: Number(r.h || 0) }));
    }

    // 按 (platform, weekIdx) 累加
    const weekTotals = new Map<string, Map<number, number>>();
    for (const row of dailyRows) {
      for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        if (row.d >= w.start && row.d <= w.end) {
          if (!weekTotals.has(row.platform)) weekTotals.set(row.platform, new Map());
          const m = weekTotals.get(row.platform)!;
          m.set(i, (m.get(i) || 0) + row.h);
          break;
        }
      }
    }
    const sumWeek = (platformName: string, weekIdx: number): number =>
      weekTotals.get(platformName)?.get(weekIdx) || 0;

    const weeklyHeatGrowth: Record<string, Record<string, number>>[] = [];
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      const entry: Record<string, number> = {};
      for (const p of PLATFORMS) {
        const curH = sumWeek(p, i);
        const prevH = i > 0 ? sumWeek(p, i - 1) : 0;
        entry[p] = curH - prevH;
      }
      weeklyHeatGrowth.push({ week: { label: w.label, ...entry } } as unknown as Record<string, Record<string, number>>);
    }

    const weeklyData: Record<string, unknown>[] = [];
    for (let j = 0; j < weeks.length - 1; j++) {
      const w = weeks[j + 1];
      const result: Record<string, unknown> = { week: w.label };
      for (const p of PLATFORMS) {
        result[p] = sumWeek(p, j + 1) - sumWeek(p, j);
      }
      weeklyData.push(result);
    }

    // === Heat growth Top5（兼容 drama_review）===
    const heatGrowthTop5 = await queryHeatGrowthTop5({ dateFrom, dateTo });

    const heatTop5 = heatGrowthTop5.map(r => ({
      title: r.title,
      growth_rate: r.prev_heat > 0 ? Math.round(((r.cur_heat - r.prev_heat) / r.prev_heat) * 100) : 0,
      increment: r.increment,
    }));

    return NextResponse.json({
      overview: {
        platformCount,
        aiDramaTotal: aiRealCount + aiMangaCount,
        aiRealCount,
        aiMangaCount,
        newThisWeek,
        topHeatGrowth: topHeatRow ? { title: topHeatRow.title, increment: topHeatRow.increment } : null,
      },
      platformAiCount,
      languageDistribution: langRows.map(r => ({ language: r.language, count: r.cnt })),
      tagDistribution,
      tagDistributionFlat,
      weeklyHeatGrowth: weeklyData,
      heatTop5,
      latestDate,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('[dashboard/stats] ERROR:', message, '\n', stack);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getOffsetDate(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function getRecentWeeks(latestDate: string, count: number): { start: string; end: string; label: string }[] {
  const weeks: { start: string; end: string; label: string }[] = [];
  const endD = new Date(latestDate);
  const day = endD.getDay();
  const lastSunday = new Date(endD);
  lastSunday.setDate(endD.getDate() - (day === 0 ? 0 : day));

  for (let i = 0; i < count; i++) {
    const wEnd = new Date(lastSunday);
    wEnd.setDate(lastSunday.getDate() - i * 7);
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);

    const label = `${(wStart.getMonth() + 1).toString().padStart(2, '0')}/${wStart.getDate().toString().padStart(2, '0')}`;
    weeks.unshift({
      start: wStart.toISOString().slice(0, 10),
      end: wEnd.toISOString().slice(0, 10),
      label,
    });
  }
  return weeks;
}
