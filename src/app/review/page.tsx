'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface Drama {
  id: number;
  playlet_id: string;
  title: string;
  description: string;
  language: string;
  cover_url: string;
  first_air_date: string;
  is_ai_drama: string | null;
  tags: string;
  creative_count: number;
  max_heat_value: number;
  platforms_str: string;
}

interface PlatformCount {
  platform: string;
  count: number;
}

interface Toast {
  id: number;
  message: string;
  type: string;
}

const PLATFORMS = ['ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel'];

function formatHeat(val: number): string {
  if (!val) return '0';
  if (val >= 100000000) return (val / 100000000).toFixed(1) + '亿';
  if (val >= 10000) return (val / 10000).toFixed(1) + '万';
  return val.toLocaleString();
}

function parseTags(tags: string): string[] {
  try { return JSON.parse(tags || '[]'); } catch { return []; }
}

const TYPE_LABELS: Record<string, string> = {
  ai_real: 'AI真人剧',
  ai_manga: 'AI漫剧',
  real: '真人剧',
};

export default function ReviewPage() {
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [platformCounts, setPlatformCounts] = useState<PlatformCount[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fadingOut, setFadingOut] = useState<Set<number>>(new Set());
  const toastId = useRef(0);

  const showToast = useCallback((message: string, type = 'success') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const fetchCounts = useCallback(() => {
    fetch('/api/drama/pending-count')
      .then(r => r.json())
      .then(data => {
        setTotal(data.count || 0);
        setPlatformCounts(data.platformCounts || []);
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '40',
    });
    if (selectedPlatform) params.set('platform', selectedPlatform);

    fetch(`/api/drama/review?${params}`)
      .then(r => r.json())
      .then(result => {
        setDramas(result.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, selectedPlatform]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const handleClassify = async (dramaId: number, type: string) => {
    setFadingOut(prev => new Set(prev).add(dramaId));

    try {
      await fetch(`/api/drama/${dramaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_ai_drama: type }),
      });

      const drama = dramas.find(d => d.id === dramaId);
      showToast(`"${drama?.title || ''}" 已标记为${TYPE_LABELS[type]}`);

      setTimeout(() => {
        setDramas(prev => prev.filter(d => d.id !== dramaId));
        setFadingOut(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
        setSelectedIds(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
        setTotal(prev => Math.max(0, prev - 1));
        fetchCounts();
      }, 300);
    } catch {
      setFadingOut(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
      showToast('操作失败，请重试', 'error');
    }
  };

  const handleBatchClassify = async (type: string) => {
    if (selectedIds.size === 0) { showToast('请先选择要操作的剧集', 'warn'); return; }

    const ids = Array.from(selectedIds);
    ids.forEach(id => setFadingOut(prev => new Set(prev).add(id)));

    try {
      const res = await fetch('/api/drama/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, is_ai_drama: type }),
      });
      const result = await res.json();

      showToast(`已批量标记 ${result.updated} 部为${TYPE_LABELS[type]}`);

      setTimeout(() => {
        setDramas(prev => prev.filter(d => !selectedIds.has(d.id)));
        setFadingOut(new Set());
        setSelectedIds(new Set());
        setTotal(result.remaining ?? 0);
        fetchCounts();
      }, 300);
    } catch {
      setFadingOut(new Set());
      showToast('批量操作失败', 'error');
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === dramas.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(dramas.map(d => d.id)));
    }
  };

  const getPlatformCount = (platform: string) => {
    return platformCounts.find(p => p.platform === platform)?.count || 0;
  };

  return (
    <div className="space-y-4">
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in flex items-center gap-2 ${
              toast.type === 'error' ? 'bg-red-500 text-white' :
              toast.type === 'warn' ? 'bg-amber-500 text-white' :
              'bg-[#3b5bdb] text-white'
            }`}
          >
            {toast.type === 'error' ? (
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            )}
            {toast.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-primary-text">人工审核队列</h1>
          <span className="px-3 py-1 bg-orange-100 text-orange-600 text-sm font-medium rounded-full border border-orange-200">
            待审核：{total}部
          </span>
        </div>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => { setSelectedPlatform(''); setPage(1); setSelectedIds(new Set()); }}
          className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all border ${
            !selectedPlatform
              ? 'bg-[#eef2ff] text-[#3b5bdb] border-[#c5d0fa] shadow-sm'
              : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
          }`}
        >
          全部
          <span className={`ml-1.5 text-xs ${!selectedPlatform ? 'text-[#3b5bdb]/70' : 'text-primary-text-muted'}`}>
            {total}
          </span>
        </button>
        {PLATFORMS.map(p => {
          const count = getPlatformCount(p);
          const active = selectedPlatform === p;
          return (
            <button
              key={p}
              onClick={() => { setSelectedPlatform(p); setPage(1); setSelectedIds(new Set()); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all border ${
                active
                  ? 'bg-[#eef2ff] text-[#3b5bdb] border-[#c5d0fa] shadow-sm'
                  : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
              }`}
            >
              {p}
              {count > 0 && (
                <span className={`ml-1.5 text-xs ${active ? 'text-[#3b5bdb]/70' : 'text-primary-text-muted'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Batch Actions */}
      {dramas.length > 0 && (
        <div className="card !py-3 !px-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-primary-border rounded-lg bg-white hover:bg-primary-card transition-colors"
          >
            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
              selectedIds.size === dramas.length && dramas.length > 0
                ? 'bg-[#3b5bdb] border-[#3b5bdb]'
                : 'border-primary-border'
            }`}>
              {selectedIds.size === dramas.length && dramas.length > 0 && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              )}
            </div>
            {selectedIds.size === dramas.length && dramas.length > 0 ? '取消全选' : '全选'}
          </button>

          {selectedIds.size > 0 && (
            <span className="text-xs text-primary-text-muted">已选 {selectedIds.size} 部</span>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => handleBatchClassify('ai_real')}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 bg-[#eff6ff] text-[#1d4ed8] hover:bg-blue-100"
            >
              批量AI真人剧
            </button>
            <button
              onClick={() => handleBatchClassify('ai_manga')}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 bg-[#f5f0ff] text-[#7c3aed] hover:bg-purple-100"
            >
              批量AI漫剧
            </button>
            <button
              onClick={() => handleBatchClassify('real')}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 bg-[#f9fafb] text-[#6b7280] border border-[#d0d5e0] hover:bg-gray-100"
            >
              批量真人剧
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
        </div>
      ) : dramas.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <span className="text-5xl mb-4">🎉</span>
          <p className="text-lg font-medium text-primary-text">暂无待审核剧集</p>
          <p className="text-sm text-primary-text-muted mt-1">所有剧集已审核完毕</p>
        </div>
      ) : (
        <>
          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {dramas.map(drama => {
              const tags = parseTags(drama.tags);
              const platforms = drama.platforms_str ? drama.platforms_str.split(',') : [];
              const isFading = fadingOut.has(drama.id);
              const isSelected = selectedIds.has(drama.id);

              return (
                <div
                  key={drama.id}
                  className={`bg-white rounded-xl border overflow-hidden transition-all duration-300 group ${
                    isFading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                  } ${
                    isSelected ? 'border-[#3b5bdb] ring-1 ring-[#c5d0fa]' : 'border-primary-border hover:shadow-card'
                  }`}
                >
                  {/* Cover */}
                  <div
                    className="relative aspect-[2/3] w-full bg-gray-100 cursor-pointer"
                    onClick={() => toggleSelect(drama.id)}
                  >
                    {drama.cover_url ? (
                      <img src={drama.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-primary-text-muted">
                        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}

                    {/* Selection checkbox overlay */}
                    <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-[#3b5bdb] border-[#3b5bdb]'
                        : 'bg-white/80 border-white/60 opacity-0 group-hover:opacity-100'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Heat badge */}
                    {drama.max_heat_value > 0 && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[10px] font-medium rounded-full">
                        🔥 {formatHeat(drama.max_heat_value)}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-1.5">
                    <h3 className="font-semibold text-sm text-primary-text truncate" title={drama.title}>
                      {drama.title}
                    </h3>

                    {drama.description ? (
                      <p className="text-xs text-primary-text-muted leading-relaxed line-clamp-2 min-h-[2rem]">
                        {drama.description}
                      </p>
                    ) : (
                      <p className="text-xs text-primary-text-muted/50 leading-relaxed min-h-[2rem]">
                        暂无简介
                      </p>
                    )}

                    {/* Platform tags */}
                    <div className="flex flex-wrap gap-1 min-h-[22px]">
                      {platforms.slice(0, 3).map((p, i) => (
                        <span key={i} className="px-1.5 py-0.5 text-[10px] rounded bg-primary-sidebar text-primary-text-secondary border border-primary-border">
                          {p}
                        </span>
                      ))}
                      {platforms.length > 3 && (
                        <span className="text-[10px] text-primary-text-muted self-center">+{platforms.length - 3}</span>
                      )}
                      {tags.slice(0, 2).map((tag: string, i: number) => (
                        <span key={`tag-${i}`} className="px-1.5 py-0.5 text-[10px] rounded bg-orange-50 text-orange-500 border border-orange-200">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex border-t border-primary-border">
                    <button
                      onClick={() => handleClassify(drama.id, 'ai_real')}
                      className="flex-1 flex items-center justify-center bg-[#eff6ff] text-[#1d4ed8] hover:bg-blue-100 transition-colors"
                      style={{ height: 24, fontSize: 10, gap: 4 }}
                    >
                      AI真人剧
                    </button>
                    <button
                      onClick={() => handleClassify(drama.id, 'ai_manga')}
                      className="flex-1 flex items-center justify-center bg-[#f5f0ff] text-[#7c3aed] hover:bg-purple-100 transition-colors border-l border-r border-primary-border/50"
                      style={{ height: 24, fontSize: 10, gap: 4 }}
                    >
                      AI漫剧
                    </button>
                    <button
                      onClick={() => handleClassify(drama.id, 'real')}
                      className="flex-1 flex items-center justify-center bg-[#f9fafb] text-[#6b7280] hover:bg-gray-100 transition-colors"
                      style={{ height: 24, fontSize: 10, borderTop: '0.5px solid #d0d5e0' }}
                    >
                      真人剧
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {total > 40 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-primary-text-muted">第 {page} 页，共 {Math.ceil(total / 40)} 页</span>
              <div className="flex gap-2">
                <button onClick={() => { setPage(p => Math.max(1, p - 1)); setSelectedIds(new Set()); }} disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-card bg-white">上一页</button>
                <button onClick={() => { setPage(p => p + 1); setSelectedIds(new Set()); }} disabled={page * 40 >= total}
                  className="px-3 py-1.5 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-card bg-white">下一页</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
