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
import HotAnalysisModal from '@/components/HotAnalysisModal';

echarts.use([BarChart, PieChart, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

const PLATFORMS = ['ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel'];
const PLATFORM_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#14b8a6'];

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
  tagDistribution: { tag: string; count: number }[];
  weeklyHeatGrowth: Record<string, unknown>[];
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
  const [hotOpen, setHotOpen] = useState(false);
  const { hasPermission } = useAuth();

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

  // Chart 3: Tag horizontal bar chart
  const sortedTags = data?.tagDistribution || [];
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
      data: PLATFORMS, top: 0, type: 'scroll' as const,
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
    series: PLATFORMS.map((p, i) => ({
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
              <button onClick={() => setInsightOpen(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-primary-accent to-indigo-500 text-white shadow-sm hover:opacity-90 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                生成洞察报告
              </button>
              <button onClick={() => setHotOpen(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm hover:opacity-90 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
                爆款分析
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
              <h2 className="text-base font-semibold text-primary-text mb-3">题材标签 Top 10</h2>
              {data.tagDistribution.length > 0 ? (
                <ReactEChartsCore echarts={echarts} option={chart3Option} style={{ height: 300 }} notMerge />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-primary-text-muted text-sm">暂无标签数据</div>
              )}
            </div>
            <div className="card">
              <h2 className="text-base font-semibold text-primary-text mb-3">周环比热力增长</h2>
              {data.weeklyHeatGrowth.length > 0 ? (
                <ReactEChartsCore echarts={echarts} option={chart4Option} style={{ height: 300 }} notMerge />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-primary-text-muted text-sm">暂无热力数据</div>
              )}
            </div>
          </div>
        </>
      )}

      <AIInsightDrawer open={insightOpen} onClose={() => setInsightOpen(false)} />
      <HotAnalysisModal open={hotOpen} onClose={() => setHotOpen(false)} />
    </div>
  );
}
