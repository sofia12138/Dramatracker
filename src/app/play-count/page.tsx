'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface DramaRow {
  drama_id: number;
  playlet_id: string;
  title: string;
  cover_url: string;
  is_ai_drama: string;
  platform: string;
  heat_value: number;
  pc_id: number | null;
  app_play_count: number | null;
  input_by: string | null;
  pc_created_at: string | null;
}

interface Toast { id: number; message: string; type: string }

const PLATFORMS = ['ShortMax', 'MoboShort', 'MoreShort', 'MyMuse', 'LoveShots', 'ReelAI', 'HiShort', 'NetShort', 'Storeel', 'iDrama', 'StardustTV'];

function getWeekInfo(offset = 0): { week: string; label: string; start: string; end: string } {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7);
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const year = monday.getFullYear();
  const janFirst = new Date(year, 0, 1);
  const days = Math.floor((monday.getTime() - janFirst.getTime()) / 86400000);
  const weekNum = Math.ceil((days + janFirst.getDay() + 1) / 7);

  const fmt = (d: Date) => `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
  return {
    week: `${year}-${String(weekNum).padStart(2, '0')}`,
    label: `${year}年第${weekNum}周 ${fmt(monday)}-${fmt(sunday)}`,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function formatHeat(val: number): string {
  if (!val) return '0';
  if (val >= 100000000) return (val / 100000000).toFixed(1) + '亿';
  if (val >= 10000) return (val / 10000).toFixed(1) + '万';
  return val.toLocaleString();
}

export default function PlayCountPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DramaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saving, setSaving] = useState(false);
  const toastId = useRef(0);

  const weekInfo = getWeekInfo(weekOffset);

  const showToast = useCallback((message: string, type = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ record_week: weekInfo.week });
    if (selectedPlatform) params.set('platform', selectedPlatform);
    fetch(`/api/play-count?${params}`)
      .then(r => r.json())
      .then(result => {
        setRows(result.data || []);
        const vals: Record<string, string> = {};
        for (const r of (result.data || []) as DramaRow[]) {
          const key = `${r.playlet_id}:${r.platform}`;
          vals[key] = r.app_play_count != null ? String(r.app_play_count) : '';
        }
        setEditValues(vals);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [weekInfo.week, selectedPlatform]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveSingle = async (row: DramaRow) => {
    const key = `${row.playlet_id}:${row.platform}`;
    const val = editValues[key];
    if (val === '' || val == null) return;

    setSaving(true);
    try {
      const res = await fetch('/api/play-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlet_id: row.playlet_id,
          platform: row.platform,
          app_play_count: parseInt(val) || 0,
          record_week: weekInfo.week,
        }),
      });
      if (res.ok) {
        showToast(`"${row.title}" 播放量已保存`);
        setEditingId(null);
        fetchData();
      } else {
        showToast('保存失败', 'error');
      }
    } catch {
      showToast('保存失败', 'error');
    }
    setSaving(false);
  };

  const handleBatchSave = async () => {
    const items = rows
      .filter(r => {
        const key = `${r.playlet_id}:${r.platform}`;
        const val = editValues[key];
        return val !== '' && val != null;
      })
      .map(r => ({
        playlet_id: r.playlet_id,
        platform: r.platform,
        app_play_count: parseInt(editValues[`${r.playlet_id}:${r.platform}`]) || 0,
        record_week: weekInfo.week,
      }));

    if (items.length === 0) { showToast('没有需要保存的数据', 'warn'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/play-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });
      const result = await res.json();
      if (res.ok) {
        showToast(`批量保存成功，已保存 ${result.saved} 条`);
        setBatchMode(false);
        fetchData();
      } else {
        showToast('批量保存失败', 'error');
      }
    } catch {
      showToast('批量保存失败', 'error');
    }
    setSaving(false);
  };

  const handleExport = () => {
    const params = new URLSearchParams({ record_week: weekInfo.week });
    if (selectedPlatform) params.set('platform', selectedPlatform);
    window.open(`/api/play-count/export?${params}`, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-red-500 text-white' :
            toast.type === 'warn' ? 'bg-amber-500 text-white' :
            'bg-primary-accent text-white'
          }`}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={toast.type === 'error' ? 'M6 18L18 6M6 6l12 12' : 'M5 13l4 4L19 7'} />
            </svg>
            {toast.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-primary-text">播放量管理</h1>
        <div className="flex items-center gap-2">
          <button onClick={handleExport}
            className="px-3 py-1.5 text-sm font-medium border border-primary-border rounded-lg bg-primary-card hover:bg-primary-sidebar transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            导出Excel
          </button>
          <button
            onClick={() => { setBatchMode(!batchMode); setEditingId(null); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              batchMode
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-primary-accent text-white hover:opacity-90'
            }`}>
            {batchMode ? '退出批量' : '批量录入'}
          </button>
        </div>
      </div>

      {/* Week Selector */}
      <div className="card !py-3 !px-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(o => o - 1)}
            className="p-1.5 rounded-lg border border-primary-border hover:bg-primary-card transition-colors">
            <svg className="w-4 h-4 text-primary-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-primary-text min-w-[240px] text-center">{weekInfo.label}</span>
          <button onClick={() => setWeekOffset(o => o + 1)} disabled={weekOffset >= 0}
            className="p-1.5 rounded-lg border border-primary-border hover:bg-primary-card transition-colors disabled:opacity-30">
            <svg className="w-4 h-4 text-primary-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button onClick={() => setWeekOffset(0)}
            className="ml-2 px-2 py-1 text-xs text-primary-accent border border-primary-accent-border rounded bg-primary-accent-bg hover:bg-primary-accent hover:text-white transition-colors">
            本周
          </button>
        </div>

        {batchMode && (
          <button onClick={handleBatchSave} disabled={saving}
            className="px-4 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1.5">
            {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            统一保存
          </button>
        )}
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedPlatform('')}
          className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all border ${
            !selectedPlatform
              ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border shadow-sm'
              : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
          }`}>
          全部
        </button>
        {PLATFORMS.map(p => (
          <button key={p}
            onClick={() => setSelectedPlatform(p)}
            className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all border ${
              selectedPlatform === p
                ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border shadow-sm'
                : 'bg-primary-card text-primary-text-secondary border-transparent hover:bg-primary-sidebar'
            }`}>
            {p}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card !p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-primary-text-muted">暂无已审核剧集数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary-sidebar/50">
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary w-10">封面</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">剧名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">平台</th>
                  <th className="text-right py-3 px-4 font-medium text-primary-text-secondary">累计热力值</th>
                  <th className="text-right py-3 px-4 font-medium text-primary-text-secondary min-w-[160px]">APP内外显播放量</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">录入人</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">录入时间</th>
                  <th className="text-center py-3 px-4 font-medium text-primary-text-secondary w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = `${row.playlet_id}:${row.platform}`;
                  const isEditing = batchMode || editingId === key;
                  const hasData = row.pc_id != null;

                  return (
                    <tr key={key} className="border-b border-primary-border/40 hover:bg-primary-accent-bg/20 transition-colors">
                      <td className="py-2.5 px-4">
                        {row.cover_url ? (
                          <img src={row.cover_url} alt="" className="w-9 h-12 object-cover rounded border border-primary-border" />
                        ) : (
                          <div className="w-9 h-12 rounded bg-primary-sidebar border border-primary-border flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                            </svg>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="text-primary-text font-medium truncate block max-w-[200px]" title={row.title}>{row.title}</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 text-xs rounded bg-primary-sidebar text-primary-text-secondary border border-primary-border">
                          {row.platform}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="text-primary-text font-medium">{formatHeat(row.heat_value)}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={editValues[key] ?? ''}
                            onChange={e => setEditValues(v => ({ ...v, [key]: e.target.value }))}
                            placeholder="输入播放量"
                            className="w-full px-2.5 py-1.5 border border-primary-accent rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-accent/20 bg-white"
                            autoFocus={!batchMode}
                          />
                        ) : (
                          <span
                            className={`cursor-pointer px-2 py-1 rounded transition-colors ${
                              hasData ? 'text-primary-text font-medium hover:bg-primary-accent-bg' : 'text-primary-text-muted hover:bg-primary-accent-bg'
                            }`}
                            onClick={() => { setEditingId(key); }}
                          >
                            {hasData ? parseInt(editValues[key] || '0').toLocaleString() : '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-primary-text-secondary text-xs">{row.input_by || (hasData ? user?.name : '—')}</td>
                      <td className="py-2.5 px-4 text-primary-text-muted text-xs">{row.pc_created_at || '—'}</td>
                      <td className="py-2.5 px-4 text-center">
                        {isEditing && !batchMode ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleSaveSingle(row)} disabled={saving}
                              className="px-2 py-1 text-xs bg-primary-accent text-white rounded hover:opacity-90 disabled:opacity-50">
                              保存
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-2 py-1 text-xs text-primary-text-muted border border-primary-border rounded hover:bg-primary-card">
                              取消
                            </button>
                          </div>
                        ) : !batchMode ? (
                          <button onClick={() => setEditingId(key)}
                            className="text-xs text-primary-accent hover:underline">
                            编辑
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
