'use client';

import { useEffect, useState, useCallback } from 'react';

interface PlayCountRecord {
  id: number;
  playlet_id: string;
  platform: string;
  app_play_count: number;
  record_week: string;
  record_date: string;
  input_by: string;
  note: string;
  title: string;
  created_at: string;
}

interface Platform {
  id: number;
  name: string;
}

export default function PlayCountPage() {
  const [records, setRecords] = useState<PlayCountRecord[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    playlet_id: '',
    platform: '',
    app_play_count: 0,
    record_week: '',
    record_date: new Date().toISOString().split('T')[0],
    input_by: 'admin',
    note: '',
  });

  useEffect(() => {
    fetch('/api/platforms').then(r => r.json()).then(setPlatforms);
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    fetch(`/api/play-count?${params}`)
      .then(r => r.json())
      .then(result => {
        setRecords(result.data || []);
        setTotal(result.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const now = new Date(form.record_date);
      const weekNum = getWeekNumber(now);
      const recordWeek = `${now.getFullYear()}-${String(weekNum).padStart(2, '0')}`;

      await fetch('/api/play-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, record_week: recordWeek }),
      });
      setShowForm(false);
      setForm({
        playlet_id: '',
        platform: '',
        app_play_count: 0,
        record_week: '',
        record_date: new Date().toISOString().split('T')[0],
        input_by: 'admin',
        note: '',
      });
      fetchData();
    } catch (error) {
      console.error('Submit failed:', error);
    }
  };

  const getWeekNumber = (d: Date): number => {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-text">播放量管理</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showForm ? '取消' : '+ 新增记录'}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h2 className="text-lg font-semibold text-primary-text mb-4">新增播放量记录</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">Playlet ID *</label>
              <input
                type="text"
                required
                value={form.playlet_id}
                onChange={e => setForm({ ...form, playlet_id: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">平台 *</label>
              <select
                required
                value={form.platform}
                onChange={e => setForm({ ...form, platform: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent"
              >
                <option value="">选择平台</option>
                {platforms.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">APP播放量 *</label>
              <input
                type="number"
                required
                min={0}
                value={form.app_play_count}
                onChange={e => setForm({ ...form, app_play_count: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">记录日期 *</label>
              <input
                type="date"
                required
                value={form.record_date}
                onChange={e => setForm({ ...form, record_date: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">录入人</label>
              <input
                type="text"
                value={form.input_by}
                onChange={e => setForm({ ...form, input_by: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">备注</label>
              <input
                type="text"
                value={form.note}
                onChange={e => setForm({ ...form, note: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent"
              />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <button
                type="submit"
                className="px-6 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent"></div>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-primary-text-muted">暂无播放量记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary-border">
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">剧名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">Playlet ID</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">平台</th>
                  <th className="text-right py-3 px-4 font-medium text-primary-text-secondary">APP播放量</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">记录周</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">记录日期</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">录入人</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">备注</th>
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr key={record.id} className="border-b border-primary-border/50 hover:bg-primary-accent-bg/30 transition-colors">
                    <td className="py-3 px-4 text-primary-text">{record.title || '-'}</td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{record.playlet_id}</td>
                    <td className="py-3 px-4 text-primary-text-secondary">{record.platform}</td>
                    <td className="py-3 px-4 text-right font-medium text-primary-text">{record.app_play_count?.toLocaleString()}</td>
                    <td className="py-3 px-4 text-primary-text-secondary">{record.record_week}</td>
                    <td className="py-3 px-4 text-primary-text-secondary">{record.record_date}</td>
                    <td className="py-3 px-4 text-primary-text-secondary">{record.input_by || '-'}</td>
                    <td className="py-3 px-4 text-primary-text-muted">{record.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 20 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-primary-border">
            <span className="text-sm text-primary-text-muted">第 {page} 页，共 {Math.ceil(total / 20)} 页</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-card">上一页</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}
                className="px-3 py-1 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-card">下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
