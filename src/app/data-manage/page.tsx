'use client';

import { useEffect, useState, useCallback } from 'react';

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
  created_at: string;
  updated_at: string;
}

const DRAMA_TYPE_MAP: Record<string, string> = {
  ai_real: 'AI真人剧',
  ai_manga: 'AI漫剧',
  real: '真人剧',
};

export default function DataManagePage() {
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingDrama, setEditingDrama] = useState<Drama | null>(null);
  const [form, setForm] = useState({
    playlet_id: '',
    title: '',
    description: '',
    language: '',
    cover_url: '',
    first_air_date: '',
    is_ai_drama: '',
    tags: '',
    creative_count: 0,
  });

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search) params.set('search', search);
    if (typeFilter) params.set('is_ai_drama', typeFilter);

    fetch(`/api/drama?${params}`)
      .then(r => r.json())
      .then(result => {
        setDramas(result.data || []);
        setTotal(result.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, search, typeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let tags: string[] = [];
      try {
        tags = JSON.parse(form.tags);
      } catch {
        tags = form.tags.split(',').map(s => s.trim()).filter(Boolean);
      }

      const body = { ...form, tags, is_ai_drama: form.is_ai_drama || null };

      if (editingDrama) {
        await fetch(`/api/drama/${editingDrama.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/drama', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setShowForm(false);
      setEditingDrama(null);
      setForm({ playlet_id: '', title: '', description: '', language: '', cover_url: '', first_air_date: '', is_ai_drama: '', tags: '', creative_count: 0 });
      fetchData();
    } catch (error) {
      console.error('Submit failed:', error);
    }
  };

  const handleEdit = (drama: Drama) => {
    setEditingDrama(drama);
    setForm({
      playlet_id: drama.playlet_id,
      title: drama.title,
      description: drama.description || '',
      language: drama.language || '',
      cover_url: drama.cover_url || '',
      first_air_date: drama.first_air_date || '',
      is_ai_drama: drama.is_ai_drama || '',
      tags: drama.tags || '[]',
      creative_count: drama.creative_count || 0,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此剧集吗？')) return;
    await fetch(`/api/drama/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const parseTags = (tags: string) => {
    try { return JSON.parse(tags || '[]'); } catch { return []; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-text">数据管理</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditingDrama(null); setForm({ playlet_id: '', title: '', description: '', language: '', cover_url: '', first_air_date: '', is_ai_drama: '', tags: '', creative_count: 0 }); }}
          className="px-4 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showForm ? '取消' : '+ 新增剧集'}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h2 className="text-lg font-semibold text-primary-text mb-4">{editingDrama ? '编辑剧集' : '新增剧集'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">Playlet ID *</label>
              <input type="text" required value={form.playlet_id} disabled={!!editingDrama}
                onChange={e => setForm({ ...form, playlet_id: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent disabled:bg-gray-100" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">剧名 *</label>
              <input type="text" required value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">语种</label>
              <input type="text" value={form.language}
                onChange={e => setForm({ ...form, language: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">剧集类型</label>
              <select value={form.is_ai_drama}
                onChange={e => setForm({ ...form, is_ai_drama: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent">
                <option value="">待审核</option>
                <option value="ai_real">AI真人剧</option>
                <option value="ai_manga">AI漫剧</option>
                <option value="real">真人剧</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">上线时间</label>
              <input type="date" value={form.first_air_date}
                onChange={e => setForm({ ...form, first_air_date: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">投放计划数</label>
              <input type="number" min={0} value={form.creative_count}
                onChange={e => setForm({ ...form, creative_count: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">封面图URL</label>
              <input type="text" value={form.cover_url}
                onChange={e => setForm({ ...form, cover_url: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">标签 (逗号分隔)</label>
              <input type="text" value={form.tags}
                onChange={e => setForm({ ...form, tags: e.target.value })}
                placeholder="例: 甜宠,霸总"
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div className="lg:col-span-3">
              <label className="block text-sm text-primary-text-secondary mb-1">简介</label>
              <textarea value={form.description} rows={2}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent resize-none" />
            </div>
            <div className="lg:col-span-3">
              <button type="submit"
                className="px-6 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                {editingDrama ? '更新' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-4 mb-6">
          <input type="text" placeholder="搜索剧名或 Playlet ID..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="px-4 py-2 border border-primary-border rounded-lg bg-white text-sm text-primary-text focus:outline-none focus:border-primary-accent w-64" />
          <select value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-primary-border rounded-lg bg-white text-sm text-primary-text focus:outline-none focus:border-primary-accent">
            <option value="">全部类型</option>
            <option value="ai_real">AI真人剧</option>
            <option value="ai_manga">AI漫剧</option>
            <option value="real">真人剧</option>
            <option value="null">待审核</option>
          </select>
          <span className="text-sm text-primary-text-muted self-center">共 {total} 条</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent"></div>
          </div>
        ) : dramas.length === 0 ? (
          <div className="text-center py-12 text-primary-text-muted">暂无剧集数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary-border">
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">剧名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">Playlet ID</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">类型</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">语种</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">标签</th>
                  <th className="text-right py-3 px-4 font-medium text-primary-text-secondary">投放计划数</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">上线时间</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">操作</th>
                </tr>
              </thead>
              <tbody>
                {dramas.map(drama => (
                  <tr key={drama.id} className="border-b border-primary-border/50 hover:bg-primary-accent-bg/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {drama.cover_url && <img src={drama.cover_url} alt="" className="w-8 h-11 object-cover rounded" />}
                        <span className="text-primary-text font-medium">{drama.title}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{drama.playlet_id}</td>
                    <td className="py-3 px-4">
                      {drama.is_ai_drama ? (
                        <span className="px-2 py-0.5 bg-primary-accent-bg text-primary-accent text-xs rounded-full">
                          {DRAMA_TYPE_MAP[drama.is_ai_drama] || drama.is_ai_drama}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded-full">待审核</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-primary-text-secondary">{drama.language || '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {parseTags(drama.tags).slice(0, 2).map((tag: string, i: number) => (
                          <span key={i} className="px-1.5 py-0.5 bg-primary-accent-bg text-primary-accent text-xs rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-primary-text-secondary">{drama.creative_count}</td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{drama.first_air_date || '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(drama)} className="text-primary-accent hover:underline text-xs">编辑</button>
                        <button onClick={() => handleDelete(drama.id)} className="text-red-500 hover:underline text-xs">删除</button>
                      </div>
                    </td>
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
