'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/fetch';

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
  genre_tags_ai: string | null;
  genre_tags_manual: string | null;
  genre_source: string | null;
  creative_count: number;
  max_heat_value: number;
  platforms_str: string;
}

interface ScrapeStatus {
  auto_fetch_enabled: boolean;
  auto_fetch_time: string;
  last_auto_fetch_at?: string;
  last_auto_fetch_success_at?: string;
  last_auto_fetch_status?: string;
}

interface PlatformCount {
  platform: string;
  count: number;
}

interface Toast {
  id: number;
  message: string;
  type: string;
  undoAction?: () => void;
}

interface ConfirmInfo {
  dramaId: number;
  dramaTitle: string;
  classifyType: string;
}

const PLATFORMS = ['ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel', 'iDrama', 'StardustTV'];

function formatHeat(val: number): string {
  if (!val) return '0';
  if (val >= 100000000) return (val / 100000000).toFixed(1) + '亿';
  if (val >= 10000) return (val / 10000).toFixed(1) + '万';
  return val.toLocaleString();
}

const TYPE_LABELS: Record<string, string> = {
  ai_real: 'AI真人剧',
  ai_manga: 'AI漫剧',
  real: '真人剧',
};

const GENRE_TAGS = ['情感', '狼人', '复仇', '豪门', '穿越', '逆袭', '悬疑', '家庭', '甜宠', '都市'];

function getGenreTags(drama: Drama): string[] {
  const manual = drama.genre_tags_manual;
  const ai = drama.genre_tags_ai;
  const raw = manual || ai || drama.tags;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function getScrapeStatusConfig(status?: string) {
  switch (status) {
    case 'running': return { label: '正在抓取数据', dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-50 text-blue-600 border-blue-200', border: 'border-blue-200', bg: 'bg-blue-50/40' };
    case 'success': return { label: '今日抓取成功', dot: 'bg-green-500', badge: 'bg-green-50 text-green-600 border-green-200', border: 'border-green-200', bg: 'bg-green-50/40' };
    case 'failed':  return { label: '抓取失败', dot: 'bg-red-500', badge: 'bg-red-50 text-red-600 border-red-200', border: 'border-red-200', bg: 'bg-red-50/40' };
    default:        return { label: '今日尚未抓取', dot: 'bg-gray-400', badge: 'bg-gray-50 text-gray-500 border-gray-200', border: 'border-primary-border', bg: 'bg-primary-bg' };
  }
}

function getReviewEmptyState(status?: string) {
  if (status === 'failed') return { emoji: '⚠️', title: '暂无数据', sub: '抓取失败，请重试后再审核', showAction: true };
  if (!status || status === 'idle') return { emoji: '📡', title: '暂无数据', sub: '请先执行抓取以生成待审核剧集', showAction: true };
  if (status === 'running') return { emoji: '⏳', title: '暂无数据', sub: '数据抓取中，完成后将自动刷新', showAction: false };
  return { emoji: '🎉', title: '暂无待审核剧集', sub: '所有剧集已审核完毕', showAction: false };
}

function formatShortTime(dateStr?: string) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getNextRunTime(enabled: boolean, time: string) {
  if (!enabled) return null;
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ReviewPage() {
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [platformCounts, setPlatformCounts] = useState<PlatformCount[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fadingOut, setFadingOut] = useState<Set<number>>(new Set());
  const [pendingType, setPendingType] = useState<Map<number, string>>(new Map());
  const [confirmInfo, setConfirmInfo] = useState<ConfirmInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feishuSending, setFeishuSending] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus | null>(null);
  const [scraping, setScraping] = useState(false);
  const [editingGenre, setEditingGenre] = useState<number | null>(null);
  const [genreSelection, setGenreSelection] = useState<Set<string>>(new Set());
  const [savingGenre, setSavingGenre] = useState(false);
  const [aiGenreRunning, setAiGenreRunning] = useState(false);
  const toastId = useRef(0);
  const undoTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const selectedPlatformRef = useRef(selectedPlatform);

  const showToast = useCallback((message: string, type = 'success', undoAction?: () => void) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type, undoAction }]);
    const timer = setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), undoAction ? 5000 : 3000);
    if (undoAction) undoTimers.current.set(id, timer);
  }, []);

  const fetchScrapeStatus = useCallback(() => {
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => setScrapeStatus({
        auto_fetch_enabled: data.auto_fetch_enabled || false,
        auto_fetch_time: data.auto_fetch_time || '09:00',
        last_auto_fetch_at: data.last_auto_fetch_at,
        last_auto_fetch_success_at: data.last_auto_fetch_success_at,
        last_auto_fetch_status: data.last_auto_fetch_status,
      }))
      .catch(() => {});
  }, []);

  const applyCounts = useCallback((counts: { total: number; platformCounts: PlatformCount[] }) => {
    setOverallTotal(counts.total);
    setPlatformCounts(counts.platformCounts);
    if (!selectedPlatformRef.current) {
      setTotal(counts.total);
    }
  }, []);

  const fetchCounts = useCallback(() => {
    apiFetch('/api/drama/pending-count')
      .then(r => r.json())
      .then(data => {
        applyCounts({ total: data.count || 0, platformCounts: data.platformCounts || [] });
      })
      .catch(() => {});
  }, [applyCounts]);

  const fetchData = useCallback(() => {
    setLoading(true);
    selectedPlatformRef.current = selectedPlatform;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '40',
    });
    if (selectedPlatform) params.set('platform', selectedPlatform);

    apiFetch(`/api/drama/review?${params}`)
      .then(r => r.json())
      .then(result => {
        const raw: Drama[] = result.data || [];
        const seen = new Set<number>();
        const deduped = raw.filter(d => {
          if (seen.has(d.id)) return false;
          seen.add(d.id);
          return true;
        });
        setDramas(deduped);
        setTotal(result.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, selectedPlatform]);

  const handleRunScraper = useCallback(async () => {
    if (scraping) return;
    setScraping(true);
    showToast('抓取任务已启动');
    try {
      const res = await apiFetch('/api/scraper/run', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || '启动失败', 'error');
        setScraping(false);
        return;
      }
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let lastExitCode: number | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.done) lastExitCode = d.exitCode ?? null;
            } catch { /* skip */ }
          }
        }
        if (lastExitCode === 0) {
          showToast('数据抓取完成');
        } else {
          showToast('抓取异常，请查看日志', 'error');
        }
      }
    } catch {
      showToast('抓取请求失败', 'error');
    }
    setScraping(false);
    fetchScrapeStatus();
    fetchCounts();
    fetchData();
  }, [scraping, showToast, fetchScrapeStatus, fetchCounts, fetchData]);

  useEffect(() => { fetchCounts(); fetchScrapeStatus(); }, [fetchCounts, fetchScrapeStatus]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const selectType = (dramaId: number, type: string) => {
    setPendingType(prev => {
      const m = new Map(prev);
      if (m.get(dramaId) === type) m.delete(dramaId);
      else m.set(dramaId, type);
      return m;
    });
  };

  const requestConfirm = (dramaId: number) => {
    const type = pendingType.get(dramaId);
    if (!type) return;
    const drama = dramas.find(d => d.id === dramaId);
    setConfirmInfo({ dramaId, dramaTitle: drama?.title || '', classifyType: type });
  };

  const executeClassify = async (dramaId: number, type: string) => {
    setSubmitting(true);
    setConfirmInfo(null);
    setFadingOut(prev => new Set(prev).add(dramaId));

    try {
      const res = await apiFetch(`/api/drama/${dramaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_ai_drama: type }),
      });
      const resData = await res.json();

      if (!res.ok || resData.changes === 0) {
        setFadingOut(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
        showToast(resData.error || '审核未生效，数据库未更新', 'error');
        return;
      }

      if (resData.counts) applyCounts(resData.counts);

      const drama = dramas.find(d => d.id === dramaId);

      const undoAction = async () => {
        const undoRes = await apiFetch(`/api/drama/${dramaId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_ai_drama: null }),
        });
        const undoData = await undoRes.json();
        if (undoRes.ok) {
          if (undoData.counts) applyCounts(undoData.counts);
          fetchData();
          showToast('已撤销');
        } else {
          showToast('撤销失败', 'error');
        }
      };

      showToast(`"${drama?.title || ''}" 已标记为${TYPE_LABELS[type]}`, 'success', undoAction);

      setTimeout(() => {
        setDramas(prev => prev.filter(d => d.id !== dramaId));
        setFadingOut(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
        setSelectedIds(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
        setPendingType(prev => { const m = new Map(prev); m.delete(dramaId); return m; });
        fetchData();
      }, 300);
    } catch {
      setFadingOut(prev => { const s = new Set(prev); s.delete(dramaId); return s; });
      showToast('操作失败，请重试', 'error');
    } finally {
      setTimeout(() => setSubmitting(false), 500);
    }
  };

  const handleBatchClassify = async (type: string) => {
    if (selectedIds.size === 0) { showToast('请先选择要操作的剧集', 'warn'); return; }

    const ids = Array.from(selectedIds);
    ids.forEach(id => setFadingOut(prev => new Set(prev).add(id)));

    try {
      const res = await apiFetch('/api/drama/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, is_ai_drama: type }),
      });
      const result = await res.json();

      if (!res.ok) {
        setFadingOut(new Set());
        showToast(result.error || '批量操作失败', 'error');
        return;
      }

      if (result.counts) applyCounts(result.counts);

      showToast(`已批量标记 ${result.updated} 部为${TYPE_LABELS[type]}`);

      setTimeout(() => {
        setDramas(prev => prev.filter(d => !selectedIds.has(d.id)));
        setFadingOut(new Set());
        setSelectedIds(new Set());
        fetchData();
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

  const openGenreEditor = (drama: Drama) => {
    const current = getGenreTags(drama);
    setGenreSelection(new Set(current));
    setEditingGenre(drama.id);
  };

  const toggleGenreTag = (tag: string) => {
    setGenreSelection(prev => {
      const s = new Set(prev);
      if (s.has(tag)) s.delete(tag); else s.add(tag);
      return s;
    });
  };

  const saveGenreTags = async () => {
    if (editingGenre === null) return;
    setSavingGenre(true);
    try {
      const res = await apiFetch('/api/drama/genre', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drama_id: editingGenre, genre_tags_manual: Array.from(genreSelection) }),
      });
      if (res.ok) {
        setDramas(prev => prev.map(d =>
          d.id === editingGenre
            ? { ...d, genre_tags_manual: JSON.stringify(Array.from(genreSelection)), genre_source: 'manual' }
            : d
        ));
        showToast('题材标签已保存');
      } else {
        showToast('保存失败', 'error');
      }
    } catch { showToast('网络异常', 'error'); }
    setSavingGenre(false);
    setEditingGenre(null);
  };

  const handleAiGenre = async () => {
    setAiGenreRunning(true);
    try {
      const res = await apiFetch('/api/drama/genre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`AI题材识别完成，处理 ${data.processed} 部`);
        fetchData();
      } else {
        showToast(data.error || 'AI识别失败', 'error');
      }
    } catch { showToast('网络异常', 'error'); }
    setAiGenreRunning(false);
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
              'bg-primary-accent text-white'
            }`}
          >
            {toast.type === 'error' ? (
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            )}
            <span className="flex-1">{toast.message}</span>
            {toast.undoAction && (
              <button
                onClick={() => {
                  toast.undoAction?.();
                  setToasts(prev => prev.filter(t => t.id !== toast.id));
                  const timer = undoTimers.current.get(toast.id);
                  if (timer) { clearTimeout(timer); undoTimers.current.delete(toast.id); }
                }}
                className="ml-2 px-2 py-0.5 text-xs font-bold bg-white/20 rounded hover:bg-white/30 transition-colors"
              >
                撤销
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Confirm Dialog */}
      {confirmInfo && (
        <>
          <div className="fixed inset-0 bg-black/30 z-50" onClick={() => setConfirmInfo(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-primary-card rounded-xl shadow-2xl p-6 w-[360px] border border-primary-border">
            <h3 className="text-base font-semibold text-primary-text mb-3">确认审核分类</h3>
            <div className="space-y-2 mb-5">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-primary-text-muted w-12 shrink-0">剧名</span>
                <span className="font-medium text-primary-text truncate">{confirmInfo.dramaTitle}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-primary-text-muted w-12 shrink-0">分类</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  confirmInfo.classifyType === 'ai_real' ? 'bg-[#eff6ff] text-[#1d4ed8]' :
                  confirmInfo.classifyType === 'ai_manga' ? 'bg-[#f5f0ff] text-[#7c3aed]' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {TYPE_LABELS[confirmInfo.classifyType]}
                </span>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmInfo(null)}
                className="px-4 py-1.5 text-sm border border-primary-border rounded-lg hover:bg-primary-sidebar transition-colors">
                取消
              </button>
              <button
                onClick={() => executeClassify(confirmInfo.dramaId, confirmInfo.classifyType)}
                disabled={submitting}
                className="px-4 py-1.5 text-sm font-medium bg-primary-accent text-white rounded-lg hover:opacity-90 transition-all disabled:opacity-60"
              >
                确认提交
              </button>
            </div>
          </div>
        </>
      )}

      {/* Genre Editor Modal */}
      {editingGenre !== null && (
        <>
          <div className="fixed inset-0 bg-black/30 z-50" onClick={() => setEditingGenre(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-primary-card rounded-xl shadow-2xl p-5 w-[340px] border border-primary-border">
            <h3 className="text-sm font-semibold text-primary-text mb-1">编辑题材标签</h3>
            <p className="text-[11px] text-primary-text-muted mb-3">
              {dramas.find(d => d.id === editingGenre)?.title}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {GENRE_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleGenreTag(tag)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                    genreSelection.has(tag)
                      ? 'bg-orange-500 text-white border-orange-500 font-medium'
                      : 'bg-white text-primary-text-secondary border-primary-border hover:border-orange-300'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingGenre(null)}
                className="px-3 py-1.5 text-xs border border-primary-border rounded-lg hover:bg-primary-sidebar transition-colors">
                取消
              </button>
              <button
                onClick={saveGenreTags}
                disabled={savingGenre}
                className="px-3 py-1.5 text-xs font-medium bg-primary-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {savingGenre ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-primary-text">人工审核队列</h1>
          <span className="px-3 py-1 bg-orange-100 text-orange-600 text-sm font-medium rounded-full border border-orange-200">
            待审核：{total}部
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAiGenre}
            disabled={aiGenreRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-primary-border bg-white text-primary-text-secondary hover:text-primary-accent hover:border-primary-accent transition-colors disabled:opacity-50"
          >
            {aiGenreRunning ? (
              <div className="w-3.5 h-3.5 border-[1.5px] border-primary-accent border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            )}
            {aiGenreRunning ? '识别中...' : 'AI补全题材'}
          </button>
        <button
          disabled={feishuSending}
          onClick={async () => {
            setFeishuSending(true);
            try {
              const res = await apiFetch('/api/notify/review-alert', { method: 'POST' });
              const data = await res.json();
              if (!res.ok) { showToast(data.error || '发送失败', 'error'); return; }
              showToast(data.notified ? `飞书提醒已发送（${data.count}条待审核）` : '当前没有待审核短剧，无需提醒');
            } catch { showToast('网络异常，请重试', 'error'); }
            finally { setFeishuSending(false); }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-primary-border bg-white text-primary-text-secondary hover:text-primary-accent hover:border-primary-accent transition-colors disabled:opacity-50"
        >
          <svg className={`w-3.5 h-3.5 ${feishuSending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {feishuSending
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            }
          </svg>
          {feishuSending ? '发送中...' : '飞书提醒'}
        </button>
        </div>
      </div>

      {/* Scrape Status Card */}
      {scrapeStatus && (() => {
        const sc = getScrapeStatusConfig(scrapeStatus.last_auto_fetch_status);
        const lastRun = formatShortTime(scrapeStatus.last_auto_fetch_at);
        const lastSuccess = formatShortTime(scrapeStatus.last_auto_fetch_success_at);
        const nextRun = getNextRunTime(scrapeStatus.auto_fetch_enabled, scrapeStatus.auto_fetch_time);

        return (
          <div className={`card !py-3 !px-4 border ${sc.border} ${sc.bg}`}>
            <div className="flex items-center gap-4">
              {/* Primary: status summary */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border ${sc.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {sc.label}
                  </span>
                  {scrapeStatus.last_auto_fetch_status === 'success' && overallTotal > 0 && (
                    <span className="text-xs text-primary-text-muted">· 待审核 {overallTotal} 部</span>
                  )}
                  {scrapeStatus.last_auto_fetch_status === 'success' && lastSuccess && (
                    <span className="text-xs text-primary-text-muted">· {lastSuccess} 更新</span>
                  )}
                  {scrapeStatus.last_auto_fetch_status !== 'success' && nextRun && (
                    <span className="text-xs text-primary-text-muted">· 下次执行 {nextRun}</span>
                  )}
                </div>
                {/* Secondary details */}
                {(lastRun || lastSuccess) ? (
                  <div className="flex items-center gap-4 mt-1.5">
                    {lastRun && (
                      <span className="text-[11px] text-primary-text-muted">上次执行 {lastRun}</span>
                    )}
                    {lastSuccess && lastSuccess !== lastRun && (
                      <span className="text-[11px] text-primary-text-muted">上次成功 {lastSuccess}</span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-primary-text-muted mt-1.5">暂无执行记录</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => fetchScrapeStatus()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-primary-text-secondary border border-primary-border rounded-lg hover:bg-primary-sidebar transition-colors bg-white"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  刷新
                </button>
                <button
                  onClick={handleRunScraper}
                  disabled={scraping}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white bg-primary-accent rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {scraping ? (
                    <div className="w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {scraping ? '抓取中…' : '立即抓取'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Platform Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => { setSelectedPlatform(''); setPage(1); setSelectedIds(new Set()); }}
          className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all border ${
            !selectedPlatform
              ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border shadow-sm'
              : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
          }`}
        >
          全部
          <span className={`ml-1.5 text-xs ${!selectedPlatform ? 'text-primary-accent/70' : 'text-primary-text-muted'}`}>
            {overallTotal}
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
                  ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border shadow-sm'
                  : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
              }`}
            >
              {p}
              {count > 0 && (
                <span className={`ml-1.5 text-xs ${active ? 'text-primary-accent/70' : 'text-primary-text-muted'}`}>
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-primary-border rounded-lg bg-primary-card hover:bg-primary-sidebar transition-colors"
          >
            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
              selectedIds.size === dramas.length && dramas.length > 0
                ? 'bg-primary-accent border-primary-accent'
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
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe]"
            >
              批量AI真人剧
            </button>
            <button
              onClick={() => handleBatchClassify('ai_manga')}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 bg-[#f5f0ff] text-[#7c3aed] hover:bg-[#ede9fe]"
            >
              批量AI漫剧
            </button>
            <button
              onClick={() => handleBatchClassify('real')}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 bg-primary-card text-primary-text-secondary border border-primary-border hover:bg-primary-sidebar"
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
      ) : dramas.length === 0 ? (() => {
        const es = getReviewEmptyState(scrapeStatus?.last_auto_fetch_status);
        return (
          <div className="card flex flex-col items-center justify-center py-16">
            <span className="text-4xl mb-3">{es.emoji}</span>
            <p className="text-base font-medium text-primary-text">{es.title}</p>
            <p className="text-sm text-primary-text-muted mt-1">{es.sub}</p>
            {es.showAction && (
              <button
                onClick={handleRunScraper}
                disabled={scraping}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-accent rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {scraping ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {scraping ? '抓取中…' : '立即抓取'}
              </button>
            )}
          </div>
        );
      })() : (
        <>
          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {dramas.map(drama => {
              const platforms = drama.platforms_str ? drama.platforms_str.split(',') : [];
              const isFading = fadingOut.has(drama.id);
              const isSelected = selectedIds.has(drama.id);

              return (
                <div
                  key={drama.id}
                  className={`bg-primary-card rounded-xl border overflow-hidden transition-all duration-300 group ${
                    isFading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                  } ${
                    isSelected ? 'border-primary-accent ring-1 ring-primary-accent-border' : 'border-primary-border hover:shadow-card'
                  }`}
                >
                  {/* Cover */}
                  <div
                    className="relative aspect-[2/3] w-full bg-primary-sidebar cursor-pointer"
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
                        ? 'bg-primary-accent border-primary-accent'
                        : 'bg-primary-card/80 border-primary-border/60 opacity-0 group-hover:opacity-100'
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
                    </div>
                    {/* Genre tags */}
                    <div className="flex items-center gap-1 min-h-[22px]">
                      {(() => {
                        const genreTags = getGenreTags(drama);
                        if (genreTags.length > 0) {
                          return genreTags.slice(0, 3).map((tag: string, i: number) => (
                            <span key={`g-${i}`} className="px-1.5 py-0.5 text-[10px] rounded bg-orange-50 text-orange-500 border border-orange-200">
                              {tag}
                            </span>
                          ));
                        }
                        return (
                          <span className="text-[10px] text-amber-500 italic">题材待补充</span>
                        );
                      })()}
                      <button
                        onClick={(e) => { e.stopPropagation(); openGenreEditor(drama); }}
                        className="ml-auto p-0.5 text-primary-text-muted hover:text-primary-accent transition-colors"
                        title="编辑题材"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Action Buttons - Two-step: select then confirm */}
                  <div className="border-t border-primary-border">
                    <div className="flex">
                      {([
                        { key: 'ai_real', label: 'AI真人剧', bg: 'bg-[#eff6ff]', bgActive: 'bg-[#1d4ed8]', text: 'text-[#1d4ed8]' },
                        { key: 'ai_manga', label: 'AI漫剧', bg: 'bg-[#f5f0ff]', bgActive: 'bg-[#7c3aed]', text: 'text-[#7c3aed]' },
                        { key: 'real', label: '真人剧', bg: 'bg-gray-50', bgActive: 'bg-gray-500', text: 'text-gray-600' },
                      ] as const).map((opt, idx) => {
                        const selected = pendingType.get(drama.id) === opt.key;
                        return (
                          <button
                            key={opt.key}
                            onClick={() => selectType(drama.id, opt.key)}
                            className={`flex-1 flex items-center justify-center transition-all ${
                              selected ? `${opt.bgActive} text-white font-semibold` : `${opt.bg} ${opt.text} hover:opacity-80`
                            } ${idx > 0 ? 'border-l border-primary-border/30' : ''}`}
                            style={{ height: 28, fontSize: 10, gap: 3 }}
                          >
                            {selected && (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {pendingType.has(drama.id) && (
                      <button
                        onClick={() => requestConfirm(drama.id)}
                        disabled={submitting}
                        className="w-full flex items-center justify-center gap-1 bg-primary-accent text-white hover:opacity-90 transition-all disabled:opacity-60 font-medium"
                        style={{ height: 26, fontSize: 11 }}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        确认提交
                      </button>
                    )}
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
                  className="px-3 py-1.5 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-sidebar bg-primary-card">上一页</button>
                <button onClick={() => { setPage(p => p + 1); setSelectedIds(new Set()); }} disabled={page * 40 >= total}
                  className="px-3 py-1.5 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-sidebar bg-primary-card">下一页</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
