import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

const SYSTEM_PROMPT = `你是一位专业的海外短剧市场分析师，熟悉全球短剧市场趋势。
分析时请用中文输出，数据引用要准确，建议要具体可执行。
使用 Markdown 格式输出，包含清晰的标题和列表。`;

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* defaults */ }
  return {};
}

export function getAIClient(): OpenAI {
  const config = getConfig();
  const apiKey = config.ai_api_key || config.bailianApiKey || '';
  if (!apiKey) throw new Error('AI API Key 未配置，请在设置页面配置百炼 API Key');

  return new OpenAI({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey,
  });
}

export function getAIModel(): string {
  return 'qwen3.5-plus';
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function getCachedResult(cacheKey: string): string | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT content FROM ai_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(cacheKey) as { content: string } | undefined;
  return row?.content || null;
}

export function setCachedResult(cacheKey: string, analysisType: string, content: string, ttlHours = 24) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO ai_cache (cache_key, analysis_type, content, created_at, expires_at)
     VALUES (?, ?, ?, datetime('now'), ?)`
  ).run(cacheKey, analysisType, content, expiresAt);
}

export type AnalysisType = 'insight' | 'drama_review' | 'hot_analysis' | 'weekly_report';

export function buildInsightPrompt(data: {
  topDramas: { title: string; platform: string; heat: number }[];
  topHeatGrowth: { title: string; increment: number; platform: string }[];
  newCount: number;
  tagDistribution: { tag: string; count: number }[];
  langDistribution: { language: string; count: number }[];
}): string {
  return `请基于以下数据生成本周海外短剧市场洞察报告：

## 本周各平台Top AI短剧
${data.topDramas.map((d, i) => `${i + 1}. ${d.title}（${d.platform}，热力值${d.heat}）`).join('\n')}

## 热力增量TOP5
${data.topHeatGrowth.map((d, i) => `${i + 1}. ${d.title}（${d.platform}，增量+${d.increment}）`).join('\n')}

## 本周新上榜
新上榜剧集 ${data.newCount} 部

## 题材分布
${data.tagDistribution.map(t => `- ${t.tag}: ${t.count}部`).join('\n')}

## 语种分布
${data.langDistribution.map(l => `- ${l.language}: ${l.count}部`).join('\n')}

请生成包含以下内容的分析报告：
1. **本周市场总结**
2. **热门题材趋势分析**
3. **各平台表现对比**
4. **值得关注的新上榜剧集**`;
}

export function buildDramaReviewPrompt(drama: {
  title: string; description: string; tags: string[];
  heatValue: number; investDays: number; language: string;
}): string {
  return `请对以下海外短剧进行专业点评：

- **剧名**: ${drama.title}
- **简介**: ${drama.description || '暂无'}
- **题材标签**: ${drama.tags.join('、') || '暂无'}
- **累计热力值**: ${drama.heatValue}
- **投放天数**: ${drama.investDays}天
- **投放语种**: ${drama.language || '未知'}

请从以下角度分析：
1. **剧情类型和目标受众分析**
2. **投放表现评估**
3. **优势和潜在风险**
4. **同类竞品对比建议**`;
}

export function buildHotAnalysisPrompt(data: {
  topDramas: { title: string; tags: string[]; language: string; investDays: number; heatIncrement: number }[];
}): string {
  return `请基于以下热力值Top20海外短剧的数据，进行爆款规律分析和选题建议：

## Top20剧集数据
${data.topDramas.map((d, i) => `${i + 1}. ${d.title} | 题材:${d.tags.join(',')} | 语种:${d.language} | 投放${d.investDays}天 | 热力增量:${d.heatIncrement}`).join('\n')}

请生成：
1. **当前爆款共同特征**（题材、时长、节奏等维度）
2. **各语种市场内容偏好**
3. **5个具体选题方向**（每个包含：题材方向、目标市场、参考剧集、预期表现）`;
}

export function buildWeeklyReportPrompt(data: {
  thisWeek: { platform: string; topDramas: { title: string; rank: number; heat: number }[] }[];
  lastWeek: { platform: string; topDramas: { title: string; rank: number; heat: number }[] }[];
  newHits: { title: string; platform: string; heat: number }[];
  tagTrend: { tag: string; thisWeek: number; lastWeek: number }[];
  langTrend: { language: string; thisWeek: number; lastWeek: number }[];
}): string {
  const thisWeekSummary = data.thisWeek.map(p =>
    `### ${p.platform}\n${p.topDramas.slice(0, 5).map((d, i) => `${i + 1}. ${d.title}（排名#${d.rank}，热力${d.heat}）`).join('\n')}`
  ).join('\n\n');

  const lastWeekSummary = data.lastWeek.map(p =>
    `### ${p.platform}\n${p.topDramas.slice(0, 5).map((d, i) => `${i + 1}. ${d.title}（排名#${d.rank}，热力${d.heat}）`).join('\n')}`
  ).join('\n\n');

  return `请基于以下数据生成海外短剧市场周报：

## 本周各平台Top5
${thisWeekSummary}

## 上周各平台Top5
${lastWeekSummary}

## 本周新晋爆款
${data.newHits.map((d, i) => `${i + 1}. ${d.title}（${d.platform}，热力${d.heat}）`).join('\n') || '暂无'}

## 题材变化趋势
${data.tagTrend.map(t => `- ${t.tag}: 本周${t.thisWeek}部 vs 上周${t.lastWeek}部`).join('\n') || '暂无'}

## 语种变化趋势
${data.langTrend.map(l => `- ${l.language}: 本周${l.thisWeek}部 vs 上周${l.lastWeek}部`).join('\n') || '暂无'}

请生成完整周报，包含：
1. **本周市场概况**
2. **各平台重点变化**
3. **本周新晋爆款分析**
4. **题材和语种趋势变化**
5. **下周预测和建议**`;
}
