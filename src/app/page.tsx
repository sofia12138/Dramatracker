'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart, LineChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useAuth } from '@/contexts/AuthContext';
import AIInsightDrawer from '@/components/AIInsightDrawer';

interface HotCategoryAnalysis {
  dominant_pattern: string;
  hot_threshold_explained: string;
  hot_drama_list: { title: string; platform: string; rank: number; signal: string }[];
  common_patterns: string[];
  type_distribution: { type: string; count: number }[];
  strategy_takeaways: string[];
}

interface HotSummaryData {
  summary: string;
  ai_real_analysis: HotCategoryAnalysis;
  ai_comic_analysis: HotCategoryAnalysis;
}

echarts.use([BarChart, PieChart, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

const FALLBACK_PLATFORMS = ['ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel', 'iDrama', 'StardustTV'];
const PLATFORM_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#a855f7'];

interface DashboardData {
  overview: {
    platformCount: number;
    aiDramaTotal: number;
    aiRealCount: number;
    aiMangaCount: number;
    newThisWeek: number;
    topHeatGrowth: { title: string; increment: number } | null;
  };
  platformAiCount: { platform: string; ai_real: number; ai_manga: number }[];
  languageDistribution: { language: string; count: number }[];
  tagDistribution: {
    ai_real: { tag: string; count: number }[];
    ai_comic: { tag: string; count: number }[];
  };
  tagDistributionFlat: { tag: string; count: number }[];
  weeklyHeatGrowth: Record<string, unknown>[];
  heatTop5: { title: string; growth_rate: number; increment: number }[];
  latestDate: string;
}

type TimeMode = 'today' | '7days' | '30days' | 'custom';

function formatHeat(val: number): string {
  if (Math.abs(val) >= 100000000) return (val / 100000000).toFixed(1) + '亿';
  if (Math.abs(val) >= 10000) return (val / 10000).toFixed(1) + '万';
  return val.toLocaleString();
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<TimeMode>('7days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const customRef = useRef<HTMLDivElement>(null);
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightData, setInsightData] = useState<{
    summary: string; insights: string[]; risks: string[]; suggestions: string[];
  } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [hotData, setHotData] = useState<HotSummaryData | null>(null);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotError, setHotError] = useState('');
  const { hasPermission } = useAuth();

  const handleGenerateHotSummary = async () => {
    setHotLoading(true);
    setHotError('');
    setHotData(null);
    try {
      const res = await fetch('/api/ai/hot-summary', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '请求失败');
      setHotData(json.data);
    } catch (err) {
      setHotError(err instanceof Error ? err.message : String(err));
    } finally {
      setHotLoading(false);
    }
  };

  const handleGenerateInsight = async () => {
    setInsightLoading(true);
    setInsightError('');
    setInsightData(null);
    try {
      const res = await fetch('/api/ai/insight', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '请求失败');
      setInsightData(json.data);
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : String(err));
    } finally {
      setInsightLoading(false);
    }
  };

  const fetchData = useCallback((m: TimeMode, sd?: string, ed?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ mode: m });
    if (m === 'custom' && sd && ed) {
      params.set('start_date', sd);
      params.set('end_date', ed);
    }
    fetch(`/api/dashboard/stats?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(mode); }, [fetchData, mode]);

  const handleModeChange = (m: TimeMode) => {
    if (m === 'custom') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setMode(m);
  };

  const handleCustomApply = () => {
    if (customStart && customEnd) {
      setMode('custom');
      setShowCustom(false);
      fetchData('custom', customStart, customEnd);
    }
  };

  const timeTabs: { key: TimeMode; label: string }[] = [
    { key: 'today', label: '今天' },
    { key: '7days', label: '近7天' },
    { key: '30days', label: '近30天' },
    { key: 'custom', label: '自定义' },
  ];

  const ov = data?.overview;

  // Chart 1: Platform AI drama count bar chart
  const chart1Option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['AI真人剧', 'AI漫剧'], top: 0, textStyle: { color: '#6b7280', fontSize: 12 } },
    grid: { left: 40, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: 'category' as const,
      data: data?.platformAiCount.map(p => p.platform) || [],
      axisLabel: { fontSize: 10, color: '#6b7280', rotate: 30 },
      axisLine: { lineStyle: { color: '#d0d5e0' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: 10, color: '#9ca3af' },
      splitLine: { lineStyle: { color: '#e8ecf5' } },
    },
    series: [
      {
        name: 'AI真人剧', type: 'bar', barGap: '20%',
        data: data?.platformAiCount.map(p => p.ai_real) || [],
        itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: 'AI漫剧', type: 'bar',
        data: data?.platformAiCount.map(p => p.ai_manga) || [],
        itemStyle: { color: '#8b5cf6', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };

  // Chart 2: Language pie chart
  const chart2Option = {
    tooltip: {
      trigger: 'item' as const,
      formatter: '{b}: {c}部 ({d}%)',
    },
    legend: {
      orient: 'vertical' as const, right: 10, top: 'center' as const,
      textStyle: { color: '#6b7280', fontSize: 11 },
    },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['35%', '50%'],
      avoidLabelOverlap: true,
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
      data: (data?.languageDistribution || []).map((l, i) => ({
        value: l.count,
        name: l.language,
        itemStyle: { color: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16', '#a855f7'][i % 12] },
      })),
    }],
  };

  // Chart 3: Tag horizontal bar chart (uses flat for chart compat)
  const sortedTags = data?.tagDistributionFlat || [];
  const chart3Option = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 100, right: 30, top: 10, bottom: 20 },
    xAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: 10, color: '#9ca3af' },
      splitLine: { lineStyle: { color: '#e8ecf5' } },
    },
    yAxis: {
      type: 'category' as const,
      data: [...sortedTags].reverse().map(t => t.tag),
      axisLabel: { fontSize: 11, color: '#6b7280', width: 80, overflow: 'truncate' as const },
      axisLine: { lineStyle: { color: '#d0d5e0' } },
    },
    series: [{
      type: 'bar',
      data: [...sortedTags].reverse().map(t => t.count),
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#3b5bdb' },
          { offset: 1, color: '#7c8cf5' },
        ]),
      },
      barWidth: 18,
    }],
  };

  // Chart 4: Weekly heat growth line chart
  const weeklyData = data?.weeklyHeatGrowth || [];
  const chart4Option = {
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => formatHeat(v),
    },
    legend: {
      data: FALLBACK_PLATFORMS, top: 0, type: 'scroll' as const,
      textStyle: { color: '#6b7280', fontSize: 10 },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category' as const,
      data: weeklyData.map(w => w.week as string),
      axisLabel: { fontSize: 10, color: '#6b7280' },
      axisLine: { lineStyle: { color: '#d0d5e0' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: {
        fontSize: 10, color: '#9ca3af',
        formatter: (v: number) => formatHeat(v),
      },
      splitLine: { lineStyle: { color: '#e8ecf5' } },
    },
    series: FALLBACK_PLATFORMS.map((p, i) => ({
      name: p, type: 'line', smooth: true,
      data: weeklyData.map(w => (w[p] as number) || 0),
      lineStyle: { width: 2 },
      symbol: 'circle', symbolSize: 5,
      itemStyle: { color: PLATFORM_COLORS[i] },
    })),
  };

  return (
    <div className="space-y-5">
      {/* Header + Time Filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-text">数据看板</h1>
          <p className="text-sm text-primary-text-muted mt-0.5">
            {data?.latestDate ? `最新数据：${data.latestDate}` : '暂无数据'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission('use_ai') && (
            <>
              <button onClick={handleGenerateInsight} disabled={insightLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-primary-accent to-indigo-500 text-white shadow-sm hover:opacity-90 transition-all disabled:opacity-60">
                {insightLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                {insightLoading ? '分析中...' : '生成洞察报告'}
              </button>
              <button onClick={handleGenerateHotSummary} disabled={hotLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm hover:opacity-90 transition-all disabled:opacity-60">
                {hotLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  </svg>
                )}
                {hotLoading ? '分析中...' : '爆款分析'}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 relative" ref={customRef}>
          {timeTabs.map(t => (
            <button
              key={t.key}
              onClick={() => handleModeChange(t.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all border ${
                mode === t.key
                  ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border'
                  : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
              }`}
            >
              {t.label}
            </button>
          ))}
          {showCustom && (
            <div className="absolute top-full right-0 mt-2 bg-primary-card rounded-xl shadow-lg border border-primary-border p-4 z-10 flex items-end gap-2">
              <div>
                <label className="block text-xs text-primary-text-muted mb-1">开始日期</label>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-1.5 border border-primary-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-primary-text-muted mb-1">结束日期</label>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-1.5 border border-primary-border rounded-lg text-sm" />
              </div>
              <button onClick={handleCustomApply}
                className="px-3 py-1.5 bg-primary-accent text-white text-sm rounded-lg font-medium hover:opacity-90">
                确定
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card flex items-center gap-4 py-5 px-5">
          <div className="w-12 h-12 rounded-xl bg-primary-accent-bg flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-text">{ov?.platformCount ?? '-'}</p>
            <p className="text-xs text-primary-text-muted mt-0.5">监控平台数</p>
          </div>
        </div>

        <div className="card flex items-center gap-4 py-5 px-5">
          <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-text">{ov?.aiDramaTotal ?? '-'}
              <span className="text-xs font-normal text-primary-text-muted ml-1">部</span>
            </p>
            <p className="text-xs text-primary-text-muted mt-0.5">
              AI短剧总数
              <span className="text-blue-500 ml-1">真人{ov?.aiRealCount ?? 0}</span>
              <span className="text-purple-500 ml-1">漫剧{ov?.aiMangaCount ?? 0}</span>
            </p>
          </div>
        </div>

        <div className="card flex items-center gap-4 py-5 px-5">
          <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-text">{ov?.newThisWeek ?? '-'}
              <span className="text-xs font-normal text-primary-text-muted ml-1">部</span>
            </p>
            <p className="text-xs text-primary-text-muted mt-0.5">本周新上榜</p>
          </div>
        </div>

        <div className="card flex items-center gap-4 py-5 px-5">
          <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-primary-text truncate">
              {ov?.topHeatGrowth ? ov.topHeatGrowth.title : '-'}
            </p>
            <p className="text-xs text-primary-text-muted mt-0.5">
              本周热力TOP1
              {ov?.topHeatGrowth && (
                <span className="text-green-500 ml-1">+{formatHeat(ov.topHeatGrowth.increment)}</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* AI Insight Card */}
      {insightError && (
        <div className="card border-red-200 !bg-red-50">
          <p className="text-sm text-red-600">{insightError}</p>
          <button onClick={handleGenerateInsight}
            className="mt-2 text-xs text-red-500 underline hover:text-red-700">重试</button>
        </div>
      )}
      {insightData && (
        <div className="card relative">
          <button onClick={() => setInsightData(null)}
            className="absolute top-3 right-3 p-1 rounded-lg hover:bg-primary-sidebar text-primary-text-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-5 h-5 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h2 className="text-base font-semibold text-primary-text">AI 洞察报告</h2>
          </div>
          <p className="text-sm text-primary-text mb-4 leading-relaxed">{insightData.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg bg-primary-accent-bg/50 p-3">
              <h3 className="text-xs font-semibold text-primary-accent mb-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                洞察发现
              </h3>
              <ul className="space-y-1.5">
                {insightData.insights.map((item, i) => (
                  <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                    <span className="text-primary-accent mt-0.5 shrink-0">•</span>{item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-orange-50/50 p-3">
              <h3 className="text-xs font-semibold text-orange-600 mb-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                风险信号
              </h3>
              <ul className="space-y-1.5">
                {insightData.risks.length > 0 ? insightData.risks.map((item, i) => (
                  <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                    <span className="text-orange-500 mt-0.5 shrink-0">•</span>{item}
                  </li>
                )) : (
                  <li className="text-xs text-primary-text-muted">暂无风险</li>
                )}
              </ul>
            </div>
            <div className="rounded-lg bg-green-50/50 p-3">
              <h3 className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                行动建议
              </h3>
              <ul className="space-y-1.5">
                {insightData.suggestions.map((item, i) => (
                  <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                    <span className="text-green-500 mt-0.5 shrink-0">•</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Hot Summary Card */}
      {hotError && (
        <div className="card border-red-200 !bg-red-50">
          <p className="text-sm text-red-600">{hotError}</p>
          <button onClick={handleGenerateHotSummary} className="mt-2 text-xs text-red-500 underline hover:text-red-700">重试</button>
        </div>
      )}
      {hotData && <HotSummaryCard data={hotData} onClose={() => setHotData(null)} />}

      {loading && (
        <div className="flex items-center justify-center h-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Chart Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="text-base font-semibold text-primary-text mb-3">各平台AI短剧数量对比</h2>
              <ReactEChartsCore echarts={echarts} option={chart1Option} style={{ height: 300 }} notMerge />
            </div>
            <div className="card">
              <h2 className="text-base font-semibold text-primary-text mb-3">投放语种分布</h2>
              {data.languageDistribution.length > 0 ? (
                <ReactEChartsCore echarts={echarts} option={chart2Option} style={{ height: 300 }} notMerge />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-primary-text-muted text-sm">暂无语种数据</div>
              )}
            </div>
          </div>

          {/* Chart Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="text-base font-semibold text-primary-text mb-3">题材标签分布</h2>
              {(data.tagDistribution.ai_real.length > 0 || data.tagDistribution.ai_comic.length > 0) ? (
                <div className="grid grid-cols-2 gap-4" style={{ minHeight: 300 }}>
                  <div>
                    <h3 className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />AI真人剧 Top5
                    </h3>
                    <div className="space-y-2">
                      {data.tagDistribution.ai_real.map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-primary-text-muted w-4 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-primary-text truncate">{t.tag}</span>
                              <span className="text-[11px] text-primary-text-muted shrink-0 ml-1">{t.count}部</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
                                style={{ width: `${Math.min(100, (t.count / (data.tagDistribution.ai_real[0]?.count || 1)) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                      {data.tagDistribution.ai_real.length === 0 && (
                        <p className="text-xs text-primary-text-muted py-4 text-center">暂无数据</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-purple-600 mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />AI漫剧 Top5
                    </h3>
                    <div className="space-y-2">
                      {data.tagDistribution.ai_comic.map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-primary-text-muted w-4 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-primary-text truncate">{t.tag}</span>
                              <span className="text-[11px] text-primary-text-muted shrink-0 ml-1">{t.count}部</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-600"
                                style={{ width: `${Math.min(100, (t.count / (data.tagDistribution.ai_comic[0]?.count || 1)) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                      {data.tagDistribution.ai_comic.length === 0 && (
                        <p className="text-xs text-primary-text-muted py-4 text-center">暂无数据</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-primary-text-muted text-sm">暂无标签数据</div>
              )}
            </div>
            <div className="card">
              <h2 className="text-base font-semibold text-primary-text mb-3">周环比热力增长 Top5</h2>
              {data.heatTop5 && data.heatTop5.length > 0 ? (
                <div className="space-y-3" style={{ minHeight: 300 }}>
                  {data.heatTop5.map((item, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-primary-sidebar/40 border border-primary-border/50">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900'
                        : i === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-gray-700'
                        : i === 2 ? 'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-900'
                        : 'bg-gray-100 text-gray-500'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-primary-text truncate">{item.title}</p>
                        <p className="text-[11px] text-primary-text-muted">热力增量 {formatHeat(item.increment)}</p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${item.growth_rate >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {item.growth_rate >= 0 ? '+' : ''}{item.growth_rate}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-primary-text-muted text-sm">暂无热力数据</div>
              )}
            </div>
          </div>
        </>
      )}

      <AIInsightDrawer open={insightOpen} onClose={() => setInsightOpen(false)} />
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  '爆发增长型': 'bg-red-50 text-red-700',
  '投放驱动型': 'bg-blue-50 text-blue-700',
  '内容驱动型': 'bg-green-50 text-green-700',
  '稳定长尾型': 'bg-gray-100 text-gray-600',
  '衰退下滑型': 'bg-orange-50 text-orange-700',
};

function CategoryBlock({ title, color, analysis }: {
  title: string;
  color: string;
  analysis: HotCategoryAnalysis;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-primary-text">{title}</h3>
        <span className="px-2 py-0.5 text-[11px] rounded bg-primary-accent-bg text-primary-accent">
          {analysis.dominant_pattern}
        </span>
      </div>

      <p className="text-[11px] text-primary-text-muted italic">{analysis.hot_threshold_explained}</p>

      {analysis.hot_drama_list.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-semibold text-primary-text-secondary">候选爆款</h4>
          {analysis.hot_drama_list.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-primary-accent font-medium shrink-0">#{d.rank}</span>
              <span className="font-medium text-primary-text">{d.title}</span>
              <span className="text-primary-text-muted shrink-0">({d.platform})</span>
              <span className="text-primary-text-muted ml-auto shrink-0 text-right max-w-[40%]">{d.signal}</span>
            </div>
          ))}
        </div>
      )}

      {analysis.common_patterns.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-primary-text-secondary mb-1">爆款共性</h4>
          <div className="flex flex-wrap gap-1.5">
            {analysis.common_patterns.map((p, i) => (
              <span key={i} className="px-2 py-0.5 text-[11px] bg-primary-sidebar rounded text-primary-text">{p}</span>
            ))}
          </div>
        </div>
      )}

      {analysis.type_distribution.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-primary-text-secondary mb-1">增长模式分布</h4>
          <div className="flex flex-wrap gap-1.5">
            {analysis.type_distribution.map((t, i) => (
              <span key={i} className={`px-2 py-0.5 text-[11px] rounded ${TYPE_COLORS[t.type] || 'bg-gray-100 text-gray-600'}`}>
                {t.type} ×{t.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.strategy_takeaways.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-green-600 mb-1">策略结论</h4>
          <ul className="space-y-1">
            {analysis.strategy_takeaways.map((s, i) => (
              <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                <span className="text-green-500 mt-0.5 shrink-0">•</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HotSummaryCard({ data, onClose }: { data: HotSummaryData; onClose: () => void }) {
  return (
    <div className="card relative">
      <button onClick={onClose}
        className="absolute top-3 right-3 p-1 rounded-lg hover:bg-primary-sidebar text-primary-text-muted">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        </svg>
        <h2 className="text-base font-semibold text-primary-text">爆款识别总结</h2>
      </div>

      <p className="text-sm text-primary-text mb-4 leading-relaxed">{data.summary}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
          <CategoryBlock title="AI真人剧" color="bg-blue-500" analysis={data.ai_real_analysis} />
        </div>
        <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
          <CategoryBlock title="AI漫剧" color="bg-purple-500" analysis={data.ai_comic_analysis} />
        </div>
      </div>
    </div>
  );
}
