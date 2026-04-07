/**
 * report-html.ts
 * 将 ReportData 渲染为完整、可独立打开的 HTML 文档。
 * 爆款分析 / 洞察识别结构明显不同，双赛道各自独立展示。
 */
import type { ReportData, TrackAnalysis, TopDramaItem, DistributionItem, ReportMetrics } from './report-analysis';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtHeat(v: number | null): string {
  if (v === null) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return Math.round(v).toLocaleString();
}

function fmtIncrement(v: number | null): string {
  if (v === null) return '-';
  return (v >= 0 ? '+' : '') + fmtHeat(v);
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px; color: #1f2937; background: #f9fafb; padding: 24px; line-height: 1.6;
  }
  .page { max-width: 1060px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  h1 { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  h2 { font-size: 15px; font-weight: 700; color: #374151; margin: 28px 0 10px; border-left: 4px solid #6366f1; padding-left: 10px; }
  h3 { font-size: 13px; font-weight: 600; color: #4b5563; margin: 14px 0 6px; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
  .filter-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 20px; }
  .filter-tag { background: #eff6ff; color: #3b82f6; border: 1px solid #bfdbfe; padding: 2px 10px; border-radius: 20px; font-size: 11px; }
  .summary-box { background: #f5f3ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; }
  .summary-box p { margin-bottom: 4px; color: #4b5563; }
  .metrics-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 20px; }
  .metric-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
  .metric-val { font-size: 20px; font-weight: 700; color: #4f46e5; }
  .metric-label { font-size: 10px; color: #9ca3af; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-weight: 600; color: #374151; white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:hover td { background: #fafafa; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 12px; font-size: 10px; font-weight: 600; margin-right: 3px; }
  .badge-new { background: #d1fae5; color: #059669; }
  .badge-warn { background: #fff7ed; color: #c2410c; }
  .tag-chip { display: inline-block; background: #f3f4f6; color: #4b5563; padding: 1px 6px; border-radius: 10px; font-size: 10px; margin: 1px; }
  .dist-bar-bg { flex: 1; height: 7px; background: #e5e7eb; border-radius: 4px; }
  .dist-bar-fill { height: 7px; border-radius: 4px; }
  .list-ul { list-style: none; padding: 0; }
  .list-ul li { padding: 3px 0 3px 14px; position: relative; color: #374151; }
  .list-ul li::before { content: '•'; position: absolute; left: 0; color: #6366f1; }
  .opp-list li::before { color: #10b981; }
  .risk-list li::before { color: #f59e0b; }
  .pattern-list li::before { color: #f97316; }
  .insight-list li::before { color: #8b5cf6; }
  .method-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; }
  .method-box li { color: #64748b; font-size: 11px; padding: 2px 0 2px 14px; }
  .comparison-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; }
  .warn-box { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 20px; text-align: center; color: #9a3412; }
  .section-divider { border: none; border-top: 1px solid #e5e7eb; margin: 22px 0; }
  /* 赛道卡片 */
  .track-section { border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  .track-real { border-left: 5px solid #3b82f6; }
  .track-manga { border-left: 5px solid #8b5cf6; }
  .track-badge-real { display: inline-block; background: #eff6ff; color: #3b82f6; border: 1px solid #bfdbfe; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-right: 8px; }
  .track-badge-manga { display: inline-block; background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-right: 8px; }
  .cross-section { border: 1px solid #d1fae5; border-radius: 10px; padding: 20px; margin-bottom: 20px; background: #f0fdf4; }
  .cross-title { font-size: 14px; font-weight: 700; color: #065f46; margin-bottom: 12px; }
  .cross-list li::before { color: #059669; }
  .data-note { background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: 8px 14px; font-size: 11px; color: #713f12; margin-bottom: 16px; }
  @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; padding: 20px; } }
`;

// ─── 工具渲染函数 ──────────────────────────────────────────────────────────────

function renderList(items: string[], cls = ''): string {
  if (items.length === 0) return '<p style="color:#9ca3af">暂无数据</p>';
  return `<ul class="list-ul ${cls}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function renderDistribution(items: DistributionItem[], color: string): string {
  if (items.length === 0) return '<p style="color:#9ca3af">暂无数据</p>';
  const maxVal = items[0]?.value ?? 1;
  return items.slice(0, 8).map(item => `
    <div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
        <span style="font-size:12px;color:#374151">${esc(item.name)}</span>
        <span style="font-size:11px;color:#6b7280">${item.value} 部 · ${item.ratio}%</span>
      </div>
      <div class="dist-bar-bg">
        <div class="dist-bar-fill" style="width:${Math.round(item.value / maxVal * 100)}%;background:${color}"></div>
      </div>
    </div>`).join('');
}

function renderTopTable(dramas: TopDramaItem[], isHot: boolean): string {
  if (dramas.length === 0) return '<p style="color:#9ca3af;padding:12px 0">暂无数据</p>';
  const rows = dramas.map((d, i) => {
    const badges = [
      d.isNew ? '<span class="badge badge-new">新剧</span>' : '',
      d.sampleWarning ? '<span class="badge badge-warn">样本不足</span>' : '',
    ].join('');
    const tags = d.tags.map(t => `<span class="tag-chip">${esc(t)}</span>`).join('');
    const reasons = d.reasons.slice(0, 2).map(r => `<span style="font-size:10px;color:#6b7280">${esc(r)}</span>`).join(' · ');
    return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <div style="font-weight:600;margin-bottom:2px;">${esc(d.title)} ${badges}</div>
          ${tags ? `<div style="margin-top:3px;">${tags}</div>` : ''}
          <div style="margin-top:3px;">${reasons}</div>
        </td>
        <td>${esc(d.platform)}</td>
        <td>${d.currentRank != null ? '#' + d.currentRank : '-'}</td>
        <td>${d.bestRank != null ? '#' + d.bestRank : '-'}</td>
        <td style="text-align:right;font-weight:600;color:#059669">${fmtHeat(d.heatValue)}</td>
        <td style="text-align:right;color:${(d.heatIncrement ?? 0) >= 0 ? '#059669' : '#dc2626'}">${fmtIncrement(d.heatIncrement)}</td>
      </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>${isHot ? '剧集（爆款候选）' : '剧集'}</th>
            <th>平台</th>
            <th>当前排名</th>
            <th>最佳排名</th>
            <th style="text-align:right">热力值</th>
            <th style="text-align:right">窗口增量</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderMetrics(m: ReportMetrics): string {
  const cards = [
    { val: m.dramaCount, label: '上榜剧集数' },
    { val: m.activePlatformCount, label: '活跃平台数' },
    { val: m.newDramaCount, label: '新剧数量' },
    { val: m.hitDramaCount, label: isNaN(m.hitDramaCount) ? '上榜数' : '爆款/Top10' },
    { val: m.avgHeat != null ? fmtHeat(m.avgHeat) : '-', label: '平均热力' },
    { val: m.topHeat != null ? fmtHeat(m.topHeat) : '-', label: 'Top1 热力' },
  ];
  return `<div class="metrics-row">${cards.map(c =>
    `<div class="metric-card"><div class="metric-val">${c.val}</div><div class="metric-label">${c.label}</div></div>`
  ).join('')}</div>`;
}

// ─── 单赛道区块渲染 ────────────────────────────────────────────────────────────

function renderTrackBlock(track: TrackAnalysis, isHot: boolean): string {
  const isReal = track.dramaType === 'ai_real';
  const badgeClass = isReal ? 'track-badge-real' : 'track-badge-manga';
  const sectionClass = isReal ? 'track-section track-real' : 'track-section track-manga';
  const color = isReal ? '#3b82f6' : '#8b5cf6';
  const listClass = isHot ? 'pattern-list' : 'insight-list';

  if (track.empty) {
    return `
      <div class="${sectionClass}">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <span class="${badgeClass}">${esc(track.label)}</span>
          <span style="font-size:13px;font-weight:700;color:#374151;">${esc(track.label)}${isHot ? '爆款分析' : '市场洞察'}</span>
        </div>
        <p style="color:#9ca3af">暂无数据</p>
      </div>`;
  }

  const patternsOrInsights = isHot ? track.hotPatterns : track.marketInsights;
  const sectionTitle = isHot ? `${track.label} · 爆款内容特征` : `${track.label} · 市场趋势判断`;

  return `
    <div class="${sectionClass}">
      <div style="display:flex;align-items:center;margin-bottom:14px;">
        <span class="${badgeClass}">${esc(track.label)}</span>
        <span style="font-size:14px;font-weight:700;color:#111827;">${esc(sectionTitle)}</span>
      </div>

      ${renderMetrics(track.metrics)}

      <h3>${isHot ? '爆款特征结论' : '市场洞察判断'}</h3>
      ${renderList(patternsOrInsights, listClass)}

      <h3>${isHot ? '代表性爆款剧目 Top10' : '热力 Top 列表'}</h3>
      ${renderTopTable(track.topDramas, isHot)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px;">
        <div>
          <h3>平台分布</h3>
          ${renderDistribution(track.platformDistribution, color)}
        </div>
        <div>
          <h3>题材分布</h3>
          ${renderDistribution(track.genreDistribution, isReal ? '#10b981' : '#a78bfa')}
        </div>
      </div>

      ${track.opportunities.length > 0 || track.risks.length > 0 ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
          ${track.opportunities.length > 0 ? `
            <div>
              <h3 style="color:#059669">机会点</h3>
              ${renderList(track.opportunities, 'opp-list')}
            </div>` : ''}
          ${track.risks.length > 0 ? `
            <div>
              <h3 style="color:#d97706">风险点</h3>
              ${renderList(track.risks, 'risk-list')}
            </div>` : ''}
        </div>` : ''}
    </div>`;
}

// ─── 爆款分析 HTML 主体 ────────────────────────────────────────────────────────

function renderHotBody(r: ReportData): string {
  if (r.empty) {
    return `
      <div style="margin-bottom:20px;">
        <h1>${esc(r.meta.title)}</h1>
        <div class="meta"><span>生成时间：${esc(r.meta.generatedAt)}</span></div>
        <div class="filter-tags">${r.meta.filterSummary.map(s => `<span class="filter-tag">${esc(s)}</span>`).join('')}</div>
      </div>
      <div class="warn-box"><p style="font-size:18px;margin-bottom:8px;">📭 暂无数据</p><p>${esc(r.summary[0])}</p></div>
      <hr class="section-divider">
      <h2>数据口径说明</h2>
      <div class="method-box"><ul class="list-ul method-box">${r.methodology.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  }

  const unclassifiedNote = r.unclassifiedCount > 0
    ? `<div class="data-note">⚠ 本周期另有 <strong>${r.unclassifiedCount}</strong> 部剧集因未分类（is_ai_drama = NULL）未纳入主分析，仅作背景参考。</div>` : '';

  const crossSection = r.crossTrackComparison.length > 0 ? `
    <div class="cross-section">
      <div class="cross-title">⚡ AI真人剧 vs AI漫剧 · 爆款差异对比</div>
      <p style="font-size:11px;color:#047857;margin-bottom:10px;">以下结论聚焦于两种内容形态在"跑量能力"上的差异，可直接用于选题与投放决策参考。</p>
      ${renderList(r.crossTrackComparison, 'cross-list')}
    </div>` : '';

  const comparisonSection = r.comparison ? `
    <h2>周期对比</h2>
    <div class="comparison-box">
      <div style="font-size:11px;color:#92400e;margin-bottom:6px;">对比周期：${r.comparison.previousStartDate} ~ ${r.comparison.previousEndDate}</div>
      ${renderList(r.comparison.summary)}
    </div>` : '';

  return `
    <div style="margin-bottom:20px;">
      <h1>${esc(r.meta.title)}</h1>
      <div class="meta"><span>生成时间：${esc(r.meta.generatedAt)}</span></div>
      <div class="filter-tags">${r.meta.filterSummary.map(s => `<span class="filter-tag">${esc(s)}</span>`).join('')}</div>
      <p style="font-size:12px;color:#6b7280;background:#fef9c3;border-radius:6px;padding:8px 14px;">
        本报告以 <strong>AI真人剧</strong> 和 <strong>AI漫剧</strong> 双赛道为主分析对象，重点识别"哪些内容正在跑出来、为什么"。
      </p>
    </div>

    ${unclassifiedNote}

    <h2>综合摘要</h2>
    <div class="summary-box">${r.summary.map(s => `<p>• ${esc(s)}</p>`).join('')}</div>

    <hr class="section-divider">

    <h2>一、AI真人剧赛道爆款分析</h2>
    ${r.aiReal ? renderTrackBlock(r.aiReal, true) : '<p style="color:#9ca3af">AI真人剧赛道未在筛选条件内</p>'}

    <hr class="section-divider">

    <h2>二、AI漫剧赛道爆款分析</h2>
    ${r.aiManga ? renderTrackBlock(r.aiManga, true) : '<p style="color:#9ca3af">AI漫剧赛道未在筛选条件内</p>'}

    <hr class="section-divider">

    <h2>三、双赛道爆款方法论对比</h2>
    ${crossSection || '<p style="color:#9ca3af">需同时包含两类数据才可对比</p>'}

    ${comparisonSection}

    <hr class="section-divider">
    <h2>数据口径说明</h2>
    <div class="method-box"><ul class="list-ul method-box">${r.methodology.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
  `;
}

// ─── 洞察识别 HTML 主体 ────────────────────────────────────────────────────────

function renderMarketBody(r: ReportData): string {
  if (r.empty) {
    return `
      <div style="margin-bottom:20px;">
        <h1>${esc(r.meta.title)}</h1>
        <div class="meta"><span>生成时间：${esc(r.meta.generatedAt)}</span></div>
        <div class="filter-tags">${r.meta.filterSummary.map(s => `<span class="filter-tag">${esc(s)}</span>`).join('')}</div>
      </div>
      <div class="warn-box"><p style="font-size:18px;margin-bottom:8px;">📭 暂无数据</p><p>${esc(r.summary[0])}</p></div>
      <hr class="section-divider">
      <h2>数据口径说明</h2>
      <div class="method-box"><ul class="list-ul method-box">${r.methodology.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  }

  const unclassifiedNote = r.unclassifiedCount > 0
    ? `<div class="data-note">⚠ 本周期另有 <strong>${r.unclassifiedCount}</strong> 部未分类剧集未纳入主分析，仅作背景参考。</div>` : '';

  const crossSection = r.crossTrackComparison.length > 0 ? `
    <div class="cross-section">
      <div class="cross-title">🔍 双赛道机会判断 · AI真人剧 vs AI漫剧</div>
      <p style="font-size:11px;color:#047857;margin-bottom:10px;">以下结论聚焦于两个赛道的竞争格局、增长动能与投入优先级判断。</p>
      ${renderList(r.crossTrackComparison, 'cross-list')}
    </div>` : '';

  const opportunitiesSection = r.opportunities.length > 0 || r.risks.length > 0 ? `
    <hr class="section-divider">
    <h2>四、综合结论与建议</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <h3 style="color:#059669">行动机会</h3>
        ${renderList(r.opportunities, 'opp-list')}
      </div>
      <div>
        <h3 style="color:#d97706">风险提示</h3>
        ${renderList(r.risks, 'risk-list')}
      </div>
    </div>` : '';

  const comparisonSection = r.comparison ? `
    <hr class="section-divider">
    <h2>周期环比</h2>
    <div class="comparison-box">
      <div style="font-size:11px;color:#92400e;margin-bottom:6px;">对比周期：${r.comparison.previousStartDate} ~ ${r.comparison.previousEndDate}</div>
      ${renderList(r.comparison.summary)}
    </div>` : '';

  return `
    <div style="margin-bottom:20px;">
      <h1>${esc(r.meta.title)}</h1>
      <div class="meta"><span>生成时间：${esc(r.meta.generatedAt)}</span></div>
      <div class="filter-tags">${r.meta.filterSummary.map(s => `<span class="filter-tag">${esc(s)}</span>`).join('')}</div>
      <p style="font-size:12px;color:#6b7280;background:#f0fdf4;border-radius:6px;padding:8px 14px;">
        本报告聚焦 <strong>AI真人剧</strong> 与 <strong>AI漫剧</strong> 市场结构与竞争变化，重点回答"市场在发生什么、机会在哪里"。
      </p>
    </div>

    ${unclassifiedNote}

    <h2>综合摘要</h2>
    <div class="summary-box">${r.summary.map(s => `<p>• ${esc(s)}</p>`).join('')}</div>

    <hr class="section-divider">

    <h2>一、AI真人剧市场洞察</h2>
    ${r.aiReal ? renderTrackBlock(r.aiReal, false) : '<p style="color:#9ca3af">AI真人剧赛道未在筛选条件内</p>'}

    <hr class="section-divider">

    <h2>二、AI漫剧市场洞察</h2>
    ${r.aiManga ? renderTrackBlock(r.aiManga, false) : '<p style="color:#9ca3af">AI漫剧赛道未在筛选条件内</p>'}

    <hr class="section-divider">

    <h2>三、双赛道机会判断</h2>
    ${crossSection || '<p style="color:#9ca3af">需同时包含两类数据才可对比</p>'}

    ${opportunitiesSection}

    ${comparisonSection}

    <hr class="section-divider">
    <h2>数据口径说明</h2>
    <div class="method-box"><ul class="list-ul method-box">${r.methodology.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
  `;
}

// ─── 通用包装 ──────────────────────────────────────────────────────────────────

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`;
}

// ─── 对外接口 ──────────────────────────────────────────────────────────────────

export function renderHotReportHtml(r: ReportData): string {
  return wrapHtml(r.meta.title, renderHotBody(r));
}

export function renderMarketReportHtml(r: ReportData): string {
  return wrapHtml(r.meta.title, renderMarketBody(r));
}
