import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getUserFromRequest } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { getSqliteOnlyParts } from '@/lib/db-compat';
import { parseJsonField } from '@/lib/json-field';

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

interface InsightResult {
  summary: string;
  insights: string[];
  risks: string[];
  suggestions: string[];
}

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
  const model = process.env.BAILIAN_MODEL || 'qwen-plus';

  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI API Key 未配置，请在 .env.local 中设置 BAILIAN_API_KEY（Coding Plan 使用 sk-sp- 开头的 key）' },
      { status: 500 }
    );
  }

  const isCodingPlanKey = apiKey.startsWith('sk-sp-');
  const isCodingPlanURL = baseURL.includes('coding.dashscope');

  if (isCodingPlanKey && !isCodingPlanURL) {
    return NextResponse.json(
      { error: `检测到 Coding Plan Key（sk-sp-），但 Base URL 不匹配。请将 BAILIAN_BASE_URL 设为 https://coding.dashscope.aliyuncs.com/v1` },
      { status: 500 }
    );
  }

  if (!isCodingPlanKey && isCodingPlanURL) {
    return NextResponse.json(
      { error: `检测到 Coding Plan Base URL，但 API Key 非 sk-sp- 开头。请确认 Key 与 URL 是否匹配` },
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

    const { reviewJoin, isAiCol } = getSqliteOnlyParts();
    const rawDramas = db.prepare(`
      SELECT
        d.title,
        rs.platform,
        rs.rank,
        rs.heat_value,
        d.language,
        d.tags,
        rs.material_count,
        rs.invest_days,
        d.playlet_id
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      ${reviewJoin}
      WHERE rs.snapshot_date = ?
        AND ${isAiCol} IN ('ai_real', 'ai_manga')
      ORDER BY rs.heat_value DESC
      LIMIT 30
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
    if (prevDate) {
      const prevRows = db.prepare(
        'SELECT playlet_id, platform, rank FROM ranking_snapshot WHERE snapshot_date = ?'
      ).all(prevDate) as { playlet_id: string; platform: string; rank: number }[];
      for (const r of prevRows) {
        prevRankMap.set(`${r.playlet_id}:${r.platform}`, r.rank);
      }
    }

    const prevHeatMap = new Map<string, number>();
    if (prevDate) {
      const prevHeatRows = db.prepare(
        'SELECT playlet_id, platform, heat_value FROM ranking_snapshot WHERE snapshot_date = ?'
      ).all(prevDate) as { playlet_id: string; platform: string; heat_value: number }[];
      for (const r of prevHeatRows) {
        prevHeatMap.set(`${r.playlet_id}:${r.platform}`, r.heat_value);
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
      if (compactDramas.length >= 10) break;
      const key = `${row.playlet_id}:${row.platform}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const prevRank = prevRankMap.get(key);
      const prevHeat = prevHeatMap.get(key);
      const isNew = firstAppearanceMap.get(row.playlet_id) === latestDate;

      let rankChange = '-';
      if (isNew) {
        rankChange = 'NEW';
      } else if (prevRank !== undefined && prevRank < row.rank) {
        rankChange = `↓${row.rank - prevRank}`;
      } else if (prevRank !== undefined && prevRank > row.rank) {
        rankChange = `↑${prevRank - row.rank}`;
      }

      const tags = parseJsonField<string[]>(row.tags, []);

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

    const prompt = buildStructuredPrompt(compactDramas, latestDate);

    const client = new OpenAI({ baseURL, apiKey });
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一位专业的海外短剧市场分析师。请严格按照用户要求的 JSON 格式输出，不要添加任何 markdown 标记或额外文字。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content || '';
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let result: InsightResult;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      result = {
        summary: raw.slice(0, 500),
        insights: ['模型返回格式异常，以上为原始输出摘要'],
        risks: [],
        suggestions: [],
      };
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: { date: latestDate, dramaCount: compactDramas.length },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildStructuredPrompt(dramas: CompactDrama[], date: string): string {
  const dramaLines = dramas.map((d, i) =>
    `${i + 1}. ${d.title} | 平台:${d.platform} | 排名:#${d.rank}(${d.rank_change}) | 热力:${d.heat_value}(${d.heat_increment >= 0 ? '+' : ''}${d.heat_increment}) | 题材:${d.tags.join(',')} | 语种:${d.language} | 投放:${d.invest_days}天${d.is_new ? ' | NEW' : ''}`
  ).join('\n');

  return `以下是 ${date} 海外AI短剧榜单Top10数据：

${dramaLines}

请基于以上数据，生成一份简洁的市场洞察报告。严格返回以下 JSON 格式，不要包含任何其他文字：

{
  "summary": "一段50-100字的市场总结",
  "insights": ["洞察1", "洞察2", "洞察3"],
  "risks": ["风险1", "风险2"],
  "suggestions": ["建议1", "建议2", "建议3"]
}

要求：
- summary: 概述当前市场整体态势
- insights: 3-5条数据驱动的洞察发现
- risks: 2-3条值得关注的风险信号
- suggestions: 3-5条具体可执行的建议`;
}
