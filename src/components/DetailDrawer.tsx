'use client';

import { useEffect, useState, useRef } from 'react';
import * as echarts from 'echarts';
import { useAuth } from '@/contexts/AuthContext';
import { useAIStream } from '@/hooks/useAIStream';
import AIMarkdown from './AIMarkdown';
import { apiFetch } from '@/lib/fetch';

interface Drama {
  id: number;
  playlet_id: string;
  title: string;
  description: string;
  language: string;
  cover_url: string;
  first_air_date: string;
  is_ai_drama: string;
  tags: string;
  creative_count: number;
}

interface DetailData {
  drama: Drama | null;
  investTrend: { platform: string; date: string; daily_invest_count: number }[];
  heatTrend: { platform: string; date: string; heat_value: number }[];
  latestRanks: { platform: string; rank: number; heat_value: number }[];
}

interface PlayCountPoint {
  record_week: string;
  total: number;
}

interface Props {
  playletId: string | null;
  onClose: () => void;
}

const AI_TYPE_MAP: Record<string, { label: string; cls: string }> = {
  ai_real: { label: 'AI真人剧', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  ai_manga: { label: 'AI漫剧', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  real: { label: '真人剧', cls: 'bg-green-100 text-green-700 border-green-200' },
};

export default function DetailDrawer({ playletId, onClose }: Props) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descText, setDescText] = useState('');
  const [playCountData, setPlayCountData] = useState<PlayCountPoint[]>([]);
  const investChartRef = useRef<HTMLDivElement>(null);
  const heatChartRef = useRef<HTMLDivElement>(null);
  const rankChartRef = useRef<HTMLDivElement>(null);
  const playCountChartRef = useRef<HTMLDivElement>(null);
  const aiReviewRef = useRef<HTMLDivElement>(null);
  const { hasPermission } = useAuth();
  const aiStream = useAIStream();

  useEffect(() => {
    if (!playletId) return;
    setLoading(true);
    apiFetch(`/api/ranking/detail?playlet_id=${playletId}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setDescText(d.drama?.description || '');
        setLoading(false);
      })
      .catch(() => setLoading(false));

    apiFetch(`/api/play-count?mode=chart&playlet_id=${playletId}`)
      .then(r => r.json())
      .then(d => setPlayCountData(Array.isArray(d) ? d : []))
      .catch(() => setPlayCountData([]));
  }, [playletId]);

  useEffect(() => {
    if (!data || loading) return;
    const timer = setTimeout(() => {
      renderInvestChart();
      renderHeatChart();
      renderRankChart();
      renderPlayCountChart();
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, playCountData]);

  const renderInvestChart = () => {
    if (!investChartRef.current || !data?.investTrend?.length) return;
    const chart = echarts.init(investChartRef.current);
    const platforms = Array.from(new Set(data.investTrend.map(i => i.platform)));
    const dates = Array.from(new Set(data.investTrend.map(i => i.date))).sort();

    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: platforms, bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10, rotate: 30 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: platforms.map(p => ({
        name: p,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        data: dates.map(d => {
          const item = data.investTrend.find(i => i.platform === p && i.date === d);
          return item?.daily_invest_count ?? 0;
        }),
      })),
    });

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  };

  const renderHeatChart = () => {
    if (!heatChartRef.current || !data?.heatTrend?.length) return;
    const chart = echarts.init(heatChartRef.current);
    const platforms = Array.from(new Set(data.heatTrend.map(i => i.platform)));
    const dates = Array.from(new Set(data.heatTrend.map(i => i.date))).sort();

    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: platforms, bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10, rotate: 30 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: platforms.map(p => ({
        name: p,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        areaStyle: { opacity: 0.1 },
        data: dates.map(d => {
          const item = data.heatTrend.find(i => i.platform === p && i.date === d);
          return item?.heat_value ?? 0;
        }),
      })),
    });

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  };

  const renderRankChart = () => {
    if (!rankChartRef.current || !data?.latestRanks?.length) return;
    const chart = echarts.init(rankChartRef.current);
    const platforms = data.latestRanks.map(r => r.platform);
    const ranks = data.latestRanks.map(r => r.rank);

    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 80, right: 20, top: 20, bottom: 20 },
      xAxis: {
        type: 'value',
        inverse: true,
        max: Math.max(...ranks) + 2,
        min: 0,
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: 'category',
        data: platforms,
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: 'bar',
        data: ranks.map(r => ({
          value: r,
          itemStyle: { color: r <= 3 ? '#3b5bdb' : r <= 10 ? '#6b7280' : '#9ca3af' },
        })),
        barWidth: 20,
        label: { show: true, position: 'right', formatter: '#{c}', fontSize: 11 },
      }],
    });

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  };

  const renderPlayCountChart = () => {
    if (!playCountChartRef.current || !playCountData.length) return;
    const chart = echarts.init(playCountChartRef.current);
    chart.setOption({
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => v.toLocaleString() },
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: playCountData.map(p => p.record_week),
        axisLabel: { fontSize: 10 },
      },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: [{
        type: 'line', smooth: true,
        data: playCountData.map(p => p.total),
        areaStyle: { opacity: 0.15, color: '#3b5bdb' },
        lineStyle: { color: '#3b5bdb', width: 2 },
        itemStyle: { color: '#3b5bdb' },
        symbol: 'circle', symbolSize: 6,
      }],
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  };

  const handleSaveDesc = async () => {
    if (!data?.drama) return;
    await apiFetch(`/api/drama/${data.drama.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: descText }),
    });
    setEditingDesc(false);
  };

  const parseTags = (tags: string) => {
    try { return JSON.parse(tags || '[]'); } catch { return []; }
  };

  if (!playletId) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[560px] bg-primary-card z-50 shadow-2xl overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
          </div>
        ) : !data?.drama ? (
          <div className="flex items-center justify-center h-full text-primary-text-muted">
            未找到剧集信息
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Header */}
            <div className="sticky top-0 bg-primary-card border-b border-primary-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-primary-text truncate">{data.drama.title}</h2>
              <button onClick={onClose} className="p-1 hover:bg-primary-sidebar rounded-lg transition-colors">
                <svg className="w-5 h-5 text-primary-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="flex gap-4">
                {data.drama.cover_url && (
                  <img src={data.drama.cover_url} alt="" className="w-24 h-32 object-cover rounded-lg shrink-0 border border-primary-border" />
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-primary-text-muted">ID: {data.drama.playlet_id}</span>
                    {data.drama.is_ai_drama && AI_TYPE_MAP[data.drama.is_ai_drama] && (
                      <span className={`px-2 py-0.5 text-xs rounded-full border ${AI_TYPE_MAP[data.drama.is_ai_drama].cls}`}>
                        {AI_TYPE_MAP[data.drama.is_ai_drama].label}
                      </span>
                    )}
                  </div>
                  {data.drama.language && (
                    <p className="text-sm text-primary-text-secondary">语种: {data.drama.language}</p>
                  )}
                  {data.drama.first_air_date && (
                    <p className="text-sm text-primary-text-secondary">上线: {data.drama.first_air_date}</p>
                  )}
                  {data.drama.creative_count > 0 && (
                    <p className="text-sm text-primary-text-secondary">投放计划: {data.drama.creative_count}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {parseTags(data.drama.tags).map((tag: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-orange-50 text-orange-600 text-xs rounded-full border border-orange-200">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-primary-text">简介</h3>
                  <button
                    onClick={() => editingDesc ? handleSaveDesc() : setEditingDesc(true)}
                    className="flex items-center gap-1 text-xs text-primary-accent hover:underline"
                  >
                    {editingDesc ? (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        保存
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        编辑
                      </>
                    )}
                  </button>
                </div>
                {editingDesc ? (
                  <textarea
                    value={descText}
                    onChange={e => setDescText(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-primary-border rounded-lg text-sm focus:outline-none focus:border-primary-accent resize-none"
                  />
                ) : (
                  <p className="text-sm text-primary-text-secondary leading-relaxed">
                    {data.drama.description || '暂无简介'}
                  </p>
                )}
              </div>

              {/* Invest Trend Chart */}
              <div>
                <h3 className="text-sm font-semibold text-primary-text mb-3">投放素材趋势</h3>
                {data.investTrend?.length > 0 ? (
                  <div ref={investChartRef} className="w-full h-52 border border-primary-border rounded-lg" />
                ) : (
                  <div className="h-32 flex items-center justify-center text-sm text-primary-text-muted border border-primary-border rounded-lg">
                    暂无投放趋势数据
                  </div>
                )}
              </div>

              {/* Heat Trend Chart */}
              <div>
                <h3 className="text-sm font-semibold text-primary-text mb-3">热力值趋势</h3>
                {data.heatTrend?.length > 0 ? (
                  <div ref={heatChartRef} className="w-full h-52 border border-primary-border rounded-lg" />
                ) : (
                  <div className="h-32 flex items-center justify-center text-sm text-primary-text-muted border border-primary-border rounded-lg">
                    暂无热力值趋势数据
                  </div>
                )}
              </div>

              {/* Platform Rank Comparison */}
              <div>
                <h3 className="text-sm font-semibold text-primary-text mb-3">各平台排名对比</h3>
                {data.latestRanks?.length > 0 ? (
                  <div ref={rankChartRef} className="w-full h-52 border border-primary-border rounded-lg" />
                ) : (
                  <div className="h-32 flex items-center justify-center text-sm text-primary-text-muted border border-primary-border rounded-lg">
                    暂无排名数据
                  </div>
                )}
              </div>

              {/* Play Count Chart */}
              <div>
                <h3 className="text-sm font-semibold text-primary-text mb-3">播放数据（近8周）</h3>
                {playCountData.length > 0 ? (
                  <div ref={playCountChartRef} className="w-full h-52 border border-primary-border rounded-lg" />
                ) : (
                  <div className="h-32 flex items-center justify-center text-sm text-primary-text-muted border border-primary-border rounded-lg">
                    暂无播放量数据
                  </div>
                )}
              </div>

              {/* AI Review */}
              {hasPermission('use_ai') && (
                <div className="pt-2 space-y-3">
                  <button
                    onClick={() => {
                      if (aiStream.loading) { aiStream.abort(); return; }
                      aiStream.reset();
                      aiStream.generate('drama_review', { playletId });
                    }}
                    disabled={!playletId}
                    className="w-full px-4 py-3 bg-gradient-to-r from-primary-accent to-indigo-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
                  >
                    {aiStream.loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        停止生成
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        AI 智能点评
                      </>
                    )}
                  </button>

                  {aiStream.error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      {aiStream.error}
                    </div>
                  )}

                  {aiStream.content && (
                    <div className="bg-primary-card border border-primary-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-primary-accent">AI 点评</span>
                        <button onClick={() => navigator.clipboard.writeText(aiStream.content)}
                          className="text-xs text-primary-text-muted hover:text-primary-accent">
                          复制
                        </button>
                      </div>
                      <AIMarkdown content={aiStream.content} />
                      {aiStream.loading && (
                        <span className="inline-block w-2 h-4 bg-primary-accent animate-pulse ml-0.5" />
                      )}
                    </div>
                  )}
                  <div ref={aiReviewRef} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
