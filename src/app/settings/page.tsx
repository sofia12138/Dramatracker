'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';


interface Platform {
  id: number;
  name: string;
  product_ids: string;
  is_active: number;
  created_at: string;
}

interface Config {
  cookie: string;
  cookie_updated_at: string;
  cookie_status: string;
  auto_fetch_enabled: boolean;
  auto_fetch_time: string;
}

interface Stats {
  totalDramas: number;
  totalSnapshots: number;
  pendingReview: number;
  aiRealCount: number;
  aiMangaCount: number;
  realCount: number;
  totalInvestTrend: number;
  totalPlayCount: number;
}

interface Toast {
  id: number;
  message: string;
  type: string;
}

function parseProductIds(ids: string): number[] {
  try { return JSON.parse(ids); } catch { return []; }
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  // Cookie
  const [cookieText, setCookieText] = useState('');
  const [savingCookie, setSavingCookie] = useState(false);
  const [cookieCheckResult, setCookieCheckResult] = useState<{ status: string; message: string } | null>(null);

  // Auto fetch
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(false);
  const [autoFetchTime, setAutoFetchTime] = useState('09:00');

  // Manual fetch
  const [fetching, setFetching] = useState(false);
  const [fetchLogs, setFetchLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Platform form
  const [showPlatformForm, setShowPlatformForm] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [platformForm, setPlatformForm] = useState({ name: '', android_id: '', ios_id: '' });

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const { hasPermission } = useAuth();

  // Toast
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((message: string, type = 'success') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, platformsRes, statsRes] = await Promise.all([
        fetch('/api/config').then(r => r.json()),
        fetch('/api/platforms').then(r => r.json()),
        fetch('/api/settings/stats').then(r => r.json()),
      ]);
      setConfig(configRes);
      setCookieText(configRes.cookie || '');
      setAutoFetchEnabled(configRes.auto_fetch_enabled || false);
      setAutoFetchTime(configRes.auto_fetch_time || '09:00');
      setPlatforms(platformsRes);
      setStats(statsRes);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // --- Cookie ---
  const handleSaveCookie = async () => {
    setSavingCookie(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: cookieText }),
      });
      showToast('Cookie 已保存');
      const res = await fetch('/api/config').then(r => r.json());
      setConfig(res);
    } catch { showToast('保存失败', 'error'); }
    setSavingCookie(false);
  };

  // --- Auto Fetch ---
  const handleAutoFetchChange = async (enabled: boolean) => {
    setAutoFetchEnabled(enabled);
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_fetch_enabled: enabled }),
    });
    showToast(enabled ? '已启用自动抓取' : '已关闭自动抓取');
  };

  const handleAutoFetchTimeChange = async (time: string) => {
    setAutoFetchTime(time);
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_fetch_time: time }),
    });
  };

  // --- Manual Fetch ---
  const handleManualFetch = async (backfill = 0) => {
    setFetching(true);
    setFetchLogs([`[${new Date().toLocaleTimeString()}] 启动 Python 抓取脚本...${backfill > 0 ? ` (补抓${backfill}天)` : ''}`]);

    const addLog = (msg: string) => {
      setFetchLogs(prev => [...prev, msg]);
      setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
    };

    try {
      const res = await fetch('/api/scraper/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backfill }),
      });

      if (!res.ok) {
        const data = await res.json();
        addLog(`❌ 启动失败: ${data.error || res.statusText}`);
        setFetching(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { addLog('❌ 无法读取响应流'); setFetching(false); return; }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) addLog(data.text.replace(/\n$/, ''));
            if (data.done) {
              addLog(data.exitCode === 0 ? '✅ 抓取完成' : `⚠️ 脚本退出码: ${data.exitCode}`);
              if (data.exitCode === 0) {
                fetchAll();
                showToast('数据抓取完成');
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      addLog(`❌ 抓取失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    setFetching(false);
  };

  // --- Platform ---
  const handlePlatformSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const productIds: number[] = [];
    if (platformForm.android_id) {
      platformForm.android_id.split(',').forEach(s => {
        const n = parseInt(s.trim());
        if (!isNaN(n)) productIds.push(n);
      });
    }
    if (platformForm.ios_id) {
      platformForm.ios_id.split(',').forEach(s => {
        const n = parseInt(s.trim());
        if (!isNaN(n)) productIds.push(n);
      });
    }

    const body = { name: platformForm.name, product_ids: productIds, is_active: 1 };

    if (editingPlatform) {
      await fetch(`/api/platforms/${editingPlatform.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      showToast('平台已更新');
    } else {
      await fetch('/api/platforms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      showToast('平台已添加');
    }
    setShowPlatformForm(false);
    setEditingPlatform(null);
    setPlatformForm({ name: '', android_id: '', ios_id: '' });
    const res = await fetch('/api/platforms').then(r => r.json());
    setPlatforms(res);
  };

  const handleTogglePlatform = async (platform: Platform) => {
    const newActive = platform.is_active ? 0 : 1;
    await fetch(`/api/platforms/${platform.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: platform.name, product_ids: parseProductIds(platform.product_ids), is_active: newActive }),
    });
    showToast(newActive ? `${platform.name} 已启用` : `${platform.name} 已停用`);
    const res = await fetch('/api/platforms').then(r => r.json());
    setPlatforms(res);
  };

  const handleDeletePlatform = async (id: number) => {
    await fetch(`/api/platforms/${id}`, { method: 'DELETE' });
    showToast('平台已删除');
    setConfirmDelete(null);
    const res = await fetch('/api/platforms').then(r => r.json());
    setPlatforms(res);
  };

  const handleEditPlatform = (p: Platform) => {
    const ids = parseProductIds(p.product_ids);
    setEditingPlatform(p);
    setPlatformForm({ name: p.name, android_id: ids.join(', '), ios_id: '' });
    setShowPlatformForm(true);
  };

  // --- Clear Data ---
  const handleClearData = async () => {
    await fetch('/api/settings/stats', { method: 'DELETE' });
    showToast('历史数据已清空');
    setConfirmClear(false);
    const res = await fetch('/api/settings/stats').then(r => r.json());
    setStats(res);
  };

  // --- Next run time ---
  const getNextRunTime = () => {
    if (!autoFetchEnabled) return '未启用';
    const now = new Date();
    const [h, m] = autoFetchTime.split(':').map(Number);
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-primary-accent text-white'
          }`}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {toast.message}
          </div>
        ))}
      </div>

      <h1 className="text-xl font-bold text-primary-text">设置</h1>

      {/* ====== 1. Cookie 配置 ====== */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary-text">Cookie 配置</h2>
          <div className="flex items-center gap-2">
            {config?.cookie ? (
              <span className="flex items-center gap-1 text-xs text-primary-text-secondary">
                <span>📋</span> 已配置
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-red-500">
                <span>❌</span> 未配置
              </span>
            )}
          </div>
        </div>

        <textarea
          value={cookieText}
          onChange={e => setCookieText(e.target.value)}
          placeholder="请粘贴 DataEye 的 Cookie 字符串..."
          rows={4}
          className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-xs font-mono focus:outline-none focus:border-primary-accent resize-none"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCookie}
              disabled={savingCookie}
              className="px-4 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {savingCookie ? '保存中...' : '保存 Cookie'}
            </button>
            <button
              onClick={async () => {
                setCookieCheckResult({ status: 'checking', message: '检测中...' });
                try {
                  const res = await fetch('/api/config/check-cookie', { method: 'POST' });
                  const data = await res.json();
                  setCookieCheckResult(data);
                } catch {
                  setCookieCheckResult({ status: 'error', message: '网络异常' });
                }
              }}
              disabled={!config?.cookie || cookieCheckResult?.status === 'checking'}
              className="px-3 py-2 border border-primary-border text-primary-text-secondary rounded-lg text-sm font-medium hover:bg-primary-card transition-colors disabled:opacity-50"
            >
              {cookieCheckResult?.status === 'checking' ? '检测中...' : '检测 Cookie'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {cookieCheckResult && cookieCheckResult.status !== 'checking' && (
              <span className={`flex items-center gap-1 text-xs font-medium ${
                cookieCheckResult.status === 'valid' ? 'text-green-600' :
                cookieCheckResult.status === 'expired' ? 'text-orange-500' : 'text-red-500'
              }`}>
                {cookieCheckResult.status === 'valid' ? '✅ 有效' :
                 cookieCheckResult.status === 'expired' ? '⚠️ 已失效' : '❌ 检测失败'}
              </span>
            )}
            {config?.cookie_updated_at && (
              <span className="text-xs text-primary-text-muted">
                最后更新：{new Date(config.cookie_updated_at).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ====== 2. 自动抓取配置 ====== */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-primary-text">自动抓取配置</h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-primary-text">启用每日自动抓取</p>
            <p className="text-xs text-primary-text-muted mt-0.5">每天定时从 DataEye 拉取最新榜单数据</p>
          </div>
          <button
            onClick={() => handleAutoFetchChange(!autoFetchEnabled)}
            className={`relative w-11 h-6 rounded-full transition-colors ${autoFetchEnabled ? 'bg-primary-accent' : 'bg-primary-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${autoFetchEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs text-primary-text-secondary mb-1">每天执行时间</label>
            <input
              type="time"
              value={autoFetchTime}
              onChange={e => handleAutoFetchTimeChange(e.target.value)}
              disabled={!autoFetchEnabled}
              className="px-3 py-1.5 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-primary-text-secondary mb-1">下次执行</label>
            <p className="text-sm text-primary-text">{getNextRunTime()}</p>
          </div>
        </div>
      </div>

      {/* ====== 3. 手动抓取 ====== */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary-text">手动抓取</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleManualFetch(7)}
              disabled={fetching}
              className="px-3 py-2 border border-primary-border text-primary-text-secondary rounded-lg text-xs font-medium hover:bg-primary-card transition-colors disabled:opacity-50"
            >
              补抓7天
            </button>
            <button
              onClick={() => handleManualFetch(0)}
              disabled={fetching}
              className="px-4 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {fetching && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {fetching ? '抓取中...' : '立即抓取'}
            </button>
          </div>
        </div>

        {fetchLogs.length > 0 && (
          <div
            ref={logRef}
            className="bg-[#1a1a2e] rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed"
          >
            {fetchLogs.map((l, i) => (
              <div key={i} className={l.includes('❌') || l.includes('STDERR') ? 'text-red-400' : l.includes('✅') ? 'text-green-400' : l.includes('⚠️') ? 'text-yellow-400' : 'text-green-400'}>
                {l}
              </div>
            ))}
            {fetching && <div className="text-green-400 animate-pulse">▊</div>}
          </div>
        )}
      </div>

      {/* ====== 4. 平台管理 ====== */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary-text">平台管理</h2>
          <button
            onClick={() => {
              setShowPlatformForm(!showPlatformForm);
              setEditingPlatform(null);
              setPlatformForm({ name: '', android_id: '', ios_id: '' });
            }}
            className="px-3 py-1.5 bg-primary-accent text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
          >
            {showPlatformForm ? '取消' : '+ 添加平台'}
          </button>
        </div>

        {showPlatformForm && (
          <form onSubmit={handlePlatformSubmit} className="p-4 bg-primary-bg rounded-lg border border-primary-border space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-primary-text-secondary mb-1">平台名称 *</label>
                <input type="text" required value={platformForm.name}
                  onChange={e => setPlatformForm({ ...platformForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
              </div>
              <div>
                <label className="block text-xs text-primary-text-secondary mb-1">Android Product ID（选填，逗号分隔）</label>
                <input type="text" value={platformForm.android_id}
                  onChange={e => setPlatformForm({ ...platformForm, android_id: e.target.value })}
                  placeholder="如 365084, 365123"
                  className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
              </div>
              <div>
                <label className="block text-xs text-primary-text-secondary mb-1">iOS Product ID（选填，逗号分隔）</label>
                <input type="text" value={platformForm.ios_id}
                  onChange={e => setPlatformForm({ ...platformForm, ios_id: e.target.value })}
                  placeholder="如 365099"
                  className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
              </div>
            </div>
            <button type="submit"
              className="px-5 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90">
              {editingPlatform ? '更新' : '添加'}
            </button>
          </form>
        )}

        <div className="divide-y divide-primary-border/50">
          {platforms.map(p => {
            const pids = parseProductIds(p.product_ids);
            return (
              <div key={p.id} className="flex items-center gap-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-primary-text">{p.name}</span>
                    {!p.is_active && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-primary-sidebar text-primary-text-muted rounded">已停用</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pids.map(pid => (
                      <span key={pid} className="px-1.5 py-0.5 text-[10px] rounded bg-primary-accent-bg text-primary-accent border border-primary-accent-border">
                        {pid}
                      </span>
                    ))}
                    {pids.length === 0 && <span className="text-[10px] text-primary-text-muted">未配置 Product ID</span>}
                  </div>
                </div>

                <button
                  onClick={() => handleTogglePlatform(p)}
                  className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${p.is_active ? 'bg-primary-accent' : 'bg-primary-border'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${p.is_active ? 'translate-x-4' : ''}`} />
                </button>

                <button onClick={() => handleEditPlatform(p)}
                  className="text-xs text-primary-accent hover:underline shrink-0">编辑</button>

                {confirmDelete === p.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleDeletePlatform(p.id)}
                      className="px-2 py-1 text-[10px] bg-red-500 text-white rounded hover:bg-red-600">确认</button>
                    <button onClick={() => setConfirmDelete(null)}
                      className="px-2 py-1 text-[10px] bg-primary-sidebar text-primary-text-secondary rounded hover:bg-primary-border">取消</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(p.id)}
                    className="text-xs text-red-500 hover:underline shrink-0">删除</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ====== 5. 数据统计 ====== */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-primary-text">数据统计</h2>

        {stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="剧集总数" value={stats.totalDramas} color="text-primary-accent" />
              <StatCard label="快照记录" value={stats.totalSnapshots} color="text-indigo-600" />
              <StatCard label="待审核" value={stats.pendingReview} color="text-orange-500" />
              <StatCard label="投放趋势" value={stats.totalInvestTrend} color="text-teal-600" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatCard label="AI真人剧" value={stats.aiRealCount} color="text-blue-600" />
              <StatCard label="AI漫剧" value={stats.aiMangaCount} color="text-purple-600" />
              <StatCard label="真人剧" value={stats.realCount} color="text-green-600" />
            </div>
          </>
        )}

        <div className="pt-2 border-t border-primary-border">
          {confirmClear ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-500 font-medium">确认清空所有历史数据？此操作不可撤销。</span>
              <button onClick={handleClearData}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600">
                确认清空
              </button>
              <button onClick={() => setConfirmClear(false)}
                className="px-4 py-2 bg-primary-sidebar text-primary-text-secondary rounded-lg text-sm font-medium hover:bg-primary-border">
                取消
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmClear(true)}
              className="px-4 py-2 bg-red-50 text-red-500 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">
              清空历史数据
            </button>
          )}
          <p className="text-xs text-primary-text-muted mt-2">
            将清空所有榜单快照、投放趋势和播放量记录，剧集信息和平台配置将保留。
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-primary-card rounded-lg border border-primary-border p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-primary-text-muted mt-1">{label}</p>
    </div>
  );
}
