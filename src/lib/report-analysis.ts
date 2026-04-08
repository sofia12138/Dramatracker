/**
 * report-analysis.ts
 * 统一报告分析层 —— 供爆款分析 / 洞察识别两种报告共用。
 *
 * 分析主对象：AI真人剧（ai_real）+ AI漫剧（ai_manga）双赛道。
 * 未分类数据（is_ai_drama = NULL）不纳入主分析，仅在数据说明中提示数量。
 * 所有查询严格基于调用方传入的 startDate / endDate，禁止 fallback。
 *
 * 两类报告定位不同：
 *   爆款分析 → 识别"哪些内容跑出来了、为什么"，聚焦爆款内容特征
 *   洞察识别 → 识别"市场在发生什么、机会在哪里"，聚焦赛道趋势与结构变化
 */
import { getDb } from './db';

// ─── 对外类型 ──────────────────────────────────────────────────────────────────

export interface ReportFilters {
  startDate: string;
  endDate: string;
  platform?: string;   // 具体平台名 | '' | 'all' = 不过滤
  dramaType?: string;  // 'ai_real' | 'ai_manga' | '' | 'all' = 两者都分析
}

export interface ReportMeta {
  title: string;
  generatedAt: string;
  startDate: string;
  endDate: string;
  filterSummary: string[];
}

export interface TopDramaItem {
  dramaId: string;
  title: string;
  platform: string;
  currentRank: number | null;
  bestRank: number | null;
  heatValue: number | null;
  heatIncrement: number | null;
  firstSeenDate: string | null;
  firstAirDate: string | null;
  isNew: boolean;
  tags: string[];
  reasons: string[];
  sampleWarning: string | null;
  language: string;
  dramaType: string;
}

export interface DistributionItem {
  name: string;
  value: number;
  ratio: number;   // 百分比 0-100
}

export interface ReportMetrics {
  dramaCount: number;
  activePlatformCount: number;
  newDramaCount: number;
  hitDramaCount: number;
  avgHeat: number | null;
  topHeat: number | null;
}

/** 单赛道分析结果 */
export interface TrackAnalysis {
  label: string;                        // 'AI真人剧' | 'AI漫剧'
  dramaType: 'ai_real' | 'ai_manga';
  metrics: ReportMetrics;
  topDramas: TopDramaItem[];
  platformDistribution: DistributionItem[];
  genreDistribution: DistributionItem[];
  /** 爆款分析专用：内容爆款规律结论（面向内容打法） */
  hotPatterns: string[];
  /** 洞察识别专用：市场趋势与结构判断 */
  marketInsights: string[];
  opportunities: string[];
  risks: string[];
  empty: boolean;
}

export interface ReportData {
  meta: ReportMeta;
  reportType: 'hot' | 'market';

  // 双赛道数据（null 表示该赛道被筛选条件排除）
  aiReal: TrackAnalysis | null;
  aiManga: TrackAnalysis | null;

  /** 未纳入主分析的未分类剧集数量 */
  unclassifiedCount: number;

  /** 双赛道对比结论 */
  crossTrackComparison: string[];

  // 综合摘要与指标（合并双赛道，兼容 HTML/DOCX 渲染）
  summary: string[];
  metrics: ReportMetrics;
  topDramas: TopDramaItem[];
  platformDistribution: DistributionItem[];
  genreDistribution: DistributionItem[];
  opportunities: string[];
  risks: string[];
  methodology: string[];
  comparison: {
    previousStartDate: string;
    previousEndDate: string;
    summary: string[];
  } | null;
  empty: boolean;
}

// ─── 内部类型 ──────────────────────────────────────────────────────────────────

interface RawRow {
  playlet_id: string;
  platform: string;
  rank: number;
  heat_value: number;
  material_count: number;
  invest_days: number;
  snapshot_date: string;
  title: string | null;
  language: string | null;
  is_ai_drama: string | null;
  tags: string | null;
  genre_tags_manual: string | null;
  genre_tags_ai: string | null;
  first_air_date: string | null;
}

interface DramaStat {
  playlet_id: string;
  title: string;
  language: string;
  dramaType: string;
  bestPlatform: string;
  allPlatforms: string[];
  currentRank: number | null;
  bestRank: number;
  latestHeat: number;
  earliestHeat: number;
  heatIncrement: number | null;
  firstSeenDate: string | null;
  firstAirDate: string | null;
  isNew: boolean;
  tags: string[];
  sampleDays: number;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string');
    // 兼容 {systemTags: {category: [tag,...]}, customTags: [...]} 格式
    if (parsed && typeof parsed === 'object') {
      const result: string[] = [];
      if (parsed.customTags && Array.isArray(parsed.customTags)) result.push(...parsed.customTags);
      if (parsed.systemTags && typeof parsed.systemTags === 'object') {
        for (const tags of Object.values(parsed.systemTags)) {
          if (Array.isArray(tags)) result.push(...(tags as string[]));
        }
      }
      return result.filter((t): t is string => typeof t === 'string');
    }
  } catch { /* ignore */ }
  return [];
}

function getEffectiveTags(row: RawRow): string[] {
  const manual = parseTags(row.genre_tags_manual);
  if (manual.length > 0) return manual;
  const ai = parseTags(row.genre_tags_ai);
  if (ai.length > 0) return ai;
  return parseTags(row.tags);
}

export function formatHeatNum(v: number): string {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return Math.round(v).toLocaleString();
}

function getTopTags(dramas: DramaStat[], n: number): string[] {
  const cnt = new Map<string, number>();
  for (const d of dramas)
    for (const t of d.tags) if (t) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  return Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

// ─── 对比周期计算 ──────────────────────────────────────────────────────────────

export function getPreviousPeriodRange(startDate: string, endDate: string) {
  const s = new Date(startDate + 'T00:00:00Z');
  const e = new Date(endDate + 'T00:00:00Z');
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const prevEnd = new Date(s);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);
  return {
    previousStartDate: prevStart.toISOString().slice(0, 10),
    previousEndDate: prevEnd.toISOString().slice(0, 10),
  };
}

// ─── 原始数据查询 ──────────────────────────────────────────────────────────────

/**
 * 查询已分类数据（ai_real + ai_manga），并统计未分类数量。
 * dramaType 为 'ai_real' 或 'ai_manga' 时只返回该类型；否则返回两类全部。
 */
function getClassifiedRows(filters: ReportFilters): { rows: RawRow[]; unclassifiedCount: number } {
  const db = getDb();
  const params: (string | number)[] = [filters.startDate, filters.endDate];
  let platformClause = '';
  if (filters.platform && filters.platform !== 'all') {
    platformClause = ' AND rs.platform = ?';
    params.push(filters.platform);
  }

  const dt = filters.dramaType;
  let typeClause = "AND d.is_ai_drama IN ('ai_real', 'ai_manga')";
  if (dt === 'ai_real') typeClause = "AND d.is_ai_drama = 'ai_real'";
  else if (dt === 'ai_manga') typeClause = "AND d.is_ai_drama = 'ai_manga'";

  const rows = db.prepare(`
    SELECT rs.playlet_id, rs.platform, rs.rank, rs.heat_value,
           rs.material_count, rs.invest_days, rs.snapshot_date,
           d.title, d.language, d.is_ai_drama,
           d.tags, d.genre_tags_manual, d.genre_tags_ai, d.first_air_date
    FROM ranking_snapshot rs
    LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
    WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
    ${platformClause}
    ${typeClause}
    ORDER BY rs.snapshot_date ASC, rs.heat_value DESC
  `).all(...params) as RawRow[];

  // 统计未分类
  const uncParams: (string | number)[] = [filters.startDate, filters.endDate];
  if (filters.platform && filters.platform !== 'all') uncParams.push(filters.platform);
  const uncRow = db.prepare(`
    SELECT COUNT(DISTINCT rs.playlet_id) as cnt
    FROM ranking_snapshot rs
    LEFT JOIN drama d ON rs.playlet_id = d.playlet_id
    WHERE rs.snapshot_date >= ? AND rs.snapshot_date <= ?
    ${platformClause}
    AND (d.is_ai_drama IS NULL OR d.is_ai_drama NOT IN ('ai_real', 'ai_manga'))
  `).get(...uncParams) as { cnt: number };
  const unclassifiedCount = uncRow?.cnt ?? 0;

  return { rows, unclassifiedCount };
}

function getFirstSeenMap(): Map<string, string> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT playlet_id, MIN(snapshot_date) as first_date FROM ranking_snapshot GROUP BY playlet_id'
  ).all() as { playlet_id: string; first_date: string }[];
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.playlet_id, r.first_date);
  return m;
}

// ─── 窗口内指标计算 ────────────────────────────────────────────────────────────

export function calculateDramaWindowMetrics(
  rows: RawRow[],
  filters: ReportFilters,
  firstSeenMap: Map<string, string>,
): DramaStat[] {
  type Entry = {
    rows: RawRow[];
    dates: Set<string>;
    heatByDate: Map<string, number>;
    rankByDate: Map<string, number>;
    platforms: Set<string>;
  };

  const grouped = new Map<string, Entry>();
  for (const row of rows) {
    if (!row.title) continue;
    let e = grouped.get(row.playlet_id);
    if (!e) {
      e = { rows: [], dates: new Set(), heatByDate: new Map(), rankByDate: new Map(), platforms: new Set() };
      grouped.set(row.playlet_id, e);
    }
    e.rows.push(row);
    e.dates.add(row.snapshot_date);
    e.platforms.add(row.platform);
    const ph = e.heatByDate.get(row.snapshot_date) ?? -Infinity;
    if (row.heat_value > ph) e.heatByDate.set(row.snapshot_date, row.heat_value);
    const pr = e.rankByDate.get(row.snapshot_date) ?? Infinity;
    if (row.rank < pr) e.rankByDate.set(row.snapshot_date, row.rank);
  }

  const result: DramaStat[] = [];
  for (const [id, e] of Array.from(grouped)) {
    const sortedDates = Array.from(e.dates).sort();
    const sampleDays = sortedDates.length;
    const earliest = sortedDates[0];
    const latest = sortedDates[sortedDates.length - 1];
    const earliestHeat = e.heatByDate.get(earliest) ?? 0;
    const latestHeat = e.heatByDate.get(latest) ?? 0;
    const heatIncrement = sampleDays > 1 ? latestHeat - earliestHeat : null;
    const bestRank = Math.min(...Array.from(e.rankByDate.values()));
    const currentRank = e.rankByDate.get(filters.endDate) ?? e.rankByDate.get(latest) ?? null;
    const repRow = e.rows.filter(r => r.snapshot_date === latest).sort((a, b) => b.heat_value - a.heat_value)[0] ?? e.rows[0];
    const firstSeenDate = firstSeenMap.get(id) ?? null;
    const firstAirDate = repRow?.first_air_date ?? null;
    const isNew =
      (!!firstAirDate && firstAirDate >= filters.startDate && firstAirDate <= filters.endDate) ||
      (!!firstSeenDate && firstSeenDate >= filters.startDate && firstSeenDate <= filters.endDate);
    result.push({
      playlet_id: id,
      title: repRow?.title ?? '',
      language: repRow?.language ?? '',
      dramaType: repRow?.is_ai_drama ?? '',
      bestPlatform: repRow?.platform ?? '',
      allPlatforms: Array.from(e.platforms),
      currentRank,
      bestRank,
      latestHeat,
      earliestHeat,
      heatIncrement,
      firstSeenDate,
      firstAirDate,
      isNew,
      tags: getEffectiveTags(repRow ?? e.rows[0]),
      sampleDays,
    });
  }

  return result.sort((a, b) => b.latestHeat - a.latestHeat);
}

// ─── 分布统计 ──────────────────────────────────────────────────────────────────

export function summarizePlatformDistribution(dramas: DramaStat[]): DistributionItem[] {
  const cnt = new Map<string, number>();
  for (const d of dramas)
    for (const p of d.allPlatforms) cnt.set(p, (cnt.get(p) ?? 0) + 1);
  const total = dramas.length;
  return Array.from(cnt.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, ratio: total > 0 ? Math.round(value / total * 100) : 0 }));
}

export function summarizeGenreDistribution(dramas: DramaStat[]): DistributionItem[] {
  const cnt = new Map<string, number>();
  for (const d of dramas)
    for (const t of d.tags) if (t) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  const total = dramas.length;
  return Array.from(cnt.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, value]) => ({ name, value, ratio: total > 0 ? Math.round(value / total * 100) : 0 }));
}

// ─── Top 剧集汇总 ──────────────────────────────────────────────────────────────

function buildReasons(d: DramaStat, heatP70: number, incrementP70: number | null): string[] {
  const r: string[] = [];
  if (d.bestRank <= 3) r.push('排名进入头部 Top3');
  else if (d.bestRank <= 10) r.push('排名进入头部 Top10');
  if (d.latestHeat >= heatP70) r.push('热力值处于窗口内前30%');
  if (d.heatIncrement !== null && incrementP70 !== null && d.heatIncrement >= incrementP70)
    r.push(`窗口内热力增量 +${formatHeatNum(d.heatIncrement)}`);
  if (d.isNew) r.push('当前窗口新上线/新入榜');
  return r.length > 0 ? r : ['热力值排名靠前'];
}

export function summarizeTopDramas(
  dramas: DramaStat[],
  limit: number,
  heatP70: number,
  incrementP70: number | null,
): TopDramaItem[] {
  return dramas.slice(0, limit).map(d => ({
    dramaId: d.playlet_id,
    title: d.title,
    platform: d.bestPlatform,
    currentRank: d.currentRank,
    bestRank: d.bestRank,
    heatValue: d.latestHeat,
    heatIncrement: d.heatIncrement,
    firstSeenDate: d.firstSeenDate,
    firstAirDate: d.firstAirDate,
    isNew: d.isNew,
    tags: d.tags.slice(0, 4),
    reasons: buildReasons(d, heatP70, incrementP70),
    sampleWarning: d.sampleDays === 1 ? '样本天数不足（仅1天数据）' : null,
    language: d.language,
    dramaType: d.dramaType,
  }));
}

// ─── 爆款分析：单赛道热门内容特征 ────────────────────────────────────────────────

function buildHotPatterns(dramas: DramaStat[], typeName: string): string[] {
  if (dramas.length === 0) return [`${typeName}暂无足够数据`];
  const top10 = dramas.filter(d => d.bestRank <= 10);
  const topTags = getTopTags(dramas, 4);
  const growthDramas = dramas.filter(d => d.heatIncrement !== null && d.heatIncrement > 0);
  const topGrower = growthDramas[0];
  const newDramas = dramas.filter(d => d.isNew);
  const newRatio = Math.round(newDramas.length / dramas.length * 100);
  const multiPlatform = dramas.filter(d => d.allPlatforms.length > 1);

  const patterns: string[] = [];

  if (top10.length > 0) {
    const titles = top10.slice(0, 3).map(d => `《${d.title}》`).join('、');
    patterns.push(`代表性强势剧目：${titles}（均达 Top10），热力值领先`);
  }

  if (topTags.length > 0) {
    const tagStr = topTags.map(t => `"${t}"`).join('、');
    patterns.push(`高频题材标签集中在 ${tagStr}，${topTags.length <= 2 ? '内容选题高度集中，同类竞品密集' : '题材覆盖较多方向，头部内容分散'}`);
  }

  if (topGrower && topGrower.heatIncrement !== null && topGrower.heatIncrement > 0) {
    patterns.push(`增速最快：《${topGrower.title}》窗口内热力增量 +${formatHeatNum(topGrower.heatIncrement)}，短期爆发力强`);
  }

  patterns.push(
    newRatio > 30
      ? `新剧占比 ${newRatio}%（共 ${newDramas.length} 部），${typeName}正处于密集上新期，新内容起量空间较大`
      : `新剧占比 ${newRatio}%，存量长线内容占主导，头部剧集消耗周期较长`
  );

  if (multiPlatform.length > 0) {
    patterns.push(`${multiPlatform.length} 部剧在多平台同时上榜，多平台联投是${typeName}主流分发策略`);
  }

  return patterns;
}

// ─── 洞察识别：单赛道市场趋势判断 ───────────────────────────────────────────────

function buildMarketInsights(dramas: DramaStat[], typeName: string, totalDramasCount: number): string[] {
  if (dramas.length === 0) return [`${typeName}暂无足够数据`];

  const heats = dramas.map(d => d.latestHeat).sort((a, b) => b - a);
  const totalHeat = heats.reduce((s, h) => s + h, 0);
  const top3Heat = heats.slice(0, 3).reduce((s, h) => s + h, 0);
  const top3Concentration = totalHeat > 0 ? Math.round(top3Heat / totalHeat * 100) : 0;
  const newDramas = dramas.filter(d => d.isNew);
  const newRatio = Math.round(newDramas.length / dramas.length * 100);
  const platDist = summarizePlatformDistribution(dramas);
  const topPlatform = platDist[0]?.name ?? '未知';
  const topPlatRatio = platDist[0]?.ratio ?? 0;
  const sharePct = totalDramasCount > 0 ? Math.round(dramas.length / totalDramasCount * 100) : 0;
  const growthDramas = dramas.filter(d => d.heatIncrement !== null && d.heatIncrement > 0);
  const declineDramas = dramas.filter(d => d.heatIncrement !== null && d.heatIncrement < 0);
  const topGenres = getTopTags(dramas, 2);

  const insights: string[] = [];

  insights.push(
    `${typeName}共 ${dramas.length} 部上榜，占总上榜量的 ${sharePct}%`
  );

  insights.push(
    top3Concentration > 60
      ? `头部集中度高：Top3 剧集占该赛道总热力 ${top3Concentration}%，市场高度头部化，长尾生存空间受压`
      : top3Concentration > 40
        ? `头部集中度中等：Top3 占该赛道总热力 ${top3Concentration}%，头部与中腰部竞争并存`
        : `热力分布相对分散：Top3 仅占 ${top3Concentration}%，腰部内容具备一定生存空间`
  );

  if (topPlatform) {
    insights.push(
      topPlatRatio > 50
        ? `${topPlatform} 平台高度主导${typeName}（占比 ${topPlatRatio}%），过度依赖单平台`
        : `${topPlatform} 是${typeName}最活跃平台（占比 ${topPlatRatio}%），其他平台存在错位机会`
    );
  }

  insights.push(
    newRatio > 25
      ? `新剧占比 ${newRatio}%，${typeName}处于活跃上新期，市场竞争持续加剧`
      : `新剧占比 ${newRatio}%，存量内容主导，市场格局相对稳定`
  );

  if (dramas.length > 1) {
    if (growthDramas.length > declineDramas.length) {
      insights.push(
        `增热剧集（${growthDramas.length} 部）多于降热（${declineDramas.length} 部），${typeName}整体处于上升期`
      );
    } else if (declineDramas.length > growthDramas.length) {
      insights.push(
        `降热剧集（${declineDramas.length} 部）多于增热（${growthDramas.length} 部），${typeName}整体存在承压迹象`
      );
    }
  }

  if (topGenres.length > 0) {
    insights.push(`当前活跃题材：${topGenres.join('、')}，是该赛道的主要流量来源`);
  }

  return insights;
}

// ─── 跨赛道对比 ─────────────────────────────────────────────────────────────────

function buildHotCrossTrackComparison(
  aiRealDramas: DramaStat[] | null,
  aiMangaDramas: DramaStat[] | null,
): string[] {
  const real = aiRealDramas ?? [];
  const manga = aiMangaDramas ?? [];
  if (real.length === 0 && manga.length === 0) return ['数据不足，无法完成双赛道爆款对比'];

  const comparison: string[] = [];

  // 平均热力
  const realAvg = real.length > 0 ? Math.round(real.reduce((s, d) => s + d.latestHeat, 0) / real.length) : 0;
  const mangaAvg = manga.length > 0 ? Math.round(manga.reduce((s, d) => s + d.latestHeat, 0) / manga.length) : 0;
  if (real.length > 0 && manga.length > 0) {
    comparison.push(
      `平均热力：AI真人剧 ${formatHeatNum(realAvg)} vs AI漫剧 ${formatHeatNum(mangaAvg)}，${realAvg >= mangaAvg ? 'AI真人剧' : 'AI漫剧'}单剧均值更高`
    );
  }

  // 冲榜能力
  const realTop10 = real.filter(d => d.bestRank <= 10).length;
  const mangaTop10 = manga.filter(d => d.bestRank <= 10).length;
  const realTop10Ratio = real.length > 0 ? Math.round(realTop10 / real.length * 100) : 0;
  const mangaTop10Ratio = manga.length > 0 ? Math.round(mangaTop10 / manga.length * 100) : 0;
  if (real.length > 0 && manga.length > 0) {
    comparison.push(
      `冲榜能力（Top10 占比）：AI真人剧 ${realTop10Ratio}% vs AI漫剧 ${mangaTop10Ratio}%，${realTop10Ratio >= mangaTop10Ratio ? 'AI真人剧更易冲入 Top10' : 'AI漫剧更易冲入 Top10'}`
    );
  }

  // 增速动力
  const realGrowthRatio = real.length > 0
    ? Math.round(real.filter(d => d.heatIncrement !== null && d.heatIncrement > 0).length / real.length * 100) : 0;
  const mangaGrowthRatio = manga.length > 0
    ? Math.round(manga.filter(d => d.heatIncrement !== null && d.heatIncrement > 0).length / manga.length * 100) : 0;
  if (real.length > 0 && manga.length > 0) {
    comparison.push(
      `增热比例：AI真人剧 ${realGrowthRatio}% vs AI漫剧 ${mangaGrowthRatio}%，${realGrowthRatio >= mangaGrowthRatio ? 'AI真人剧短期爆发力更强' : 'AI漫剧短期爆发力更强'}`
    );
  }

  // 题材多样性
  const realGenreCnt = new Set(real.flatMap(d => d.tags)).size;
  const mangaGenreCnt = new Set(manga.flatMap(d => d.tags)).size;
  if (real.length > 0 && manga.length > 0) {
    comparison.push(
      `题材多样性：AI真人剧 ${realGenreCnt} 个题材标签，AI漫剧 ${mangaGenreCnt} 个；${realGenreCnt <= 3 ? 'AI真人剧题材集中，选题赛道窄' : 'AI真人剧题材分散，选题空间广'}，${mangaGenreCnt <= 3 ? 'AI漫剧题材集中' : 'AI漫剧题材分散'}`
    );
  }

  // 新剧动力
  const realNewRatio = real.length > 0 ? Math.round(real.filter(d => d.isNew).length / real.length * 100) : 0;
  const mangaNewRatio = manga.length > 0 ? Math.round(manga.filter(d => d.isNew).length / manga.length * 100) : 0;
  if (real.length > 0 && manga.length > 0) {
    comparison.push(
      `新剧活跃度：AI真人剧 ${realNewRatio}% vs AI漫剧 ${mangaNewRatio}%，${realNewRatio > mangaNewRatio ? 'AI真人剧新内容供给更活跃，入局时机更充分' : 'AI漫剧新内容供给更活跃'}`
    );
  }

  return comparison;
}

function buildMarketCrossTrackComparison(
  aiRealDramas: DramaStat[] | null,
  aiMangaDramas: DramaStat[] | null,
): string[] {
  const real = aiRealDramas ?? [];
  const manga = aiMangaDramas ?? [];
  if (real.length === 0 && manga.length === 0) return ['数据不足，无法完成双赛道市场对比'];

  const comparison: string[] = [];
  const totalCount = real.length + manga.length;

  // 市场份额
  if (totalCount > 0) {
    const realShare = Math.round(real.length / totalCount * 100);
    const mangaShare = 100 - realShare;
    comparison.push(
      `市场份额：AI真人剧 ${realShare}% vs AI漫剧 ${mangaShare}%，${realShare >= mangaShare ? 'AI真人剧' : 'AI漫剧'}内容数量占优`
    );
  }

  // 热力份额（谁更强势）
  const realTotalHeat = real.reduce((s, d) => s + d.latestHeat, 0);
  const mangaTotalHeat = manga.reduce((s, d) => s + d.latestHeat, 0);
  const sumHeat = realTotalHeat + mangaTotalHeat;
  if (sumHeat > 0 && real.length > 0 && manga.length > 0) {
    const realHeatShare = Math.round(realTotalHeat / sumHeat * 100);
    comparison.push(
      `热力份额：AI真人剧占总热力 ${realHeatShare}%，${realHeatShare > 50 ? 'AI真人剧在流量上更强势' : 'AI漫剧在流量上更强势'}（流量 ≠ 内容数量）`
    );
  }

  // 谁增长更快
  const realGrowthRatio = real.length > 0
    ? Math.round(real.filter(d => d.heatIncrement !== null && d.heatIncrement > 0).length / real.length * 100) : 0;
  const mangaGrowthRatio = manga.length > 0
    ? Math.round(manga.filter(d => d.heatIncrement !== null && d.heatIncrement > 0).length / manga.length * 100) : 0;
  if (real.length > 0 && manga.length > 0) {
    const fastTrack = realGrowthRatio >= mangaGrowthRatio ? 'AI真人剧' : 'AI漫剧';
    const slowTrack = fastTrack === 'AI真人剧' ? 'AI漫剧' : 'AI真人剧';
    comparison.push(
      `增长动能：${fastTrack}增热比例（${Math.max(realGrowthRatio, mangaGrowthRatio)}%）高于${slowTrack}（${Math.min(realGrowthRatio, mangaGrowthRatio)}%），当前阶段${fastTrack}扩量潜力更强`
    );
  }

  // 哪个更适合差异化竞争
  const realTop3Concentration = realTotalHeat > 0
    ? Math.round(real.slice(0, 3).reduce((s, d) => s + d.latestHeat, 0) / realTotalHeat * 100) : 0;
  const mangaTop3Concentration = mangaTotalHeat > 0
    ? Math.round(manga.slice(0, 3).reduce((s, d) => s + d.latestHeat, 0) / mangaTotalHeat * 100) : 0;
  if (real.length > 0 && manga.length > 0) {
    const moreConcentrated = realTop3Concentration > mangaTop3Concentration ? 'AI真人剧' : 'AI漫剧';
    const lessConcentrated = moreConcentrated === 'AI真人剧' ? 'AI漫剧' : 'AI真人剧';
    comparison.push(
      `竞争格局：${moreConcentrated} Top3 集中度更高（${Math.max(realTop3Concentration, mangaTop3Concentration)}%），头部效应明显，新入局风险较大；${lessConcentrated}集中度相对低（${Math.min(realTop3Concentration, mangaTop3Concentration)}%），更适合做差异化竞争`
    );
  }

  return comparison;
}

// ─── 单赛道构建（爆款分析） ────────────────────────────────────────────────────

function buildTrackForHot(
  dramas: DramaStat[],
  typeName: string,
  dramaType: 'ai_real' | 'ai_manga',
): TrackAnalysis {
  if (dramas.length === 0) {
    return {
      label: typeName, dramaType,
      metrics: { dramaCount: 0, activePlatformCount: 0, newDramaCount: 0, hitDramaCount: 0, avgHeat: null, topHeat: null },
      topDramas: [], platformDistribution: [], genreDistribution: [],
      hotPatterns: [`${typeName}暂无数据`], marketInsights: [], opportunities: [], risks: [], empty: true,
    };
  }

  const heats = dramas.map(d => d.latestHeat).sort((a, b) => b - a);
  const increments = dramas.map(d => d.heatIncrement).filter((v): v is number => v !== null).sort((a, b) => b - a);
  const heatP70 = heats[Math.floor(dramas.length * 0.3)] ?? 0;
  const incrementP70 = increments.length > 0 ? (increments[Math.floor(increments.length * 0.3)] ?? 0) : null;

  const hotCandidates = dramas.filter(d =>
    d.bestRank <= 10 ||
    d.latestHeat >= heatP70 ||
    (d.heatIncrement !== null && incrementP70 !== null && d.heatIncrement >= incrementP70)
  );
  const newDramas = dramas.filter(d => d.isNew);
  const activePlatforms = new Set(dramas.flatMap(d => d.allPlatforms));
  const avgHeat = heats.length > 0 ? Math.round(heats.reduce((s, h) => s + h, 0) / heats.length) : null;
  const platformDist = summarizePlatformDistribution(dramas);
  const genreDist = summarizeGenreDistribution(dramas);
  const topDramas = summarizeTopDramas(hotCandidates.length > 0 ? hotCandidates : dramas, 10, heatP70, incrementP70);
  const hotPatterns = buildHotPatterns(dramas, typeName);
  const newRatio = dramas.length > 0 ? Math.round(newDramas.length / dramas.length * 100) : 0;

  const opportunities: string[] = [];
  if (newRatio > 30) opportunities.push(`新剧占比 ${newRatio}%，${typeName}上新期活跃，内容窗口期较好`);
  if (genreDist[0]?.name) opportunities.push(`题材"${genreDist[0].name}"频次最高，可针对此方向加大内容布局`);
  if (platformDist[1]?.name) opportunities.push(`${platformDist[1].name} 上榜数量排第二，头部平台之外可错位布局`);
  if (hotCandidates.some(d => d.heatIncrement !== null && incrementP70 !== null && d.heatIncrement >= incrementP70 * 2))
    opportunities.push('存在增速远超平均值的爆发型剧集，可重点拆解其选题和投放节奏');

  const risks: string[] = [];
  if ((platformDist[0]?.ratio ?? 0) > 60) risks.push(`${platformDist[0].name} 集中度 ${platformDist[0].ratio}%，单平台依赖过高`);
  if (genreDist.length <= 2) risks.push('题材高度集中，同类竞品密集，差异化难度大');
  if (hotCandidates.length < 3) risks.push('爆款候选数量不足3部，整体爆款密度偏低');

  return {
    label: typeName, dramaType,
    metrics: {
      dramaCount: dramas.length,
      activePlatformCount: activePlatforms.size,
      newDramaCount: newDramas.length,
      hitDramaCount: hotCandidates.length,
      avgHeat,
      topHeat: heats[0] ?? null,
    },
    topDramas, platformDistribution: platformDist, genreDistribution: genreDist,
    hotPatterns, marketInsights: [], opportunities, risks, empty: false,
  };
}

// ─── 单赛道构建（洞察识别） ────────────────────────────────────────────────────

function buildTrackForMarket(
  dramas: DramaStat[],
  typeName: string,
  dramaType: 'ai_real' | 'ai_manga',
  totalDramasCount: number,
): TrackAnalysis {
  if (dramas.length === 0) {
    return {
      label: typeName, dramaType,
      metrics: { dramaCount: 0, activePlatformCount: 0, newDramaCount: 0, hitDramaCount: 0, avgHeat: null, topHeat: null },
      topDramas: [], platformDistribution: [], genreDistribution: [],
      hotPatterns: [], marketInsights: [`${typeName}暂无数据`], opportunities: [], risks: [], empty: true,
    };
  }

  const heats = dramas.map(d => d.latestHeat).sort((a, b) => b - a);
  const increments = dramas.map(d => d.heatIncrement).filter((v): v is number => v !== null).sort((a, b) => b - a);
  const heatP70 = heats[Math.floor(dramas.length * 0.3)] ?? 0;
  const incrementP70 = increments.length > 0 ? (increments[Math.floor(increments.length * 0.3)] ?? 0) : null;

  const newDramas = dramas.filter(d => d.isNew);
  const activePlatforms = new Set(dramas.flatMap(d => d.allPlatforms));
  const avgHeat = heats.length > 0 ? Math.round(heats.reduce((s, h) => s + h, 0) / heats.length) : null;
  const platformDist = summarizePlatformDistribution(dramas);
  const genreDist = summarizeGenreDistribution(dramas);
  const topDramas = summarizeTopDramas(dramas, 8, heatP70, incrementP70);
  const marketInsights = buildMarketInsights(dramas, typeName, totalDramasCount);
  const newRatio = dramas.length > 0 ? Math.round(newDramas.length / dramas.length * 100) : 0;
  const topHeat = heats[0] ?? 0;
  const top3Heat = heats.slice(0, 3).reduce((s, h) => s + h, 0);
  const totalHeat = heats.reduce((s, h) => s + h, 0);
  const top3Ratio = totalHeat > 0 ? Math.round(top3Heat / totalHeat * 100) : 0;

  const opportunities: string[] = [];
  if (newRatio > 20) opportunities.push(`${typeName}新剧比例 ${newRatio}%，适合观察新势力内容起量逻辑`);
  const fastGenres = getTopTags(dramas.filter(d => d.heatIncrement !== null && d.heatIncrement > 0), 2);
  if (fastGenres.length) opportunities.push(`增热剧集集中在"${fastGenres.join('、')}"方向，可作为优先布局题材`);
  if (activePlatforms.size >= 3) opportunities.push(`${typeName}已在 ${activePlatforms.size} 个平台上榜，多平台分发机会明显`);

  const risks: string[] = [];
  if (top3Ratio > 60) risks.push(`${typeName} Top3 集中度 ${top3Ratio}%，长尾内容流量受压，中小预算内容生存难度高`);
  if ((platformDist[0]?.ratio ?? 0) > 55) risks.push(`${platformDist[0].name} 独大（占 ${platformDist[0].ratio}%），其他平台获量难度高`);
  const declineCount = dramas.filter(d => d.heatIncrement !== null && d.heatIncrement < -topHeat * 0.1).length;
  if (declineCount > dramas.length * 0.4) risks.push(`超过 40% 的${typeName}热力下降，赛道整体进入消耗期`);

  return {
    label: typeName, dramaType,
    metrics: {
      dramaCount: dramas.length,
      activePlatformCount: activePlatforms.size,
      newDramaCount: newDramas.length,
      hitDramaCount: dramas.filter(d => d.bestRank <= 10).length,
      avgHeat,
      topHeat: heats[0] ?? null,
    },
    topDramas, platformDistribution: platformDist, genreDistribution: genreDist,
    hotPatterns: [], marketInsights, opportunities, risks, empty: false,
  };
}

// ─── 通用辅助 ──────────────────────────────────────────────────────────────────

function buildMeta(title: string, filters: ReportFilters): ReportMeta {
  const platform = (filters.platform && filters.platform !== 'all') ? filters.platform : '全部';
  const typeLabel = filters.dramaType === 'ai_real' ? 'AI真人剧' : filters.dramaType === 'ai_manga' ? 'AI漫剧' : 'AI真人剧+AI漫剧';
  return {
    title,
    generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    startDate: filters.startDate,
    endDate: filters.endDate,
    filterSummary: [
      `分析周期：${filters.startDate} ~ ${filters.endDate}`,
      `平台：${platform}`,
      `分析对象：${typeLabel}`,
    ],
  };
}

function buildMethodology(filters: ReportFilters, unclassifiedCount: number): string[] {
  const m = [
    `数据来源：ranking_snapshot 表，快照日期 ${filters.startDate} ~ ${filters.endDate}`,
    '主分析对象：AI真人剧（is_ai_drama = ai_real）+ AI漫剧（is_ai_drama = ai_manga）',
    '热力增量：窗口内最晚日期热力值 − 最早日期热力值（仅1天数据时标注"样本天数不足"）',
    '新剧判定：first_air_date 落在当前窗口内，或首次入榜（first_seen_date）落在窗口内',
    '跨平台去重：同一 playlet_id 合并，取各日期最高热力值为代表',
    '爆款候选：最佳排名 ≤ 10，或热力值 / 增量 ≥ 窗口内前30% 阈值',
    '题材标签来源：优先 genre_tags_manual > genre_tags_ai > tags',
  ];
  if (unclassifiedCount > 0) {
    m.push(`本周期另有 ${unclassifiedCount} 部未分类剧集（is_ai_drama = NULL）未纳入主分析，仅作背景参考`);
  }
  return m;
}

function mergeMetrics(tracks: (TrackAnalysis | null)[]): ReportMetrics {
  const valid = tracks.filter((t): t is TrackAnalysis => t !== null && !t.empty);
  if (valid.length === 0) return { dramaCount: 0, activePlatformCount: 0, newDramaCount: 0, hitDramaCount: 0, avgHeat: null, topHeat: null };
  const allHeats = valid.flatMap(t => t.topDramas.map(d => d.heatValue ?? 0));
  return {
    dramaCount: valid.reduce((s, t) => s + t.metrics.dramaCount, 0),
    activePlatformCount: Math.max(...valid.map(t => t.metrics.activePlatformCount)),
    newDramaCount: valid.reduce((s, t) => s + t.metrics.newDramaCount, 0),
    hitDramaCount: valid.reduce((s, t) => s + t.metrics.hitDramaCount, 0),
    avgHeat: allHeats.length > 0 ? Math.round(allHeats.reduce((s, h) => s + h, 0) / allHeats.length) : null,
    topHeat: allHeats.length > 0 ? Math.max(...allHeats) : null,
  };
}

function buildEmptyReportData(filters: ReportFilters, title: string, reportType: 'hot' | 'market'): ReportData {
  return {
    meta: buildMeta(title, filters),
    reportType,
    aiReal: null, aiManga: null, unclassifiedCount: 0,
    crossTrackComparison: [],
    summary: [`当前筛选周期（${filters.startDate} ~ ${filters.endDate}）内 AI真人剧 / AI漫剧 暂无数据`],
    metrics: { dramaCount: 0, activePlatformCount: 0, newDramaCount: 0, hitDramaCount: 0, avgHeat: null, topHeat: null },
    topDramas: [], platformDistribution: [], genreDistribution: [],
    opportunities: [], risks: [],
    methodology: buildMethodology(filters, 0),
    comparison: null,
    empty: true,
  };
}

// ─── 周期对比 ──────────────────────────────────────────────────────────────────

function buildComparison(
  filters: ReportFilters,
  firstSeenMap: Map<string, string>,
  dramaCount: number,
  newDramaCount: number,
  avgHeat: number | null,
) {
  const { previousStartDate, previousEndDate } = getPreviousPeriodRange(filters.startDate, filters.endDate);
  const { rows: prevRows } = getClassifiedRows({ ...filters, startDate: previousStartDate, endDate: previousEndDate });
  if (prevRows.length === 0) return null;

  const prevDramas = calculateDramaWindowMetrics(prevRows, { ...filters, startDate: previousStartDate, endDate: previousEndDate }, firstSeenMap);
  const prevHeats = prevDramas.map(d => d.latestHeat);
  const prevAvg = prevHeats.length > 0 ? Math.round(prevHeats.reduce((s, h) => s + h, 0) / prevHeats.length) : 0;
  const prevNew = prevDramas.filter(d => d.isNew).length;

  const summary: string[] = [
    `上一周期上榜 ${prevDramas.length} 部 → 本周期 ${dramaCount} 部（${dramaCount >= prevDramas.length ? '+' : ''}${dramaCount - prevDramas.length}）`,
  ];
  if (avgHeat !== null && prevAvg > 0) {
    const pct = Math.round(((avgHeat - prevAvg) / prevAvg) * 100);
    summary.push(`综合平均热力 ${pct >= 0 ? '+' : ''}${pct}%（${formatHeatNum(prevAvg)} → ${formatHeatNum(avgHeat)}）`);
  }
  summary.push(`新剧数量：${prevNew} → ${newDramaCount}`);
  return { previousStartDate, previousEndDate, summary };
}

// ─── 主报告构建：爆款分析 ──────────────────────────────────────────────────────

export function buildHotAnalysisReport(filters: ReportFilters): ReportData {
  if (!filters.startDate || !filters.endDate)
    return buildEmptyReportData(filters, '爆款分析报告', 'hot');

  const { rows, unclassifiedCount } = getClassifiedRows(filters);
  if (rows.length === 0) return buildEmptyReportData(filters, '爆款分析报告', 'hot');

  const firstSeenMap = getFirstSeenMap();
  const allDramas = calculateDramaWindowMetrics(rows, filters, firstSeenMap);
  if (allDramas.length === 0) return buildEmptyReportData(filters, '爆款分析报告', 'hot');

  // 按赛道分拆
  const realDramas = allDramas.filter(d => d.dramaType === 'ai_real');
  const mangaDramas = allDramas.filter(d => d.dramaType === 'ai_manga');

  const shouldIncludeReal = !filters.dramaType || filters.dramaType === 'all' || filters.dramaType === 'ai_real';
  const shouldIncludeManga = !filters.dramaType || filters.dramaType === 'all' || filters.dramaType === 'ai_manga';

  const aiReal = shouldIncludeReal ? buildTrackForHot(realDramas, 'AI真人剧', 'ai_real') : null;
  const aiManga = shouldIncludeManga ? buildTrackForHot(mangaDramas, 'AI漫剧', 'ai_manga') : null;
  const crossTrackComparison = (shouldIncludeReal && shouldIncludeManga)
    ? buildHotCrossTrackComparison(realDramas, mangaDramas) : [];

  const combinedMetrics = mergeMetrics([aiReal, aiManga]);
  const allTopDramas = [
    ...(aiReal?.topDramas ?? []),
    ...(aiManga?.topDramas ?? []),
  ].sort((a, b) => (b.heatValue ?? 0) - (a.heatValue ?? 0)).slice(0, 20);

  const topReal = realDramas[0];
  const topManga = mangaDramas[0];
  const summary: string[] = [
    `本报告以 AI真人剧 和 AI漫剧 双赛道为主分析对象`,
    `分析周期：${filters.startDate} ~ ${filters.endDate}`,
    ...(topReal ? [`AI真人剧爆款代表：《${topReal.title}》（热力值 ${formatHeatNum(topReal.latestHeat)}）`] : []),
    ...(topManga ? [`AI漫剧爆款代表：《${topManga.title}》（热力值 ${formatHeatNum(topManga.latestHeat)}）`] : []),
    ...(unclassifiedCount > 0 ? [`另有 ${unclassifiedCount} 部未分类剧集未纳入主分析`] : []),
  ];

  const opportunities = [
    ...(aiReal?.opportunities ?? []).map(o => `[AI真人剧] ${o}`),
    ...(aiManga?.opportunities ?? []).map(o => `[AI漫剧] ${o}`),
  ];
  const risks = [
    ...(aiReal?.risks ?? []).map(r => `[AI真人剧] ${r}`),
    ...(aiManga?.risks ?? []).map(r => `[AI漫剧] ${r}`),
  ];

  return {
    meta: buildMeta('爆款分析报告', filters),
    reportType: 'hot',
    aiReal, aiManga, unclassifiedCount, crossTrackComparison,
    summary,
    metrics: combinedMetrics,
    topDramas: allTopDramas,
    platformDistribution: summarizePlatformDistribution(allDramas),
    genreDistribution: summarizeGenreDistribution(allDramas),
    opportunities, risks,
    methodology: buildMethodology(filters, unclassifiedCount),
    comparison: buildComparison(filters, firstSeenMap, combinedMetrics.dramaCount, combinedMetrics.newDramaCount, combinedMetrics.avgHeat),
    empty: false,
  };
}

// ─── 主报告构建：洞察识别 ──────────────────────────────────────────────────────

export function buildMarketInsightReport(filters: ReportFilters): ReportData {
  if (!filters.startDate || !filters.endDate)
    return buildEmptyReportData(filters, '洞察识别报告', 'market');

  const { rows, unclassifiedCount } = getClassifiedRows(filters);
  if (rows.length === 0) return buildEmptyReportData(filters, '洞察识别报告', 'market');

  const firstSeenMap = getFirstSeenMap();
  const allDramas = calculateDramaWindowMetrics(rows, filters, firstSeenMap);
  if (allDramas.length === 0) return buildEmptyReportData(filters, '洞察识别报告', 'market');

  const realDramas = allDramas.filter(d => d.dramaType === 'ai_real');
  const mangaDramas = allDramas.filter(d => d.dramaType === 'ai_manga');

  const shouldIncludeReal = !filters.dramaType || filters.dramaType === 'all' || filters.dramaType === 'ai_real';
  const shouldIncludeManga = !filters.dramaType || filters.dramaType === 'all' || filters.dramaType === 'ai_manga';

  const aiReal = shouldIncludeReal ? buildTrackForMarket(realDramas, 'AI真人剧', 'ai_real', allDramas.length) : null;
  const aiManga = shouldIncludeManga ? buildTrackForMarket(mangaDramas, 'AI漫剧', 'ai_manga', allDramas.length) : null;
  const crossTrackComparison = (shouldIncludeReal && shouldIncludeManga)
    ? buildMarketCrossTrackComparison(realDramas, mangaDramas) : [];

  const combinedMetrics = mergeMetrics([aiReal, aiManga]);
  const allTopDramas = [
    ...(aiReal?.topDramas ?? []),
    ...(aiManga?.topDramas ?? []),
  ].sort((a, b) => (b.heatValue ?? 0) - (a.heatValue ?? 0)).slice(0, 15);

  const realNewRatio = realDramas.length > 0 ? Math.round(realDramas.filter(d => d.isNew).length / realDramas.length * 100) : 0;
  const mangaNewRatio = mangaDramas.length > 0 ? Math.round(mangaDramas.filter(d => d.isNew).length / mangaDramas.length * 100) : 0;
  const summary: string[] = [
    `本报告聚焦 AI真人剧 与 AI漫剧 市场结构变化`,
    `分析周期：${filters.startDate} ~ ${filters.endDate}`,
    ...(realDramas.length > 0 ? [`AI真人剧：${realDramas.length} 部上榜，新剧占比 ${realNewRatio}%`] : []),
    ...(mangaDramas.length > 0 ? [`AI漫剧：${mangaDramas.length} 部上榜，新剧占比 ${mangaNewRatio}%`] : []),
    ...(unclassifiedCount > 0 ? [`另有 ${unclassifiedCount} 部未分类剧集未纳入主分析`] : []),
  ];

  const opportunities = [
    ...(aiReal?.opportunities ?? []).map(o => `[AI真人剧] ${o}`),
    ...(aiManga?.opportunities ?? []).map(o => `[AI漫剧] ${o}`),
  ];
  const risks = [
    ...(aiReal?.risks ?? []).map(r => `[AI真人剧] ${r}`),
    ...(aiManga?.risks ?? []).map(r => `[AI漫剧] ${r}`),
  ];

  return {
    meta: buildMeta('洞察识别报告', filters),
    reportType: 'market',
    aiReal, aiManga, unclassifiedCount, crossTrackComparison,
    summary,
    metrics: combinedMetrics,
    topDramas: allTopDramas,
    platformDistribution: summarizePlatformDistribution(allDramas),
    genreDistribution: summarizeGenreDistribution(allDramas),
    opportunities, risks,
    methodology: buildMethodology(filters, unclassifiedCount),
    comparison: buildComparison(filters, firstSeenMap, combinedMetrics.dramaCount, combinedMetrics.newDramaCount, combinedMetrics.avgHeat),
    empty: false,
  };
}

// ─── 保留向下兼容的旧导出 ──────────────────────────────────────────────────────

export { buildEmptyReportData as buildEmptyReport };

export function getFilteredRankingDataset(filters: ReportFilters) {
  return getClassifiedRows(filters).rows;
}
