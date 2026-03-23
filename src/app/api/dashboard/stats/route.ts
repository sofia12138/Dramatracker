import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const PLATFORMS = ['ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel'];

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'today';
    const startDate = searchParams.get('start_date') || '';
    const endDate = searchParams.get('end_date') || '';

    const latestRow = db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string | null };
    const latestDate = latestRow?.d || new Date().toISOString().slice(0, 10);

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
    const platformCount = (db.prepare('SELECT COUNT(*) as c FROM platforms WHERE is_active = 1').get() as { c: number }).c;
    const aiRealCount = (db.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama = 'ai_real'").get() as { c: number }).c;
    const aiMangaCount = (db.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama = 'ai_manga'").get() as { c: number }).c;

    const weekStart = getWeekStart(latestDate);
    const newThisWeek = (db.prepare(`
      SELECT COUNT(DISTINCT rs.playlet_id) as c
      FROM ranking_snapshot rs
      WHERE rs.snapshot_date >= ?
        AND rs.playlet_id NOT IN (
          SELECT DISTINCT playlet_id FROM ranking_snapshot WHERE snapshot_date < ?
        )
    `).get(weekStart, weekStart) as { c: number }).c;

    const topHeatRow = db.prepare(`
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

    // === Chart 1: Platform AI drama count ===
    const platformAiRows = db.prepare(`
      SELECT rs.platform,
        d.is_ai_drama,
        COUNT(DISTINCT d.playlet_id) as cnt
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
        AND d.is_ai_drama IN ('ai_real', 'ai_manga')
      GROUP BY rs.platform, d.is_ai_drama
    `).all(dateFrom, dateTo) as { platform: string; is_ai_drama: string; cnt: number }[];

    const platformAiCount = PLATFORMS.map(p => {
      const aiReal = platformAiRows.find(r => r.platform === p && r.is_ai_drama === 'ai_real')?.cnt || 0;
      const aiManga = platformAiRows.find(r => r.platform === p && r.is_ai_drama === 'ai_manga')?.cnt || 0;
      return { platform: p, ai_real: aiReal, ai_manga: aiManga };
    });

    // === Chart 2: Language distribution ===
    const langRows = db.prepare(`
      SELECT d.language, COUNT(DISTINCT d.playlet_id) as cnt
      FROM drama d
      INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
        AND d.is_ai_drama IN ('ai_real', 'ai_manga')
        AND d.language IS NOT NULL AND d.language != ''
      GROUP BY d.language
      ORDER BY cnt DESC
    `).all(dateFrom, dateTo) as { language: string; cnt: number }[];

    // === Chart 3: Tag distribution (top 10) ===
    const tagDramas = db.prepare(`
      SELECT DISTINCT d.tags
      FROM drama d
      INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
        AND d.is_ai_drama IN ('ai_real', 'ai_manga')
        AND d.tags IS NOT NULL AND d.tags != '[]'
    `).all(dateFrom, dateTo) as { tags: string }[];

    const tagCount = new Map<string, number>();
    for (const row of tagDramas) {
      try {
        const tags: string[] = JSON.parse(row.tags);
        for (const tag of tags) {
          if (tag) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        }
      } catch { /* skip */ }
    }
    const tagDistribution = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    // === Chart 4: Weekly heat growth by platform (last 8 weeks) ===
    const weeks = getRecentWeeks(latestDate, 8);
    const weeklyHeatGrowth: Record<string, Record<string, number>>[] = [];

    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      const entry: Record<string, number> = {};
      for (const p of PLATFORMS) {
        const curHeat = db.prepare(`
          SELECT COALESCE(SUM(heat_value), 0) as h
          FROM ranking_snapshot
          WHERE platform = ? AND snapshot_date >= ? AND snapshot_date <= ?
        `).get(p, w.start, w.end) as { h: number };

        let prevH = 0;
        if (i > 0) {
          const pw = weeks[i - 1];
          prevH = (db.prepare(`
            SELECT COALESCE(SUM(heat_value), 0) as h
            FROM ranking_snapshot
            WHERE platform = ? AND snapshot_date >= ? AND snapshot_date <= ?
          `).get(p, pw.start, pw.end) as { h: number }).h;
        }
        entry[p] = curHeat.h - prevH;
      }
      weeklyHeatGrowth.push({ week: { label: w.label, ...entry } } as unknown as Record<string, Record<string, number>>);
    }

    const weeklyData = weeks.slice(1).map((w, i) => {
      const idx = i + 1;
      const result: Record<string, unknown> = { week: w.label };
      for (const p of PLATFORMS) {
        const curHeat = (db.prepare(`
          SELECT COALESCE(SUM(heat_value), 0) as h
          FROM ranking_snapshot
          WHERE platform = ? AND snapshot_date >= ? AND snapshot_date <= ?
        `).get(p, w.start, w.end) as { h: number }).h;

        const prevW = weeks[idx - 1];
        const prevHeat = (db.prepare(`
          SELECT COALESCE(SUM(heat_value), 0) as h
          FROM ranking_snapshot
          WHERE platform = ? AND snapshot_date >= ? AND snapshot_date <= ?
        `).get(p, prevW.start, prevW.end) as { h: number }).h;

        result[p] = curHeat - prevHeat;
      }
      return result;
    });

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
      weeklyHeatGrowth: weeklyData,
      latestDate,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
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
