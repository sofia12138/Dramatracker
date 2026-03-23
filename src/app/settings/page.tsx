'use client';

import { useEffect, useState, useCallback } from 'react';

interface Platform {
  id: number;
  name: string;
  product_ids: string;
  is_active: number;
  created_at: string;
}

export default function SettingsPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [form, setForm] = useState({ name: '', product_ids: '', is_active: 1 });

  const fetchPlatforms = useCallback(() => {
    setLoading(true);
    fetch('/api/platforms')
      .then(r => r.json())
      .then(data => { setPlatforms(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let productIds: number[] = [];
      try {
        productIds = JSON.parse(form.product_ids);
      } catch {
        productIds = form.product_ids.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      }

      const body = { name: form.name, product_ids: productIds, is_active: form.is_active };

      if (editingPlatform) {
        await fetch(`/api/platforms/${editingPlatform.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/platforms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setShowForm(false);
      setEditingPlatform(null);
      setForm({ name: '', product_ids: '', is_active: 1 });
      fetchPlatforms();
    } catch (error) {
      console.error('Submit failed:', error);
    }
  };

  const handleEdit = (platform: Platform) => {
    setEditingPlatform(platform);
    setForm({
      name: platform.name,
      product_ids: platform.product_ids,
      is_active: platform.is_active,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此平台吗？')) return;
    await fetch(`/api/platforms/${id}`, { method: 'DELETE' });
    fetchPlatforms();
  };

  const parseProductIds = (ids: string) => {
    try { return JSON.parse(ids); } catch { return []; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-text">设置</h1>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-primary-text">平台管理</h2>
          <button
            onClick={() => { setShowForm(!showForm); setEditingPlatform(null); setForm({ name: '', product_ids: '', is_active: 1 }); }}
            className="px-4 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {showForm ? '取消' : '+ 新增平台'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-primary-bg rounded-lg border border-primary-border">
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">平台名称 *</label>
              <input type="text" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">Product IDs (逗号分隔)</label>
              <input type="text" value={form.product_ids}
                onChange={e => setForm({ ...form, product_ids: e.target.value })}
                placeholder="例: 365084, 365123"
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active === 1}
                  onChange={e => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })}
                  className="w-4 h-4 text-primary-accent rounded" />
                <span className="text-sm text-primary-text-secondary">启用</span>
              </label>
              <button type="submit"
                className="px-6 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                {editingPlatform ? '更新' : '创建'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary-border">
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">ID</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">平台名称</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">Product IDs</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">状态</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">创建时间</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">操作</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map(platform => (
                  <tr key={platform.id} className="border-b border-primary-border/50 hover:bg-primary-accent-bg/30 transition-colors">
                    <td className="py-3 px-4 text-primary-text-muted">{platform.id}</td>
                    <td className="py-3 px-4 text-primary-text font-medium">{platform.name}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {parseProductIds(platform.product_ids).map((pid: number) => (
                          <span key={pid} className="px-2 py-0.5 bg-primary-accent-bg text-primary-accent text-xs rounded border border-primary-accent-border">
                            {pid}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-xs ${platform.is_active ? 'text-green-600' : 'text-red-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${platform.is_active ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        {platform.is_active ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{platform.created_at}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(platform)} className="text-primary-accent hover:underline text-xs">编辑</button>
                        <button onClick={() => handleDelete(platform.id)} className="text-red-500 hover:underline text-xs">删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
