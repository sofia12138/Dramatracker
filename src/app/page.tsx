'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { ReportData, TrackAnalysis } from '@/lib/report-analysis';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart, LineChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/fetch';

echarts.use([BarChart, PieChart, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

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
type AnalysisStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

interface StoredFilters {
  startDate: string;
  endDate: string;
}

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

  // ── 爆款分析状态 ────────────────────────────────────────────────────────────
  const [hotReport, setHotReport] = useState<ReportData | null>(null);
  const [hotStatus, setHotStatus] = useState<AnalysisStatus>('idle');
  const [hotError, setHotError] = useState('');
  const [hotFilters, setHotFilters] = useState<StoredFilters | null>(null);
  const [hotExporting, setHotExporting] = useState<'html' | 'docx' | null>(null);

  // ── 市场洞察状态 ────────────────────────────────────────────────────────────
  const [marketReport, setMarketReport] = useState<ReportData | null>(null);
  const [marketStatus, setMarketStatus] = useState<AnalysisStatus>('idle');
  const [marketError, setMarketError] = useState('');
  const [marketFilters, setMarketFilters] = useState<StoredFilters | null>(null);
  const [marketExporting, setMarketExporting] = useState<'html' | 'docx' | null>(null);

  const { hasPermission } = useAuth();

  // 根据当前 mode + latestDate 计算精确日期范围
  const getDateRange = (): StoredFilters | null => {
    const latestDate = data?.latestDate;
    if (!latestDate) return null;
    if (mode === 'custom') {
      if (!customStart || !customEnd) return null;
      return { startDate: customStart, endDate: customEnd };
    }
    const end = new Date(latestDate + 'T00:00:00Z');
    const start = new Date(end);
    if (mode === '7days') start.setUTCDate(start.getUTCDate() - 6);
    else if (mode === '30days') start.setUTCDate(start.getUTCDate() - 29);
    return { startDate: start.toISOString().slice(0, 10), endDate: latestDate };
  };

  // 筛选条件变化时清空旧结果，避免导出旧数据
  useEffect(() => {
    setHotReport(null);
    setHotStatus('idle');
    setHotError('');
    setHotFilters(null);
    setMarketReport(null);
    setMarketStatus('idle');
    setMarketError('');
    setMarketFilters(null);
  }, [mode, customStart, customEnd]);

  // ── 爆款分析 ─────────────────────────────────────────────────────────────────
  const handleGenerateHotReport = async () => {
    const range = getDateRange();
    if (!range) {
      alert('请先等待数据加载完成，或选择自定义日期范围');
      return;
    }
    setHotStatus('loading');
    setHotError('');
    setHotReport(null);
    setHotFilters(range);
    try {
      const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
      const res = await apiFetch(`/api/reports/hot/data?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '分析失败');
      setHotReport(json as ReportData);
      setHotStatus((json as ReportData).empty ? 'empty' : 'success');
    } catch (err) {
      setHotError(err instanceof Error ? err.message : String(err));
      setHotStatus('error');
    }
  };

  const handleHotExport = async (format: 'html' | 'docx') => {
    const filters = hotFilters;
    if (!filters) return;
    setHotExporting(format);
    try {
      const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
      const res = await apiFetch(`/api/reports/hot/${format}?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '导出失败' }));
        alert(`导出失败：${err.error || '未知错误'}`);
        return;
      }
      const blob = await res.blob();
      const filename = `爆款分析-${filters.startDate}_${filters.endDate}.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert(`导出错误：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setHotExporting(null);
    }
  };

  // ── 市场洞察 ─────────────────────────────────────────────────────────────────
  const handleGenerateMarketReport = async () => {
    const range = getDateRange();
    if (!range) {
      alert('请先等待数据加载完成，或选择自定义日期范围');
      return;
    }
    setMarketStatus('loading');
    setMarketError('');
    setMarketReport(null);
    setMarketFilters(range);
    try {
      const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
      const res = await apiFetch(`/api/reports/market/data?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '分析失败');
      setMarketReport(json as ReportData);
      setMarketStatus((json as ReportData).empty ? 'empty' : 'success');
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : String(err));
      setMarketStatus('error');
    }
  };

  const handleMarketExport = async (format: 'html' | 'docx') => {
    const filters = marketFilters;
    if (!filters) return;
    setMarketExporting(format);
    try {
      const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
      const res = await apiFetch(`/api/reports/market/${format}?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '导出失败' }));
        alert(`导出失败：${err.error || '未知错误'}`);
        return;
      }
      const blob = await res.blob();
      const filename = `市场洞察-${filters.startDate}_${filters.endDate}.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert(`导出错误：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMarketExporting(null);
    }
  };

  // ── Dashboard 数据获取 ────────────────────────────────────────────────────────
  const fetchData = useCallback((m: TimeMode, sd?: string, ed?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ mode: m });
    if (m === 'custom' && sd && ed) {
      params.set('start_date', sd);
      params.set('end_date', ed);
    }
    apiFetch(`/api/dashboard/stats?${params}`)
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

  const chart1Option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['AI真人剧', 'AI漫剧'], top: 0, textStyle: { color: '#6b7280', fontSize: 12 } },
    grid: { left: 40, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: 'category' as const,
      data: (data?.platformAiCount || []).map(p => p.platform),
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
        data: (data?.platformAiCount || []).map(p => p.ai_real),
        itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: 'AI漫剧', type: 'bar',
        data: (data?.platformAiCount || []).map(p => p.ai_manga),
        itemStyle: { color: '#8b5cf6', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };

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
              <button
                onClick={handleGenerateMarketReport}
                disabled={marketStatus === 'loading'}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-primary-accent to-indigo-500 text-white shadow-sm hover:opacity-90 transition-all disabled:opacity-60"
              >
                {marketStatus === 'loading' ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                {marketStatus === 'loading' ? '分析中...' : '市场洞察'}
              </button>
              <button
                onClick={handleGenerateHotReport}
                disabled={hotStatus === 'loading'}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm hover:opacity-90 transition-all disabled:opacity-60"
              >
                {hotStatus === 'loading' ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  </svg>
                )}
                {hotStatus === 'loading' ? '分析中...' : '爆款分析'}
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

      {/* 市场洞察结果卡片 */}
      {marketStatus !== 'idle' && (
        <MarketReportCard
          report={marketReport}
          status={marketStatus}
          error={marketError}
          filters={marketFilters}
          exporting={marketExporting}
          onClose={() => { setMarketStatus('idle'); setMarketReport(null); }}
          onExport={handleMarketExport}
        />
      )}

      {/* 爆款分析结果卡片 */}
      {hotStatus !== 'idle' && (
        <HotReportCard
          report={hotReport}
          status={hotStatus}
          error={hotError}
          filters={hotFilters}
          exporting={hotExporting}
          onClose={() => { setHotStatus('idle'); setHotReport(null); }}
          onExport={handleHotExport}
          onRetry={handleGenerateHotReport}
        />
      )}

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
              {(data.languageDistribution || []).length > 0 ? (
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
              {((data.tagDistribution?.ai_real || []).length > 0 || (data.tagDistribution?.ai_comic || []).length > 0) ? (
                <div className="grid grid-cols-2 gap-4" style={{ minHeight: 300 }}>
                  <div>
                    <h3 className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />AI真人剧 Top5
                    </h3>
                    <div className="space-y-2">
                      {(data.tagDistribution?.ai_real || []).map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-primary-text-muted w-4 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-primary-text truncate">{t.tag}</span>
                              <span className="text-[11px] text-primary-text-muted shrink-0 ml-1">{t.count}部</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
                                style={{ width: `${Math.min(100, (t.count / (data.tagDistribution?.ai_real?.[0]?.count || 1)) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                      {(data.tagDistribution?.ai_real || []).length === 0 && (
                        <p className="text-xs text-primary-text-muted py-4 text-center">暂无数据</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-purple-600 mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />AI漫剧 Top5
                    </h3>
                    <div className="space-y-2">
                      {(data.tagDistribution?.ai_comic || []).map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-primary-text-muted w-4 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-primary-text truncate">{t.tag}</span>
                              <span className="text-[11px] text-primary-text-muted shrink-0 ml-1">{t.count}部</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-600"
                                style={{ width: `${Math.min(100, (t.count / (data.tagDistribution?.ai_comic?.[0]?.count || 1)) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                      {(data.tagDistribution?.ai_comic || []).length === 0 && (
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
              {(data.heatTop5 || []).length > 0 ? (
                <div className="space-y-3" style={{ minHeight: 300 }}>
                  {(data.heatTop5 || []).map((item, i) => (
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
    </div>
  );
}

// ─── 导出按钮组件 ──────────────────────────────────────────────────────────────

function ExportButtons({
  exporting,
  onExport,
  hasData,
}: {
  exporting: 'html' | 'docx' | null;
  onExport: (fmt: 'html' | 'docx') => void;
  hasData: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {(['html', 'docx'] as const).map(fmt => (
        <button
          key={fmt}
          onClick={() => onExport(fmt)}
          disabled={!!exporting}
          title={hasData ? `导出 ${fmt.toUpperCase()} 报告` : '暂无数据，仍可导出空报告'}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-primary-border bg-primary-card text-primary-text-secondary hover:text-primary-accent hover:border-primary-accent transition-colors disabled:opacity-50"
        >
          {exporting === fmt ? (
            <div className="w-3 h-3 border border-primary-accent/40 border-t-primary-accent rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          {fmt.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ─── 通用：格式化热力值 ────────────────────────────────────────────────────────

function fmtHeatVal(v: number | null): string {
  if (v === null) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return Math.round(v).toLocaleString();
}

// ─── 单赛道卡片 ────────────────────────────────────────────────────────────────

function TrackBlock({ track, isHot }: { track: TrackAnalysis; isHot: boolean }) {
  const isReal = track.dramaType === 'ai_real';
  const accentColor = isReal
    ? { border: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700 border-blue-200' }
    : { border: 'border-purple-400', bg: 'bg-purple-50', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700 border-purple-200' };

  const patternsOrInsights = isHot ? track.hotPatterns : track.marketInsights;
  const sectionLabel = isHot ? '爆款特征结论' : '市场洞察判断';
  const topLabel = isHot ? `代表性爆款 Top${track.topDramas.length}` : `热力 Top${track.topDramas.length}`;

  return (
    <div className={`rounded-xl border-l-4 ${accentColor.border} border border-primary-border p-4 space-y-4`}>
      {/* 赛道标题 */}
      <div className="flex items-center gap-2">
        <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${accentColor.badge}`}>
          {track.label}
        </span>
        <span className="text-sm font-semibold text-primary-text">
          {isHot ? `${track.label} · 爆款内容特征` : `${track.label} · 市场趋势判断`}
        </span>
        {track.empty && (
          <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">暂无数据</span>
        )}
      </div>

      {track.empty ? (
        <p className="text-sm text-primary-text-muted">暂无该赛道数据</p>
      ) : (
        <>
          {/* 指标行 */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: '上榜剧集', value: track.metrics.dramaCount, unit: '部' },
              { label: '活跃平台', value: track.metrics.activePlatformCount, unit: '个' },
              { label: '新剧', value: track.metrics.newDramaCount, unit: '部' },
              { label: isHot ? '爆款候选' : 'Top10', value: track.metrics.hitDramaCount, unit: '部' },
              { label: '均热力', value: fmtHeatVal(track.metrics.avgHeat), unit: '' },
              { label: 'Top1热力', value: fmtHeatVal(track.metrics.topHeat), unit: '' },
            ].map((m, i) => (
              <div key={i} className={`rounded-lg ${accentColor.bg} p-2 text-center`}>
                <p className={`text-sm font-bold ${accentColor.text}`}>{m.value}<span className="text-[10px] font-normal ml-0.5">{m.unit}</span></p>
                <p className="text-[10px] text-primary-text-muted mt-0.5">{m.label}</p>
              </div>
            ))}
          </div>

          {/* 特征 / 洞察 */}
          {patternsOrInsights.length > 0 && (
            <div>
              <h4 className={`text-xs font-semibold ${accentColor.text} mb-2`}>{sectionLabel}</h4>
              <ul className="space-y-1.5">
                {patternsOrInsights.map((p, i) => (
                  <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-2">
                    <span className={`${accentColor.text} mt-0.5 shrink-0`}>•</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top 剧集 */}
          {track.topDramas.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-primary-text mb-2">{topLabel}</h4>
              <div className="space-y-1.5">
                {track.topDramas.map((d, i) => (
                  <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-primary-sidebar/40 border border-primary-border/50">
                    <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-orange-400 text-orange-900' : 'bg-gray-100 text-gray-500'
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-medium text-primary-text truncate">{d.title}</p>
                        {d.isNew && <span className="px-1 py-0.5 text-[9px] bg-green-50 text-green-700 rounded border border-green-200">新</span>}
                        {d.tags.slice(0, 2).map((t, ti) => (
                          <span key={ti} className="px-1 py-0.5 text-[9px] bg-primary-accent-bg text-primary-accent rounded">{t}</span>
                        ))}
                      </div>
                      <p className="text-[10px] text-primary-text-muted">{d.platform}{d.currentRank != null ? ` · #${d.currentRank}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-primary-text">{fmtHeatVal(d.heatValue)}</p>
                      {d.heatIncrement != null && <p className="text-[10px] text-green-600">+{fmtHeatVal(d.heatIncrement)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 平台 & 题材分布 */}
          {(track.platformDistribution.length > 0 || track.genreDistribution.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {track.platformDistribution.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-primary-text-muted mb-1.5">平台分布</h4>
                  <div className="space-y-1">
                    {track.platformDistribution.slice(0, 5).map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-primary-text-muted w-14 shrink-0 truncate">{p.name}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${isReal ? 'bg-blue-400' : 'bg-purple-400'}`} style={{ width: `${p.ratio}%` }} />
                        </div>
                        <span className="text-[10px] text-primary-text-muted shrink-0">{p.value}部</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {track.genreDistribution.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-primary-text-muted mb-1.5">题材分布</h4>
                  <div className="space-y-1">
                    {track.genreDistribution.slice(0, 5).map((g, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-primary-text-muted w-14 shrink-0 truncate">{g.name}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${isReal ? 'bg-emerald-400' : 'bg-violet-400'}`} style={{ width: `${g.ratio}%` }} />
                        </div>
                        <span className="text-[10px] text-primary-text-muted shrink-0">{g.value}部</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 机会 & 风险（简版） */}
          {(track.opportunities.length > 0 || track.risks.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {track.opportunities.length > 0 && (
                <div className="rounded-lg bg-green-50/60 border border-green-100 p-2.5">
                  <p className="text-[10px] font-semibold text-green-700 mb-1">机会点</p>
                  <ul className="space-y-1">
                    {track.opportunities.map((o, i) => (
                      <li key={i} className="text-[11px] text-primary-text flex gap-1.5">
                        <span className="text-green-500 shrink-0">•</span>{o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {track.risks.length > 0 && (
                <div className="rounded-lg bg-orange-50/60 border border-orange-100 p-2.5">
                  <p className="text-[10px] font-semibold text-orange-700 mb-1">风险点</p>
                  <ul className="space-y-1">
                    {track.risks.map((r, i) => (
                      <li key={i} className="text-[11px] text-primary-text flex gap-1.5">
                        <span className="text-orange-500 shrink-0">•</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 爆款分析结果卡片 ──────────────────────────────────────────────────────────

function HotReportCard({
  report,
  status,
  error,
  filters,
  exporting,
  onClose,
  onExport,
  onRetry,
}: {
  report: ReportData | null;
  status: AnalysisStatus;
  error: string;
  filters: StoredFilters | null;
  exporting: 'html' | 'docx' | null;
  onClose: () => void;
  onExport: (fmt: 'html' | 'docx') => void;
  onRetry: () => void;
}) {
  return (
    <div className="card relative">
      {/* 标题区 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <svg className="w-5 h-5 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          </svg>
          <h2 className="text-base font-semibold text-primary-text">爆款分析</h2>
          <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full">AI真人剧 · AI漫剧 双赛道</span>
          {filters && (
            <span className="text-xs text-primary-text-muted bg-primary-sidebar px-2 py-0.5 rounded">
              {filters.startDate} ~ {filters.endDate}
            </span>
          )}
          {report?.empty && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">暂无数据</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(status === 'success' || status === 'empty') && (
            <ExportButtons exporting={exporting} onExport={onExport} hasData={!report?.empty} />
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-primary-sidebar text-primary-text-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex items-center justify-center py-10 gap-3">
          <div className="w-6 h-6 border-2 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
          <span className="text-sm text-primary-text-muted">正在分析 AI真人剧 / AI漫剧 爆款数据…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-3 py-4">
          <p className="text-sm text-red-600 flex-1">{error || '分析失败，请重试'}</p>
          <button onClick={onRetry} className="text-xs text-red-500 underline hover:text-red-700">重试</button>
        </div>
      )}

      {(status === 'success' || status === 'empty') && report && (
        <div className="space-y-4">
          {/* 说明栏 */}
          <div className="text-xs text-primary-text-muted bg-orange-50/60 rounded-lg px-3 py-2 border border-orange-100">
            本报告以 <strong className="text-orange-700">AI真人剧</strong> 和 <strong className="text-orange-700">AI漫剧</strong> 为主分析对象，聚焦识别&quot;哪些内容正在跑出来、为什么&quot;。
            {report.unclassifiedCount > 0 && (
              <span className="ml-2 text-amber-700">另有 {report.unclassifiedCount} 部未分类剧集未纳入主分析。</span>
            )}
          </div>

          {/* 综合摘要 */}
          {report.summary.length > 0 && (
            <div className="rounded-lg bg-orange-50/50 border border-orange-100 p-3">
              <h3 className="text-xs font-semibold text-orange-700 mb-2">综合摘要</h3>
              <ul className="space-y-1">
                {report.summary.map((s, i) => (
                  <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                    <span className="text-orange-500 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI真人剧赛道 */}
          {report.aiReal && <TrackBlock track={report.aiReal} isHot={true} />}

          {/* AI漫剧赛道 */}
          {report.aiManga && <TrackBlock track={report.aiManga} isHot={true} />}

          {/* 双赛道爆款方法论对比 */}
          {report.crossTrackComparison.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <h3 className="text-sm font-semibold text-emerald-800 mb-3 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                AI真人剧 vs AI漫剧 · 爆款方法论对比
              </h3>
              <p className="text-[11px] text-emerald-700 mb-2">聚焦两种内容形态在&quot;跑量能力&quot;上的差异，可直接用于选题与投放决策参考。</p>
              <ul className="space-y-1.5">
                {report.crossTrackComparison.map((c, i) => (
                  <li key={i} className="text-xs text-primary-text flex gap-2">
                    <span className="text-emerald-600 shrink-0">•</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 周期对比 */}
          {report.comparison && (
            <div className="rounded-lg bg-yellow-50/60 border border-yellow-200 p-3">
              <h3 className="text-xs font-semibold text-yellow-800 mb-1.5">
                周期对比（vs {report.comparison.previousStartDate} ~ {report.comparison.previousEndDate}）
              </h3>
              <ul className="space-y-1">
                {report.comparison.summary.map((s, i) => (
                  <li key={i} className="text-xs text-primary-text flex gap-1.5">
                    <span className="text-yellow-600 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 数据口径 */}
          <div className="rounded-lg bg-primary-sidebar/40 p-3">
            <h3 className="text-[10px] font-semibold text-primary-text-muted mb-1">数据口径说明</h3>
            <ul className="space-y-0.5">
              {report.methodology.map((m, i) => (
                <li key={i} className="text-[10px] text-primary-text-muted">{m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 洞察识别结果卡片 ──────────────────────────────────────────────────────────

function MarketReportCard({
  report,
  status,
  error,
  filters,
  exporting,
  onClose,
  onExport,
}: {
  report: ReportData | null;
  status: AnalysisStatus;
  error: string;
  filters: StoredFilters | null;
  exporting: 'html' | 'docx' | null;
  onClose: () => void;
  onExport: (fmt: 'html' | 'docx') => void;
}) {
  return (
    <div className="card relative">
      {/* 标题区 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <svg className="w-5 h-5 text-primary-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h2 className="text-base font-semibold text-primary-text">洞察识别报告</h2>
          <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full">AI真人剧 · AI漫剧 市场结构</span>
          {filters && (
            <span className="text-xs text-primary-text-muted bg-primary-sidebar px-2 py-0.5 rounded">
              {filters.startDate} ~ {filters.endDate}
            </span>
          )}
          {report?.empty && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">暂无数据</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(status === 'success' || status === 'empty') && (
            <ExportButtons exporting={exporting} onExport={onExport} hasData={!report?.empty} />
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-primary-sidebar text-primary-text-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex items-center justify-center py-10 gap-3">
          <div className="w-6 h-6 border-2 border-indigo-200 border-t-primary-accent rounded-full animate-spin" />
          <span className="text-sm text-primary-text-muted">正在分析 AI真人剧 / AI漫剧 市场结构…</span>
        </div>
      )}

      {status === 'error' && (
        <p className="text-sm text-red-600 py-4">{error || '分析失败，请重试'}</p>
      )}

      {(status === 'success' || status === 'empty') && report && (
        <div className="space-y-4">
          {/* 说明栏 */}
          <div className="text-xs text-primary-text-muted bg-indigo-50/60 rounded-lg px-3 py-2 border border-indigo-100">
            本报告聚焦 <strong className="text-indigo-700">AI真人剧</strong> 与 <strong className="text-indigo-700">AI漫剧</strong> 的市场结构变化，重点回答&quot;市场发生了什么、机会在哪里&quot;。
            {report.unclassifiedCount > 0 && (
              <span className="ml-2 text-amber-700">另有 {report.unclassifiedCount} 部未分类剧集未纳入主分析。</span>
            )}
          </div>

          {/* 综合摘要 */}
          {report.summary.length > 0 && (
            <div className="rounded-lg bg-indigo-50/50 border border-indigo-100 p-3">
              <h3 className="text-xs font-semibold text-indigo-700 mb-2">综合摘要</h3>
              <ul className="space-y-1">
                {report.summary.map((s, i) => (
                  <li key={i} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                    <span className="text-indigo-500 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI真人剧市场洞察 */}
          {report.aiReal && <TrackBlock track={report.aiReal} isHot={false} />}

          {/* AI漫剧市场洞察 */}
          {report.aiManga && <TrackBlock track={report.aiManga} isHot={false} />}

          {/* 双赛道机会判断 */}
          {report.crossTrackComparison.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <h3 className="text-sm font-semibold text-emerald-800 mb-3 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                双赛道机会判断 · AI真人剧 vs AI漫剧
              </h3>
              <p className="text-[11px] text-emerald-700 mb-2">聚焦竞争格局、增长动能与资源投入优先级判断。</p>
              <ul className="space-y-1.5">
                {report.crossTrackComparison.map((c, i) => (
                  <li key={i} className="text-xs text-primary-text flex gap-2">
                    <span className="text-emerald-600 shrink-0">•</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 综合结论：机会 & 风险 */}
          {(report.opportunities.length > 0 || report.risks.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {report.opportunities.length > 0 && (
                <div className="rounded-lg bg-green-50/50 border border-green-100 p-3">
                  <h3 className="text-xs font-semibold text-green-700 mb-2">综合行动机会</h3>
                  <ul className="space-y-1">
                    {report.opportunities.map((o, i) => (
                      <li key={i} className="text-xs text-primary-text flex gap-1.5">
                        <span className="text-green-500 shrink-0">•</span>{o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.risks.length > 0 && (
                <div className="rounded-lg bg-orange-50/50 border border-orange-100 p-3">
                  <h3 className="text-xs font-semibold text-orange-700 mb-2">综合风险提示</h3>
                  <ul className="space-y-1">
                    {report.risks.map((r, i) => (
                      <li key={i} className="text-xs text-primary-text flex gap-1.5">
                        <span className="text-orange-500 shrink-0">•</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 周期环比 */}
          {report.comparison && (
            <div className="rounded-lg bg-yellow-50/60 border border-yellow-200 p-3">
              <h3 className="text-xs font-semibold text-yellow-800 mb-1.5">
                周期环比（vs {report.comparison.previousStartDate} ~ {report.comparison.previousEndDate}）
              </h3>
              <ul className="space-y-1">
                {report.comparison.summary.map((s, i) => (
                  <li key={i} className="text-xs text-primary-text flex gap-1.5">
                    <span className="text-yellow-600 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 数据口径 */}
          <div className="rounded-lg bg-primary-sidebar/40 p-3">
            <h3 className="text-[10px] font-semibold text-primary-text-muted mb-1">数据口径说明</h3>
            <ul className="space-y-0.5">
              {report.methodology.map((m, i) => (
                <li key={i} className="text-[10px] text-primary-text-muted">{m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
