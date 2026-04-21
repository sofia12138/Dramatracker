import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getUserFromRequest } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import {
  getAIClient, getAIModel, getSystemPrompt,
  getCachedResult, setCachedResult,
  buildInsightPrompt, buildDramaReviewPrompt,
  buildHotAnalysisPrompt, buildWeeklyReportPrompt,
  type AnalysisType,
} from '@/lib/ai';
import { getSqliteOnlyParts } from '@/lib/db-compat';
import { parseJsonField } from '@/lib/json-field';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  if (!hasPermission(user.role, 'use_ai')) {
    return new Response(JSON.stringify({ error: '没有权限使用AI分析' }), { status: 403 });
  }

  try {
    const { type, params, noCache } = await request.json() as {
      type: AnalysisType;
      params?: Record<string, unknown>;
      noCache?: boolean;
    };

    const db = getDb();
    const cacheKey = `${type}:${getCacheKeySuffix(type, params)}`;

    if (!noCache) {
      const cached = getCachedResult(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ cached: true, content: cached }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const prompt = buildPrompt(db, type, params);
    const client = getAIClient();

    const stream = await client.chat.completions.create({
      model: getAIModel(),
      messages: [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt },
      ],
      stream: true,
    });

    let fullContent = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
            }
          }
          setCachedResult(cacheKey, type, fullContent, type === 'weekly_report' ? 168 : 24);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

function getCacheKeySuffix(type: AnalysisType, params?: Record<string, unknown>): string {
  const weekId = getWeekId();
  switch (type) {
    case 'insight': return weekId;
    case 'drama_review': return `${params?.playletId || ''}`;
    case 'hot_analysis': return weekId;
    case 'weekly_report': return weekId;
    default: return weekId;
  }
}

function getWeekId(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildPrompt(db: ReturnType<typeof getDb>, type: AnalysisType, params?: Record<string, unknown>): string {
  switch (type) {
    case 'insight': return buildInsightData(db);
    case 'drama_review': return buildDramaReviewData(db, params?.playletId as string);
    case 'hot_analysis': return buildHotAnalysisData(db);
    case 'weekly_report': return buildWeeklyReportData(db);
    default: throw new Error(`Unknown analysis type: ${type}`);
  }
}

function buildInsightData(db: ReturnType<typeof getDb>): string {
  const { reviewJoin, isAiCol } = getSqliteOnlyParts();
  const latestDate = (db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string })?.d || '';
  const weekStart = getWeekStart(latestDate);

  const topDramas = db.prepare(`
    SELECT d.title, rs.platform, MAX(rs.heat_value) as heat
    FROM ranking_snapshot rs
    INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ? AND ${isAiCol} IN ('ai_real','ai_manga')
    GROUP BY d.playlet_id, rs.platform
    ORDER BY heat DESC LIMIT 10
  `).all(weekStart) as { title: string; platform: string; heat: number }[];

  const topHeatGrowth = db.prepare(`
    SELECT d.title, rs.platform,
      MAX(rs.heat_value) - COALESCE((
        SELECT MAX(heat_value) FROM ranking_snapshot
        WHERE playlet_id = rs.playlet_id AND platform = rs.platform AND snapshot_date < ?
      ), 0) as increment
    FROM ranking_snapshot rs
    INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ?
      AND ${isAiCol} IN ('ai_real', 'ai_manga')
    GROUP BY rs.playlet_id, rs.platform
    ORDER BY increment DESC LIMIT 5
  `).all(weekStart, weekStart) as { title: string; platform: string; increment: number }[];

  const newCount = (db.prepare(`
    SELECT COUNT(DISTINCT rs.playlet_id) as c
    FROM ranking_snapshot rs
    INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ?
      AND ${isAiCol} IN ('ai_real', 'ai_manga')
      AND rs.playlet_id NOT IN (
        SELECT DISTINCT playlet_id FROM ranking_snapshot WHERE snapshot_date < ?
      )
  `).get(weekStart, weekStart) as { c: number }).c;

  const tagRows = db.prepare(`
    SELECT d.tags FROM drama d
    INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ? AND ${isAiCol} IN ('ai_real','ai_manga') AND d.tags != '[]'
    GROUP BY d.playlet_id
  `).all(weekStart) as { tags: string }[];

  const tagMap = new Map<string, number>();
  for (const r of tagRows) {
    for (const t of parseJsonField<string[]>(r.tags, [])) {
      if (t) tagMap.set(t, (tagMap.get(t) || 0) + 1);
    }
  }
  const tagDistribution = Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

  const langDistribution = db.prepare(`
    SELECT d.language, COUNT(DISTINCT d.playlet_id) as cnt
    FROM drama d INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ? AND ${isAiCol} IN ('ai_real','ai_manga') AND d.language IS NOT NULL
    GROUP BY d.language ORDER BY cnt DESC
  `).all(weekStart) as { language: string; cnt: number }[];

  return buildInsightPrompt({
    topDramas, topHeatGrowth, newCount, tagDistribution,
    langDistribution: langDistribution.map(l => ({ language: l.language, count: l.cnt })),
  });
}

function buildDramaReviewData(db: ReturnType<typeof getDb>, playletId: string): string {
  const drama = db.prepare('SELECT * FROM drama WHERE playlet_id = ?').get(playletId) as {
    title: string; description: string; tags: string; language: string;
  } | undefined;

  if (!drama) throw new Error('剧集不存在');

  const stats = db.prepare(`
    SELECT MAX(heat_value) as heat, MAX(invest_days) as days
    FROM ranking_snapshot WHERE playlet_id = ?
  `).get(playletId) as { heat: number; days: number };

  const tags = parseJsonField<string[]>(drama.tags, []);

  return buildDramaReviewPrompt({
    title: drama.title,
    description: drama.description || '',
    tags,
    heatValue: stats?.heat || 0,
    investDays: stats?.days || 0,
    language: drama.language || '',
  });
}

function buildHotAnalysisData(db: ReturnType<typeof getDb>): string {
  const { reviewJoin, isAiCol } = getSqliteOnlyParts();
  const latestDate = (db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string })?.d || '';
  const weekStart = getWeekStart(latestDate);

  const rows = db.prepare(`
    SELECT d.title, d.tags, d.language,
      MAX(rs.invest_days) as investDays,
      MAX(rs.heat_value) - COALESCE((
        SELECT MAX(heat_value) FROM ranking_snapshot
        WHERE playlet_id = rs.playlet_id AND snapshot_date < ?
      ), 0) as heatIncrement
    FROM ranking_snapshot rs
    INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE ${isAiCol} IN ('ai_real','ai_manga')
    GROUP BY d.playlet_id
    ORDER BY MAX(rs.heat_value) DESC
    LIMIT 20
  `).all(weekStart) as { title: string; tags: string; language: string; investDays: number; heatIncrement: number }[];

  return buildHotAnalysisPrompt({
    topDramas: rows.map(r => {
      const tags = parseJsonField<string[]>(r.tags, []);
      return { title: r.title, tags, language: r.language || 'Unknown', investDays: r.investDays, heatIncrement: r.heatIncrement };
    }),
  });
}

function buildWeeklyReportData(db: ReturnType<typeof getDb>): string {
  const { reviewJoin, isAiCol } = getSqliteOnlyParts();
  const latestDate = (db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string })?.d || '';
  const weekStart = getWeekStart(latestDate);
  const prevWeekStart = getOffsetDate(weekStart, -7);
  const prevWeekEnd = getOffsetDate(weekStart, -1);
  const PLATFORMS = (db.prepare("SELECT name FROM platforms WHERE is_active = 1 ORDER BY id").all() as { name: string }[]).map(r => r.name);

  const getWeekTop = (start: string, end: string) => PLATFORMS.map(p => {
    const dramas = db.prepare(`
      SELECT d.title, MIN(rs.rank) as rank, MAX(rs.heat_value) as heat
      FROM ranking_snapshot rs INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      ${reviewJoin}
      WHERE rs.platform = ? AND rs.snapshot_date >= ? AND rs.snapshot_date <= ?
        AND ${isAiCol} IN ('ai_real', 'ai_manga')
      GROUP BY d.playlet_id ORDER BY rank ASC LIMIT 5
    `).all(p, start, end) as { title: string; rank: number; heat: number }[];
    return { platform: p, topDramas: dramas };
  });

  const thisWeek = getWeekTop(weekStart, latestDate);
  const lastWeek = getWeekTop(prevWeekStart, prevWeekEnd);

  const newHits = db.prepare(`
    SELECT d.title, rs.platform, MAX(rs.heat_value) as heat
    FROM ranking_snapshot rs INNER JOIN drama d ON rs.playlet_id = d.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ?
      AND ${isAiCol} IN ('ai_real', 'ai_manga')
      AND rs.playlet_id NOT IN (
        SELECT DISTINCT playlet_id FROM ranking_snapshot WHERE snapshot_date < ?
      )
    GROUP BY d.playlet_id ORDER BY heat DESC LIMIT 5
  `).all(weekStart, weekStart) as { title: string; platform: string; heat: number }[];

  const getTagCounts = (start: string, end: string) => {
    const rows = db.prepare(`
      SELECT d.tags FROM drama d INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
      ${reviewJoin}
      WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ? AND ${isAiCol} IN ('ai_real','ai_manga') AND d.tags != '[]'
      GROUP BY d.playlet_id
    `).all(start, end) as { tags: string }[];
    const m = new Map<string, number>();
    for (const r of rows) {
      for (const t of parseJsonField<string[]>(r.tags, [])) {
        if (t) m.set(t, (m.get(t) || 0) + 1);
      }
    }
    return m;
  };

  const thisTagMap = getTagCounts(weekStart, latestDate);
  const lastTagMap = getTagCounts(prevWeekStart, prevWeekEnd);
  const allTags = new Set([...Array.from(thisTagMap.keys()), ...Array.from(lastTagMap.keys())]);
  const tagTrend = Array.from(allTags).map(t => ({
    tag: t, thisWeek: thisTagMap.get(t) || 0, lastWeek: lastTagMap.get(t) || 0,
  })).sort((a, b) => b.thisWeek - a.thisWeek).slice(0, 10);

  const getLangCounts = (start: string, end: string) => db.prepare(`
    SELECT d.language, COUNT(DISTINCT d.playlet_id) as cnt
    FROM drama d INNER JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
    ${reviewJoin}
    WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ? AND ${isAiCol} IN ('ai_real','ai_manga') AND d.language IS NOT NULL
    GROUP BY d.language
  `).all(start, end) as { language: string; cnt: number }[];

  const thisLang = getLangCounts(weekStart, latestDate);
  const lastLang = getLangCounts(prevWeekStart, prevWeekEnd);
  const langTrend = thisLang.map(l => ({
    language: l.language,
    thisWeek: l.cnt,
    lastWeek: lastLang.find(x => x.language === l.language)?.cnt || 0,
  }));

  return buildWeeklyReportPrompt({ thisWeek, lastWeek, newHits, tagTrend, langTrend });
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr || new Date().toISOString().slice(0, 10));
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

function getOffsetDate(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
