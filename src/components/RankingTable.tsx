'use client';

import { useEffect, useState, useCallback } from 'react';
import Sparkline from './Sparkline';
import DetailDrawer from './DetailDrawer';
import CompetitorAnalysisPanel from './CompetitorAnalysisPanel';
import { apiFetch } from '@/lib/fetch';

interface RankingItem {
  playlet_id: string;
  platform: string;
  rank: number;
  orig_rank?: number;
  prev_rank: number | null;
  rank_change: number | null;
  is_new: boolean;
  heat_value: number;
  heat_increment?: number | null;
  current_heat_value?: number;
  material_count: number;
  invest_days: number;
  snapshot_date: string;
  title: string;
  description: string;
  cover_url: string;
  language: string;
  is_ai_drama: string;
  tags: string;
  first_air_date: string;
  creative_count: number;
  sparkline: number[];
  platforms_list?: { name: string; rank: number }[];
  best_platform?: string;
}

interface Props {
  type: 'ai_real' | 'ai_manga' | 'real';
  title: string;
}

const FALLBACK_PLATFORMS = ['all', 'trending', 'ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel', 'iDrama', 'StardustTV'];
const PLATFORM_LABELS: Record<string, string> = { all: '总榜', trending: '趋势榜' };
// 这两个是跨平台汇总榜，不是平台名
const CROSS_PLATFORM_TABS = new Set(['all', 'trending']);
const LANGUAGES = ['全部', 'English', 'Spanish', 'Portuguese', 'French', 'Indonesian', 'German'];
const TIME_MODES = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: '7days', label: '近7天' },
  { key: '30days', label: '近30天' },
  { key: 'custom', label: '自定义' },
];

const LANG_COLORS: Record<string, string> = {
  English: 'bg-primary-accent-bg text-primary-accent border-primary-accent-border',
  Spanish: 'bg-primary-accent-bg text-primary-accent border-primary-accent-border',
  Portuguese: 'bg-primary-accent-bg text-primary-accent border-primary-accent-border',
  French: 'bg-primary-accent-bg text-primary-accent border-primary-accent-border',
  Indonesian: 'bg-primary-accent-bg text-primary-accent border-primary-accent-border',
  German: 'bg-primary-accent-bg text-primary-accent border-primary-accent-border',
};

function formatHeat(val: number): string {
  if (val >= 100000000) return (val / 100000000).toFixed(1) + '亿';
  if (val >= 10000) return (val / 10000).toFixed(1) + '万';
  return val.toLocaleString();
}

function getTimeRangeLabel(latestDate: string, mode: string): string {
  if (!latestDate) return '';
  const d = new Date(latestDate + 'T00:00:00Z');
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  if (mode === 'today') return `今天（${latestDate}）`;
  if (mode === 'yesterday') {
    const yd = new Date(d);
    yd.setUTCDate(yd.getUTCDate() - 1);
    return `昨天（${fmt(yd)}）`;
  }
  if (mode === '7days') {
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - 6);
    return `近7天（${fmt(start)} ~ ${latestDate}）`;
  }
  if (mode === '30days') {
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - 29);
    return `近30天（${fmt(start)} ~ ${latestDate}）`;
  }
  return '';
}

function formatIncrement(val: number): string {
  const prefix = val > 0 ? '+' : '';
  if (Math.abs(val) >= 100000000) return prefix + (val / 100000000).toFixed(1) + '亿';
  if (Math.abs(val) >= 10000) return prefix + (val / 10000).toFixed(1) + '万';
  return prefix + val.toLocaleString();
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags || '[]');
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      if ('systemTags' in parsed || 'customTags' in parsed) {
        const result: string[] = [];
        const st = parsed.systemTags;
        if (st && typeof st === 'object' && !Array.isArray(st)) {
          for (const arr of Object.values(st)) {
            if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string') result.push(v);
          }
        }
        const ct = parsed.customTags;
        if (Array.isArray(ct)) for (const v of ct) if (typeof v === 'string') result.push(v);
        return result;
      }
      return Object.values(parsed).flat().filter((v): v is string => typeof v === 'string');
    }
    return [];
  } catch { return []; }
}

function MedalIcon({ rank }: { rank: number }) {
  const colors: Record<number, { bg: string; text: string; ring: string }> = {
    1: { bg: 'from-yellow-300 to-yellow-500', text: 'text-yellow-900', ring: 'ring-yellow-400' },
    2: { bg: 'from-gray-200 to-gray-400', text: 'text-gray-700', ring: 'ring-gray-300' },
    3: { bg: 'from-orange-300 to-orange-500', text: 'text-orange-900', ring: 'ring-orange-400' },
  };
  const c = colors[rank];
  if (!c) return null;
  return (
    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${c.bg} ring-2 ${c.ring} flex items-center justify-center shadow-sm`}>
      <span className={`text-sm font-bold ${c.text}`}>{rank}</span>
    </div>
  );
}

function RankChangeCell({ change, isNew }: { change: number | null; isNew: boolean }) {
  if (isNew) {
    return <span className="px-1.5 py-0.5 text-xs font-semibold bg-red-100 text-red-600 rounded">NEW</span>;
  }
  if (change === null || change === 0) {
    return <span className="text-xs text-primary-text-muted">-</span>;
  }
  if (change > 0) {
    return (
      <span className="text-xs font-medium text-green-600 flex items-center gap-0.5">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
        {change}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-red-500 flex items-center gap-0.5">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
      {Math.abs(change)}
    </span>
  );
}

export default function RankingTable({ type, title }: Props) {
  const [data, setData] = useState<RankingItem[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [timeMode, setTimeMode] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [langFilter, setLangFilter] = useState('全部');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [latestDate, setLatestDate] = useState('');
  const [lastUpdateTime, setLastUpdateTime] = useState('');
  const [selectedPlayletId, setSelectedPlayletId] = useState<string | null>(null);
  const [accumulating, setAccumulating] = useState(false);
  const [snapshotDays, setSnapshotDays] = useState(0);
  const [showCompetitor, setShowCompetitor] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>(FALLBACK_PLATFORMS);

  useEffect(() => {
    apiFetch('/api/platforms')
      .then(r => r.json())
      .then((list: { name: string; is_active: number }[]) => {
        const active = list.filter(p => p.is_active).map(p => p.name);
        if (active.length > 0) setPlatforms(['all', 'trending', ...active]);
      })
      .catch(() => {});
  }, []);

  const isTrending = selectedPlatform === 'trending';
  const isOverall = CROSS_PLATFORM_TABS.has(selectedPlatform);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    const params = new URLSearchParams({
      is_ai_drama: type,
      mode: timeMode,
      limit: isOverall ? '50' : '20',
    });

    if (isOverall) {
      // 跨平台汇总榜：传 ranking_mode 区分总榜/趋势榜
      params.set('ranking_mode', isTrending ? 'trending' : 'total');
    } else {
      params.set('platform', selectedPlatform);
    }
    if (timeMode === 'custom' && customStart && customEnd) {
      params.set('start_date', customStart);
      params.set('end_date', customEnd);
    }

    try {
      const res = await apiFetch(`/api/ranking?${params}`);
      const result = await res.json();
      let items: RankingItem[] = result.data || [];

      if (langFilter !== '全部') {
        items = items.filter(i => i.language === langFilter);
      }

      setData(items);
      setLatestDate(result.latestDate || '');
      setAccumulating(result.dataAccumulating || false);
      setSnapshotDays(result.snapshotDays || 0);
      setLastUpdateTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch {
      setData([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [type, selectedPlatform, timeMode, customStart, customEnd, langFilter, isOverall, isTrending]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="card !p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-primary-text">{title}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Time Tabs */}
            <div className="flex bg-primary-bg rounded-lg p-0.5 border border-primary-border">
              {TIME_MODES.map(tm => (
                <button
                  key={tm.key}
                  onClick={() => setTimeMode(tm.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    timeMode === tm.key
                      ? 'bg-primary-accent-bg text-primary-accent border border-primary-accent-border shadow-sm'
                      : 'text-primary-text-secondary hover:text-primary-text'
                  }`}
                >
                  {tm.label}
                </button>
              ))}
            </div>

            {timeMode === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-1.5 border border-primary-border rounded-lg bg-white text-xs focus:outline-none focus:border-primary-accent" />
                <span className="text-xs text-primary-text-muted">至</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-1.5 border border-primary-border rounded-lg bg-white text-xs focus:outline-none focus:border-primary-accent" />
              </div>
            )}

            {timeMode !== 'custom' && latestDate && (
              <span className="text-xs text-primary-text-muted whitespace-nowrap">
                {getTimeRangeLabel(latestDate, timeMode)}
              </span>
            )}

            {/* Language Filter */}
            <select
              value={langFilter}
              onChange={e => setLangFilter(e.target.value)}
              className="px-3 py-1.5 border border-primary-border rounded-lg bg-white text-xs text-primary-text focus:outline-none focus:border-primary-accent"
            >
              {LANGUAGES.map(l => <option key={l} value={l}>{l === '全部' ? '全部语种' : l}</option>)}
            </select>

            {/* Refresh */}
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-primary-border rounded-lg bg-white text-xs text-primary-text-secondary hover:text-primary-accent hover:border-primary-accent transition-colors disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              刷新
            </button>

            <button
              onClick={() => setShowCompetitor(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all border ${
                showCompetitor
                  ? 'bg-primary-accent text-white border-primary-accent'
                  : 'border-primary-border bg-white text-primary-text-secondary hover:text-primary-accent hover:border-primary-accent'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              竞品增长分析
            </button>

            {lastUpdateTime && (
              <span className="text-xs text-primary-text-muted whitespace-nowrap">更新于 {lastUpdateTime}</span>
            )}
          </div>
        </div>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {platforms.map((p, idx) => {
          const label = PLATFORM_LABELS[p] || p;
          const active = selectedPlatform === p;
          const isCrossTab = CROSS_PLATFORM_TABS.has(p);
          // 在跨平台 tab 和平台 tab 之间加分隔
          const showDivider = idx > 0 && isCrossTab === false && CROSS_PLATFORM_TABS.has(platforms[idx - 1]);
          return (
            <div key={p} className="flex items-center gap-1">
              {showDivider && <div className="w-px h-6 bg-primary-border/50 mx-1 self-center shrink-0" />}
              <button
                onClick={() => setSelectedPlatform(p)}
                className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all border ${
                  active
                    ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border shadow-sm'
                    : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar hover:text-primary-text'
                }`}
              >
                {label}
              </button>
            </div>
          );
        })}
      </div>

      {/* Data accumulating hint */}
      {accumulating && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-accent-bg border border-primary-accent-border rounded-lg text-sm text-primary-accent">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>历史数据积累中（已有 {snapshotDays} 天快照），每日抓取后将自动丰富，当前展示已有数据</span>
        </div>
      )}

      {/* 榜单排序说明 */}
      {isOverall && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-primary-sidebar/40 rounded-lg border border-primary-border/50 text-xs text-primary-text-muted">
          <svg className="w-3.5 h-3.5 shrink-0 text-primary-accent/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {isTrending
            ? '趋势榜：按热力增量排序，跨平台去重（同一部剧保留增量最大的平台记录）'
            : '总榜：按当前热力值排序，跨平台去重（同一部剧保留热力值最大的平台记录）'}
        </div>
      )}

      {/* Table */}
      <div className="card !p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-16 text-primary-text-muted">
            <svg className="w-12 h-12 mx-auto mb-3 text-primary-text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m6 0h6m-6 0V9a2 2 0 012-2h2a2 2 0 012 2v10m6 0v-4a2 2 0 00-2-2h-2a2 2 0 00-2 2v4" />
            </svg>
            {timeMode === 'yesterday' ? '暂无昨日数据' : '暂无榜单数据'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-primary-sidebar/50 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-3 px-3 font-medium text-primary-text-secondary w-16">排名</th>
                  <th className="text-center py-3 px-2 font-medium text-primary-text-secondary w-14">变化</th>
                  <th className="text-left py-3 px-3 font-medium text-primary-text-secondary min-w-[260px]">剧集</th>
                  <th className="text-left py-3 px-3 font-medium text-primary-text-secondary w-20">类型</th>
                  <th className="text-left py-3 px-3 font-medium text-primary-text-secondary w-20">题材</th>
                  <th className="text-left py-3 px-3 font-medium text-primary-text-secondary w-20">语种</th>
                  {isOverall && <th className="text-left py-3 px-3 font-medium text-primary-text-secondary w-32">平台</th>}
                  <th className="text-left py-3 px-2 font-medium text-primary-text-secondary w-20">上线日期</th>
                  <th className="text-center py-3 px-2 font-medium text-primary-text-secondary w-20 whitespace-nowrap">投放时长</th>
                  <th className="text-right py-3 px-3 font-medium text-primary-text-secondary w-24">累计热力值</th>
                  <th className="text-right py-3 px-3 font-medium text-primary-text-secondary w-24">
                    {accumulating
                      ? '增量（积累中）'
                      : timeMode === '7days'
                        ? (isTrending ? '7天增量↑排序' : '7天增量')
                        : timeMode === '30days'
                          ? (isTrending ? '30天增量↑排序' : '30天增量')
                          : (isTrending ? '日增量↑排序' : '日增量')}
                  </th>
                  <th className="text-center py-3 px-2 font-medium text-primary-text-secondary w-20">原榜排名</th>
                  <th className="text-center py-3 px-2 font-medium text-primary-text-secondary w-20">投放趋势</th>
                  <th className="text-center py-3 px-3 font-medium text-primary-text-secondary w-16">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, idx) => {
                  const tags = parseTags(item.tags);
                  return (
                    <tr
                      key={`${item.playlet_id}-${item.platform}-${idx}`}
                      className="border-b border-primary-border/30 hover:bg-primary-accent-bg/20 transition-colors cursor-pointer"
                      onClick={() => setSelectedPlayletId(item.playlet_id)}
                    >
                      {/* Rank */}
                      <td className="py-3 px-3">
                        <div className="flex flex-col items-start">
                          {isOverall && item.rank <= 3 ? (
                            <MedalIcon rank={item.rank} />
                          ) : (
                            <span className={`text-lg font-bold ${item.rank <= 3 ? 'text-primary-accent' : 'text-primary-text'}`}>
                              {item.rank}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Rank Change */}
                      <td className="py-3 px-2 text-center">
                        <RankChangeCell change={item.rank_change} isNew={item.is_new} />
                      </td>

                      {/* Cover + Title */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-14 rounded overflow-hidden bg-primary-sidebar shrink-0 border border-primary-border/50">
                            {item.cover_url ? (
                              <img src={item.cover_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-primary-text-muted">N/A</div>
                            )}
                          </div>
                          <p className="min-w-0 max-w-[200px] font-medium text-primary-text line-clamp-2 break-words leading-5">
                            {item.title || item.playlet_id}
                          </p>
                        </div>
                      </td>

                      {/* AI Type */}
                      <td className="py-3 px-3">
                        {item.is_ai_drama === 'ai_real' && (
                          <span className="px-2 py-0.5 text-[11px] rounded-full bg-blue-50 text-blue-600 border border-blue-200 whitespace-nowrap">AI真人</span>
                        )}
                        {item.is_ai_drama === 'ai_manga' && (
                          <span className="px-2 py-0.5 text-[11px] rounded-full bg-purple-50 text-purple-600 border border-purple-200 whitespace-nowrap">AI漫剧</span>
                        )}
                        {item.is_ai_drama === 'real' && (
                          <span className="px-2 py-0.5 text-[11px] rounded-full bg-green-50 text-green-600 border border-green-200 whitespace-nowrap">真人剧</span>
                        )}
                      </td>

                      {/* Tags */}
                      <td className="py-3 px-3">
                        {tags.length > 0 ? (
                          <div className="flex items-center gap-1 flex-nowrap">
                            {tags.slice(0, 2).map((tag: string, i: number) => (
                              <span key={i} className="px-1.5 py-0.5 text-[11px] rounded bg-orange-50 text-orange-600 border border-orange-200 whitespace-nowrap">
                                {tag}
                              </span>
                            ))}
                            {tags.length > 2 && (
                              <span className="text-[11px] text-primary-text-muted whitespace-nowrap">+{tags.length - 2}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-primary-text-muted">-</span>
                        )}
                      </td>

                      {/* Language */}
                      <td className="py-3 px-3">
                        {item.language ? (
                          <span className={`px-2 py-0.5 text-[11px] rounded-full border ${LANG_COLORS[item.language] || 'bg-primary-accent-bg text-primary-accent border-primary-accent-border'}`}>
                            {item.language}
                          </span>
                        ) : (
                          <span className="text-xs text-primary-text-muted">-</span>
                        )}
                      </td>

                      {/* Platforms (overall only) */}
                      {isOverall && (() => {
                        const seen = new Set<string>();
                        const uniquePlats = (item.platforms_list || []).filter(p => {
                          if (seen.has(p.name)) return false;
                          seen.add(p.name);
                          return true;
                        });
                        return (
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1">
                            {uniquePlats.slice(0, 3).map((p, i) => (
                              <span key={i} className="px-1.5 py-0.5 text-[10px] rounded bg-primary-sidebar text-primary-text-secondary border border-primary-border">
                                {p.name}
                              </span>
                            ))}
                            {uniquePlats.length > 3 && (
                              <span className="text-[10px] text-primary-text-muted self-center">
                                +{uniquePlats.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        );
                      })()}

                      {/* First Air Date */}
                      <td className="py-3 px-2 text-xs text-primary-text-secondary whitespace-nowrap">
                        {item.first_air_date || '-'}
                      </td>

                      {/* Invest Days */}
                      <td className="py-3 px-2 text-center">
                        <span className="text-xs text-primary-text-secondary">
                          {item.invest_days > 0 ? `第${item.invest_days}天` : '-'}
                        </span>
                      </td>

                      {/* Heat Value */}
                      <td className="py-3 px-3 text-right">
                        <span className="font-semibold text-sm text-green-700">
                          {formatHeat((isOverall ? item.current_heat_value : item.heat_value) || 0)}
                        </span>
                      </td>

                      {/* Heat Increment */}
                      <td className="py-3 px-3 text-right">
                        {item.heat_increment != null ? (
                          <span className={`font-semibold text-sm ${
                            item.heat_increment > 0 ? 'text-green-700' : item.heat_increment < 0 ? 'text-red-500' : 'text-primary-text'
                          }`}>
                            {formatIncrement(item.heat_increment)}
                          </span>
                        ) : (
                          <span className="text-xs text-primary-text-muted">-</span>
                        )}
                      </td>

                      {/* Original Platform Rank */}
                      <td className="py-3 px-2 text-center">
                        {item.orig_rank != null ? (
                          <span className="text-xs text-primary-text-secondary font-medium">#{item.orig_rank}</span>
                        ) : (
                          <span className="text-xs text-primary-text-muted">-</span>
                        )}
                      </td>

                      {/* Sparkline */}
                      <td className="py-3 px-2">
                        <div className="flex justify-center">
                          <Sparkline data={item.sparkline || []} />
                        </div>
                      </td>

                      {/* Detail Button */}
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedPlayletId(item.playlet_id); }}
                          className="px-2 py-1 text-xs text-primary-accent hover:bg-primary-accent-bg rounded transition-colors"
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Data info bar */}
        {!loading && data.length > 0 && (
          <div className="px-4 py-3 border-t border-primary-border/50 bg-primary-sidebar/30 flex items-center justify-between">
            <span className="text-xs text-primary-text-muted">
              {isOverall ? (isTrending ? '趋势榜' : '总榜') : selectedPlatform} · {latestDate ? `数据日期 ${latestDate}${timeMode === 'yesterday' ? '（昨日）' : timeMode === 'today' ? '（今日）' : ''}` : ''} · 共 {data.length} 条
            </span>
            <span className="text-xs text-primary-text-muted">
              {isOverall
                ? isTrending
                  ? `趋势榜 · 按热力增量排序 · 跨平台去重`
                  : `总榜 · 按当前热力值排序 · 跨平台去重`
                : `Top ${Math.min(20, data.length)}`}
            </span>
          </div>
        )}
      </div>

      {/* Competitor Analysis Panel */}
      {showCompetitor && (
        <CompetitorAnalysisPanel type={type} onClose={() => setShowCompetitor(false)} />
      )}

      {/* Detail Drawer */}
      <DetailDrawer
        playletId={selectedPlayletId}
        onClose={() => setSelectedPlayletId(null)}
      />
    </div>
  );
}
