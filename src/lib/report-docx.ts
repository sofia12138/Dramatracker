/**
 * report-docx.ts
 * 将 ReportData 渲染为可编辑的 Word (.docx) 文档。
 * 爆款分析侧重"内容打法报告"，洞察识别侧重"市场判断报告"，结构明显不同。
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, BorderStyle, ShadingType, TableLayoutType,
} from 'docx';
import type { ReportData, TrackAnalysis, TopDramaItem, DistributionItem, ReportMetrics } from './report-analysis';

// ─── 样式辅助 ──────────────────────────────────────────────────────────────────

function h1(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } });
}
function h2(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 } });
}
function h3(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 80 } });
}
function para(text: string, opts?: { bold?: boolean; color?: string; size?: number; indent?: number }) {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts?.bold, color: opts?.color, size: opts?.size ?? 22 })],
    indent: opts?.indent ? { left: opts.indent } : undefined,
    spacing: { before: 40, after: 40 },
  });
}
function bullet(text: string, color = '374151') {
  return new Paragraph({
    children: [new TextRun({ text: '• ' + text, color, size: 22 })],
    indent: { left: 200 },
    spacing: { before: 30, after: 30 },
  });
}
function separator() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' } },
    spacing: { before: 200, after: 200 },
    children: [],
  });
}

function fmtHeat(v: number | null): string {
  if (v === null) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return Math.round(v).toLocaleString();
}
function fmtInc(v: number | null): string {
  if (v === null) return '-';
  return (v >= 0 ? '+' : '') + fmtHeat(v);
}

// ─── 表格构建 ──────────────────────────────────────────────────────────────────

const headerShading = { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'F3F4F6' };
const cellBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
};

function hCell(text: string) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, color: '374151' })], spacing: { before: 60, after: 60 } })],
    shading: headerShading, borders: cellBorder,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}
function dCell(text: string, opts?: { bold?: boolean; color?: string }) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: text || '-', size: 20, bold: opts?.bold, color: opts?.color })], spacing: { before: 40, after: 40 } })],
    borders: cellBorder,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });
}

function buildTopDramaTable(dramas: TopDramaItem[]): Table {
  const headerRow = new TableRow({
    children: ['#', '剧集名称', '平台', '当前排名', '最佳排名', '热力值', '增量', '入选原因'].map(hCell),
    tableHeader: true,
  });
  const dataRows = dramas.slice(0, 10).map((d, i) => new TableRow({
    children: [
      dCell(String(i + 1)),
      dCell((d.isNew ? '[新] ' : '') + d.title, { bold: true }),
      dCell(d.platform),
      dCell(d.currentRank != null ? '#' + d.currentRank : '-'),
      dCell(d.bestRank != null ? '#' + d.bestRank : '-'),
      dCell(fmtHeat(d.heatValue), { color: '059669', bold: true }),
      dCell(fmtInc(d.heatIncrement), { color: (d.heatIncrement ?? 0) >= 0 ? '059669' : 'dc2626' }),
      dCell(d.reasons.slice(0, 2).join('；')),
    ],
  }));
  return new Table({
    rows: [headerRow, ...dataRows],
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function buildDistTable(items: DistributionItem[], title: string): Table {
  const headerRow = new TableRow({ children: [hCell(title), hCell('数量（部）'), hCell('占比')], tableHeader: true });
  const dataRows = items.slice(0, 8).map(item => new TableRow({
    children: [dCell(item.name), dCell(String(item.value)), dCell(item.ratio + '%')],
  }));
  return new Table({
    rows: [headerRow, ...dataRows],
    layout: TableLayoutType.FIXED,
    width: { size: 55, type: WidthType.PERCENTAGE },
  });
}

// ─── 指标段落 ──────────────────────────────────────────────────────────────────

function metricsParas(m: ReportMetrics): Paragraph[] {
  return [
    `上榜剧集数：${m.dramaCount} 部`,
    `活跃平台数：${m.activePlatformCount} 个`,
    `新剧数量：${m.newDramaCount} 部`,
    `爆款/Top10 数量：${m.hitDramaCount} 部`,
    `平均热力值：${m.avgHeat != null ? fmtHeat(m.avgHeat) : '-'}`,
    `Top1 热力值：${m.topHeat != null ? fmtHeat(m.topHeat) : '-'}`,
  ].map(t => para(t, { indent: 200 }));
}

// ─── 单赛道区块 ────────────────────────────────────────────────────────────────

function buildTrackSection(
  sections: (Paragraph | Table)[],
  track: TrackAnalysis,
  isHot: boolean,
  trackNum: number,
) {
  const typeLine = isHot
    ? `${trackNum}. ${track.label} · 爆款内容特征分析`
    : `${trackNum}. ${track.label} · 市场洞察判断`;

  sections.push(h2(typeLine));

  if (track.empty) {
    sections.push(para('暂无数据', { color: '9CA3AF' }));
    return;
  }

  // 指标
  sections.push(h3('关键数据指标'));
  metricsParas(track.metrics).forEach(p => sections.push(p));

  // 特征 / 洞察
  const patternsOrInsights = isHot ? track.hotPatterns : track.marketInsights;
  sections.push(h3(isHot ? '爆款内容特征结论' : '市场趋势判断'));
  patternsOrInsights.forEach(s => sections.push(bullet(s, isHot ? 'EA580C' : '7C3AED')));

  // Top 剧集
  sections.push(h3(isHot ? '代表性爆款剧目（Top10）' : '热力 Top 列表'));
  if (track.topDramas.length > 0) {
    sections.push(buildTopDramaTable(track.topDramas) as unknown as Paragraph);
  } else {
    sections.push(para('暂无数据', { color: '9CA3AF' }));
  }

  // 平台分布
  sections.push(h3('平台分布'));
  if (track.platformDistribution.length > 0) {
    sections.push(buildDistTable(track.platformDistribution, '平台') as unknown as Paragraph);
  } else {
    sections.push(para('暂无数据', { color: '9CA3AF' }));
  }

  // 题材分布
  sections.push(h3('题材分布'));
  if (track.genreDistribution.length > 0) {
    sections.push(buildDistTable(track.genreDistribution, '题材') as unknown as Paragraph);
  } else {
    sections.push(para('暂无数据', { color: '9CA3AF' }));
  }

  // 机会与风险
  if (track.opportunities.length > 0) {
    sections.push(h3('机会点'));
    track.opportunities.forEach(o => sections.push(bullet(o, '059669')));
  }
  if (track.risks.length > 0) {
    sections.push(h3('风险点'));
    track.risks.forEach(ri => sections.push(bullet(ri, 'F59E0B')));
  }
}

// ─── 爆款分析文档 ──────────────────────────────────────────────────────────────

function buildHotDocxSections(r: ReportData): (Paragraph | Table)[] {
  const sections: (Paragraph | Table)[] = [];

  // 标题区
  sections.push(h1(r.meta.title));
  sections.push(para('类型定位：识别哪些内容正在跑出来、为什么跑出来（内容打法报告）', { color: '6B7280' }));
  sections.push(para(`生成时间：${r.meta.generatedAt}`, { color: '6B7280' }));
  r.meta.filterSummary.forEach(f => sections.push(para(f, { color: '4B5563' })));
  sections.push(separator());

  if (r.empty) {
    sections.push(para('暂无 AI真人剧 / AI漫剧 数据', { bold: true, color: '9CA3AF' }));
    sections.push(para(r.summary[0] ?? '', { color: '6B7280' }));
    sections.push(separator());
    sections.push(h2('数据口径说明'));
    r.methodology.forEach(m => sections.push(bullet(m, '6B7280')));
    return sections;
  }

  // 数据说明
  if (r.unclassifiedCount > 0) {
    sections.push(para(`⚠ 另有 ${r.unclassifiedCount} 部未分类剧集未纳入主分析`, { color: '92400E' }));
  }

  // 综合摘要
  sections.push(h2('综合摘要'));
  r.summary.forEach(s => sections.push(bullet(s)));
  sections.push(separator());

  // AI真人剧赛道
  if (r.aiReal) {
    buildTrackSection(sections, r.aiReal, true, 1);
    sections.push(separator());
  }

  // AI漫剧赛道
  if (r.aiManga) {
    buildTrackSection(sections, r.aiManga, true, 2);
    sections.push(separator());
  }

  // 双赛道爆款方法论对比
  if (r.crossTrackComparison.length > 0) {
    sections.push(h2('三、AI真人剧 vs AI漫剧 · 爆款方法论对比'));
    sections.push(para('以下结论聚焦两种内容形态在"跑量能力"上的差异，可直接指导选题与投放决策。', { color: '6B7280' }));
    r.crossTrackComparison.forEach(c => sections.push(bullet(c, '059669')));
    sections.push(separator());
  }

  // 周期对比
  if (r.comparison) {
    sections.push(h2('周期对比'));
    sections.push(para(`对比周期：${r.comparison.previousStartDate} ~ ${r.comparison.previousEndDate}`, { color: '92400E' }));
    r.comparison.summary.forEach(s => sections.push(bullet(s)));
    sections.push(separator());
  }

  // 数据口径
  sections.push(h2('数据口径说明'));
  r.methodology.forEach(m => sections.push(bullet(m, '6B7280')));

  return sections;
}

// ─── 洞察识别文档 ──────────────────────────────────────────────────────────────

function buildMarketDocxSections(r: ReportData): (Paragraph | Table)[] {
  const sections: (Paragraph | Table)[] = [];

  // 标题区
  sections.push(h1(r.meta.title));
  sections.push(para('类型定位：识别市场正在发生什么变化、机会在哪里（市场判断报告）', { color: '6B7280' }));
  sections.push(para(`生成时间：${r.meta.generatedAt}`, { color: '6B7280' }));
  r.meta.filterSummary.forEach(f => sections.push(para(f, { color: '4B5563' })));
  sections.push(separator());

  if (r.empty) {
    sections.push(para('暂无 AI真人剧 / AI漫剧 数据', { bold: true, color: '9CA3AF' }));
    sections.push(para(r.summary[0] ?? '', { color: '6B7280' }));
    sections.push(separator());
    sections.push(h2('数据口径说明'));
    r.methodology.forEach(m => sections.push(bullet(m, '6B7280')));
    return sections;
  }

  // 数据说明
  if (r.unclassifiedCount > 0) {
    sections.push(para(`⚠ 另有 ${r.unclassifiedCount} 部未分类剧集未纳入主分析`, { color: '92400E' }));
  }

  // 综合摘要
  sections.push(h2('综合摘要'));
  r.summary.forEach(s => sections.push(bullet(s)));
  sections.push(separator());

  // AI真人剧市场洞察
  if (r.aiReal) {
    buildTrackSection(sections, r.aiReal, false, 1);
    sections.push(separator());
  }

  // AI漫剧市场洞察
  if (r.aiManga) {
    buildTrackSection(sections, r.aiManga, false, 2);
    sections.push(separator());
  }

  // 双赛道机会判断
  if (r.crossTrackComparison.length > 0) {
    sections.push(h2('三、双赛道机会判断'));
    sections.push(para('以下结论聚焦两个赛道的竞争格局、增长动能与资源投入优先级判断。', { color: '6B7280' }));
    r.crossTrackComparison.forEach(c => sections.push(bullet(c, '059669')));
    sections.push(separator());
  }

  // 综合结论
  if (r.opportunities.length > 0 || r.risks.length > 0) {
    sections.push(h2('四、综合结论与建议'));
    if (r.opportunities.length > 0) {
      sections.push(h3('行动机会'));
      r.opportunities.forEach(o => sections.push(bullet(o, '059669')));
    }
    if (r.risks.length > 0) {
      sections.push(h3('风险提示'));
      r.risks.forEach(ri => sections.push(bullet(ri, 'F59E0B')));
    }
    sections.push(separator());
  }

  // 周期环比
  if (r.comparison) {
    sections.push(h2('周期环比'));
    sections.push(para(`对比周期：${r.comparison.previousStartDate} ~ ${r.comparison.previousEndDate}`, { color: '92400E' }));
    r.comparison.summary.forEach(s => sections.push(bullet(s)));
    sections.push(separator());
  }

  // 数据口径
  sections.push(h2('数据口径说明'));
  r.methodology.forEach(m => sections.push(bullet(m, '6B7280')));

  return sections;
}

// ─── 构建 Document ──────────────────────────────────────────────────────────────

async function buildDocx(
  r: ReportData,
  sectionsBuilder: (r: ReportData) => (Paragraph | Table)[],
): Promise<Buffer> {
  const children = sectionsBuilder(r);
  const doc = new Document({
    creator: 'DramaTracker',
    title: r.meta.title,
    description: r.meta.filterSummary.join(' | '),
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22 } },
      },
    },
    sections: [{ children: children as Paragraph[] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── 对外接口 ──────────────────────────────────────────────────────────────────

export async function buildHotReportDocx(r: ReportData): Promise<Buffer> {
  return buildDocx(r, buildHotDocxSections);
}

export async function buildMarketReportDocx(r: ReportData): Promise<Buffer> {
  return buildDocx(r, buildMarketDocxSections);
}
