import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getUserFromRequest } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
}

interface CompetitorAnalysisItem {
  title: string;
  type: string;
  replicability: string;
  confidence: number;
  reason: string[];
  risk: string[];
  signals: string[];
}

const GROWTH_TYPES = ['爆发增长型', '投放驱动型', '内容驱动型', '稳定长尾型', '衰退下滑型'];
const REPLICABILITY = ['高可复制', '有条件可复制', '不可复制'];

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
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
    const dramaType = request.nextUrl.searchParams.get('type') || 'ai_real';

    const TYPE_FILTER_MAP: Record<string, string> = {
      ai_real: "AND d.is_ai_drama = 'ai_real'",
      ai_manga: "AND d.is_ai_drama = 'ai_manga'",
      real: "AND d.is_ai_drama = 'real'",
    };
    const typeFilter = TYPE_FILTER_MAP[dramaType] || '';

    const TYPE_LABEL_MAP: Record<string, string> = {
      ai_real: 'AI真人剧',
      ai_manga: 'AI漫剧',
      real: '真人剧',
    };
    const typeLabel = TYPE_LABEL_MAP[dramaType] || '全部';

    const latestDate = (
      db.prepare('SELECT MAX(snapshot_date) as d FROM ranking_snapshot').get() as { d: string }
    )?.d;

    if (!latestDate) {
      return NextResponse.json({ error: '暂无榜单数据' }, { status: 400 });
    }

    const rawDramas = db.prepare(`
      SELECT
        d.title, rs.platform, rs.rank, rs.heat_value,
        d.language, d.tags, rs.material_count,
        rs.invest_days, d.playlet_id
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      WHERE rs.snapshot_date = ? ${typeFilter}
      ORDER BY rs.heat_value DESC
      LIMIT 40
    `).all(latestDate) as {
      title: string; platform: string; rank: number; heat_value: number;
      language: string; tags: string; material_count: number;
      invest_days: number; playlet_id: string;
    }[];

    const prevDate = (
      db.prepare(
        'SELECT MAX(snapshot_date) as d FROM ranking_snapshot WHERE snapshot_date < ?'
      ).get(latestDate) as { d: string | null }
    )?.d;

    const prevRankMap = new Map<string, number>();
    const prevHeatMap = new Map<string, number>();
    if (prevDate) {
      const prevRows = db.prepare(
        'SELECT playlet_id, platform, rank, heat_value FROM ranking_snapshot WHERE snapshot_date = ?'
      ).all(prevDate) as { playlet_id: string; platform: string; rank: number; heat_value: number }[];
      for (const r of prevRows) {
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

    const seen = new Set<string>();
    const compactDramas: CompactDrama[] = [];

    for (const row of rawDramas) {
      if (compactDramas.length >= 20) break;
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

      compactDramas.push({
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
      });
    }

    const prompt = buildCompetitorPrompt(compactDramas, typeLabel);

    const client = new OpenAI({ baseURL, apiKey });
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content || '';
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let result: CompetitorAnalysisItem[];
    try {
      result = JSON.parse(jsonStr);
      result = result.map(item => ({
        ...item,
        type: GROWTH_TYPES.includes(item.type) ? item.type : '稳定长尾型',
        replicability: REPLICABILITY.includes(item.replicability) ? item.replicability : '有条件可复制',
        confidence: Math.max(0, Math.min(1, item.confidence || 0.5)),
        reason: Array.isArray(item.reason) ? item.reason.slice(0, 5) : [],
        risk: Array.isArray(item.risk) ? item.risk.slice(0, 3) : [],
        signals: Array.isArray(item.signals) ? item.signals.slice(0, 5) : [],
      }));
    } catch {
      return NextResponse.json(
        { error: '模型返回格式异常，请重试', raw: raw.slice(0, 300) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: { date: latestDate, count: compactDramas.length },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const SYSTEM_PROMPT = `你是一位竞品增长模式分析专家，专注于海外短剧市场的增长逻辑识别。

你的任务：
- 不评价剧情质量
- 只从增长逻辑角度分析每部竞品短剧
- 基于提供的数据字段判断增长模式

分析维度：
- rank_change：判断排名上升或下滑趋势
- heat_increment：判断增长强度（正值=热度上升，负值=热度下降）
- material_count：素材数量高→可能是投放驱动；低但热度高→可能是内容驱动
- invest_days：投放天数短+热度高→爆发增长；天数长+热度稳→长尾型
- is_new：新剧=冷启动阶段
- tags：CEO/复仇/情感等=成熟题材，可复制性高

增长模式枚举（只能从中选择）：
- 爆发增长型：短时间内热度飙升，排名快速攀升
- 投放驱动型：高素材投放量驱动热度，依赖买量
- 内容驱动型：素材少但热度高，依靠内容自然传播
- 稳定长尾型：长周期投放，热度平稳
- 衰退下滑型：热度下降，排名下滑

可复制性枚举（只能从中选择）：
- 高可复制：成熟题材+标准化模式
- 有条件可复制：需要特定资源或能力
- 不可复制：依赖独特IP或不可复制的条件

严格返回合法 JSON 数组，不要输出任何解释性文字。`;

function buildCompetitorPrompt(dramas: CompactDrama[], typeLabel: string): string {
  const lines = dramas.map((d, i) =>
    `${i + 1}. ${d.title} | 平台:${d.platform} | 排名:#${d.rank}(${d.rank_change}) | 热力:${d.heat_value}(${d.heat_increment >= 0 ? '+' : ''}${d.heat_increment}) | 素材数:${d.material_count} | 投放:${d.invest_days}天 | 题材:${d.tags.join(',')} | 语种:${d.language}${d.is_new ? ' | NEW' : ''}`
  ).join('\n');

  return `当前分析的是【${typeLabel}】榜单。

以下是该榜单 Top${dramas.length} 数据：

${lines}

请对每条剧进行竞品增长模式识别，严格返回 JSON 数组，格式如下：

[
  {
    "title": "剧名",
    "type": "增长模式（从枚举中选）",
    "replicability": "可复制性（从枚举中选）",
    "confidence": 0.85,
    "reason": ["判断依据1", "判断依据2"],
    "risk": ["风险点1"],
    "signals": ["关键特征1", "关键特征2"]
  }
]

要求：
- 每条剧都要分析，共 ${dramas.length} 条
- reason 至少 2 条
- risk 至少 1 条
- signals 从以下特征中选择或自定义：高素材投放、快速爬榜、新剧冷启动、成熟题材、长周期投放、热度下滑、内容自传播、低素材高热度
- confidence 为 0~1 的浮点数
- 只返回 JSON 数组，不要包含任何其他文字`;
}
