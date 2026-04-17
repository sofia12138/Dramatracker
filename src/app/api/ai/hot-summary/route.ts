import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getUserFromRequest } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { getSqliteOnlyParts } from '@/lib/db-compat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RawDrama {
  title: string;
  platform: string;
  rank: number;
  heat_value: number;
  language: string;
  tags: string;
  material_count: number;
  invest_days: number;
  playlet_id: string;
}

interface CompactDrama {
  title: string;
  platform: string;
  rank: number;
  heat_value: number;
  language: string;
  tags: string[];
  rank_change: string;
  heat_increment: number;
  material_count: number;
  invest_days: number;
  is_new: boolean;
  is_hot_candidate: boolean;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!hasPermission(user.role, 'use_ai')) {
    return NextResponse.json({ error: '没有权限使用AI分析' }, { status: 403 });
  }

  const apiKey = process.env.BAILIAN_API_KEY;
  const baseURL = process.env.BAILIAN_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1';
  const model = process.env.BAILIAN_MODEL || 'qwen3.5-plus';

  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI API Key 未配置，请在 .env.local 中设置 BAILIAN_API_KEY' },
      { status: 500 }
    );
  }

  try {
    const db = getDb();

    const latestDate = (
      db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string }
    )?.d;
    if (!latestDate) {
      return NextResponse.json({ error: '暂无榜单数据' }, { status: 400 });
    }

    const prevDate = (
      db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot WHERE snapshot_date < ?')
        .get(latestDate) as { d: string | null }
    )?.d;

    const prevRankMap = new Map<string, number>();
    const prevHeatMap = new Map<string, number>();
    if (prevDate) {
      const rows = db.prepare(
        'SELECT playlet_id, platform, rank, heat_value FROM ranking_snapshot WHERE snapshot_date = ?'
      ).all(prevDate) as { playlet_id: string; platform: string; rank: number; heat_value: number }[];
      for (const r of rows) {
        const k = `${r.playlet_id}:${r.platform}`;
        prevRankMap.set(k, r.rank);
        prevHeatMap.set(k, r.heat_value);
      }
    }

    const firstAppearanceMap = new Map<string, string>();
    const faRows = db.prepare(
      'SELECT playlet_id, MIN(snapshot_date) as first_date FROM ranking_snapshot GROUP BY playlet_id'
    ).all() as { playlet_id: string; first_date: string }[];
    for (const r of faRows) firstAppearanceMap.set(r.playlet_id, r.first_date);

    const { reviewJoin, isAiCol } = getSqliteOnlyParts();

    const queryTop20 = (typeFilter: string): CompactDrama[] => {
      const rawList = db.prepare(`
        SELECT d.title, rs.platform, rs.rank, rs.heat_value,
          d.language, d.tags, rs.material_count, rs.invest_days, d.playlet_id
        FROM ranking_snapshot rs
        INNER JOIN drama d ON rs.playlet_id = d.playlet_id
        ${reviewJoin}
        WHERE rs.snapshot_date = ? AND ${isAiCol} = ?
        ORDER BY rs.heat_value DESC
        LIMIT 40
      `).all(latestDate, typeFilter) as RawDrama[];

      const seen = new Set<string>();
      const result: CompactDrama[] = [];

      for (const row of rawList) {
        if (result.length >= 20) break;
        const key = `${row.playlet_id}:${row.platform}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const prevRank = prevRankMap.get(key);
        const prevHeat = prevHeatMap.get(key);
        const isNew = firstAppearanceMap.get(row.playlet_id) === latestDate;

        let rankChange = '-';
        if (isNew) rankChange = 'NEW';
        else if (prevRank !== undefined && prevRank < row.rank) rankChange = `↓${row.rank - prevRank}`;
        else if (prevRank !== undefined && prevRank > row.rank) rankChange = `↑${prevRank - row.rank}`;

        let tags: string[] = [];
        try { tags = JSON.parse(row.tags || '[]'); } catch { /* ignore */ }

        result.push({
          title: row.title,
          platform: row.platform,
          rank: row.rank,
          heat_value: row.heat_value,
          language: row.language || 'Unknown',
          tags: tags.slice(0, 3),
          rank_change: rankChange,
          heat_increment: (!isNew && prevHeat !== undefined) ? row.heat_value - prevHeat : 0,
          material_count: row.material_count || 0,
          invest_days: row.invest_days || 0,
          is_new: isNew,
          is_hot_candidate: false,
        });
      }

      return result;
    };

    const markHotCandidates = (dramas: CompactDrama[]): CompactDrama[] => {
      if (dramas.length === 0) return dramas;

      const heatIncrements = dramas.map(d => d.heat_increment).sort((a, b) => b - a);
      const materialCounts = dramas.map(d => d.material_count).sort((a, b) => b - a);
      const heatP70 = heatIncrements[Math.floor(dramas.length * 0.3)] || 0;
      const matP70 = materialCounts[Math.floor(dramas.length * 0.3)] || 0;

      return dramas.map(d => ({
        ...d,
        is_hot_candidate:
          (d.rank <= 10 && (d.rank_change === 'NEW' || d.rank_change.startsWith('↑'))) ||
          d.heat_increment >= heatP70 ||
          d.material_count >= matP70,
      }));
    };

    const aiRealAll = queryTop20('ai_real');
    const aiMangaAll = queryTop20('ai_manga');

    const aiRealMarked = markHotCandidates(aiRealAll);
    const aiMangaMarked = markHotCandidates(aiMangaAll);

    const aiRealHot = aiRealMarked.filter(d => d.is_hot_candidate);
    const aiMangaHot = aiMangaMarked.filter(d => d.is_hot_candidate);

    if (aiRealHot.length === 0 && aiMangaHot.length === 0) {
      return NextResponse.json({ error: '当前数据不足以识别候选爆款' }, { status: 400 });
    }

    const prompt = buildHotSummaryPrompt(aiRealHot, aiMangaHot, aiRealAll.length, aiMangaAll.length);

    const client = new OpenAI({ baseURL, apiKey });
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content || '';
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: '模型返回格式异常，请重试', raw: raw.slice(0, 500) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        date: latestDate,
        ai_real_total: aiRealAll.length,
        ai_real_hot: aiRealHot.length,
        ai_manga_total: aiMangaAll.length,
        ai_manga_hot: aiMangaHot.length,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const SYSTEM_PROMPT = `你是一位海外短剧市场增长分析专家。

核心原则：
- 不评价剧情质量
- 只从投放和增长逻辑角度分析
- 从竞品市场观察视角总结
- 不要输出"可投/观望/放弃"等投资建议

分析维度：
- rank + rank_change → 排名趋势
- heat_increment → 增长强度
- material_count → 投放驱动程度
- invest_days → 生命周期阶段
- is_new → 冷启动信号
- tags → 题材特征

增长模式枚举（type_distribution 只能从中选择）：
- 爆发增长型
- 投放驱动型
- 内容驱动型
- 稳定长尾型
- 衰退下滑型

严格返回合法 JSON，不要输出任何解释性文字。`;

function formatDramaLine(d: CompactDrama, i: number): string {
  return `${i + 1}. ${d.title} | 平台:${d.platform} | 排名:#${d.rank}(${d.rank_change}) | 热力:${d.heat_value}(${d.heat_increment >= 0 ? '+' : ''}${d.heat_increment}) | 素材:${d.material_count} | 投放:${d.invest_days}天 | 题材:${d.tags.join(',')} | 语种:${d.language}${d.is_new ? ' | NEW' : ''}`;
}

function buildHotSummaryPrompt(
  aiRealHot: CompactDrama[],
  aiMangaHot: CompactDrama[],
  aiRealTotal: number,
  aiMangaTotal: number,
): string {
  const realLines = aiRealHot.map((d, i) => formatDramaLine(d, i)).join('\n');
  const mangaLines = aiMangaHot.map((d, i) => formatDramaLine(d, i)).join('\n');

  return `以下是本期海外短剧榜单中筛选出的"候选爆款"数据。

筛选规则：排名前10且排名上升/新上榜，或热力增量处于榜单前30%，或素材投放量处于前30%。

## AI真人剧榜（Top${aiRealTotal} 中筛选出 ${aiRealHot.length} 部候选爆款）
${realLines || '（本期无候选爆款）'}

## AI漫剧榜（Top${aiMangaTotal} 中筛选出 ${aiMangaHot.length} 部候选爆款）
${mangaLines || '（本期无候选爆款）'}

请生成爆款识别总结，严格返回以下 JSON 格式：

{
  "summary": "对比AI真人剧与AI漫剧的总结（必须包含：主导平台、主导题材、核心增长方式）",

  "ai_real_analysis": {
    "dominant_pattern": "当前AI真人剧最主导的增长方式",
    "hot_threshold_explained": "本次筛选爆款的依据说明",
    "hot_drama_list": [
      { "title": "", "platform": "", "rank": 0, "signal": "一句话爆款原因" }
    ],
    "common_patterns": ["爆款共性1", "爆款共性2"],
    "type_distribution": [
      { "type": "增长模式名称", "count": 0 }
    ],
    "strategy_takeaways": ["策略结论1", "策略结论2"]
  },

  "ai_comic_analysis": {
    "dominant_pattern": "当前AI漫剧最主导的增长方式",
    "hot_threshold_explained": "本次筛选爆款的依据说明",
    "hot_drama_list": [
      { "title": "", "platform": "", "rank": 0, "signal": "一句话爆款原因" }
    ],
    "common_patterns": ["爆款共性1", "爆款共性2"],
    "type_distribution": [
      { "type": "增长模式名称", "count": 0 }
    ],
    "strategy_takeaways": ["策略结论1", "策略结论2"]
  }
}

要求：
- summary 必须包含主导平台、主导题材、核心增长方式的对比
- hot_drama_list 每个分析 3~5 条
- common_patterns 至少 3 条
- type_distribution 中 type 必须从枚举中选
- strategy_takeaways 2~4 条，从竞品市场观察角度
- 如果某个分类无候选爆款，对应分析可精简但不能省略
- 只返回 JSON，不要包含其他文字`;
}
