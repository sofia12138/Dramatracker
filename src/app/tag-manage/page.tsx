'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/fetch';

interface CandidateTag {
  tag_name: string;
  usage_count: number;
}

export default function TagManagePage() {
  const [candidates, setCandidates] = useState<CandidateTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [promoteTag, setPromoteTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [categoryList, setCategoryList] = useState<string[]>([]);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/tags/custom-candidates');
      const data = await res.json();
      if (data.success) setCandidates(data.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await apiFetch('/api/drama/genre');
      const data = await res.json();
      if (data.success && data.data) {
        setCategoryList(Object.keys(data.data));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCandidates();
    fetchCategories();
  }, [fetchCandidates, fetchCategories]);

  const highFreq = candidates.filter(c => c.usage_count >= 3);
  const lowFreq = candidates.filter(c => c.usage_count < 3);
  const displayed = showAll ? candidates : highFreq;

  const handlePromote = (tagName: string) => {
    setPromoteTag(tagName);
    setSelectedCategory('');
    setPromoteResult(null);
  };

  const confirmPromote = async () => {
    if (!promoteTag || !selectedCategory) return;
    setPromoting(true);
    setPromoteResult(null);
    try {
      const res = await apiFetch('/api/tags/add-to-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: promoteTag, category: selectedCategory }),
      });
      const data = await res.json();
      if (data.success) {
        setPromoteResult({ ok: true, msg: `标签"${promoteTag}"已成功加入分类"${selectedCategory}"，立即可用` });
        fetchCandidates();
        fetchCategories();
      } else {
        setPromoteResult({ ok: false, msg: data.error || '操作失败' });
      }
    } catch (e: unknown) {
      setPromoteResult({ ok: false, msg: e instanceof Error ? e.message : '网络错误' });
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary-text">标签管理</h1>
        <p className="text-sm text-primary-text-muted mt-1">
          查看自定义标签使用情况，将高频标签升级为系统标签
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-primary-card border border-primary-border rounded-xl p-4">
          <p className="text-2xl font-bold text-primary-text">{candidates.length}</p>
          <p className="text-xs text-primary-text-muted mt-1">自定义标签总数</p>
        </div>
        <div className="bg-primary-card border border-primary-border rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-600">{highFreq.length}</p>
          <p className="text-xs text-primary-text-muted mt-1">高频候选（≥3次）</p>
        </div>
        <div className="bg-primary-card border border-primary-border rounded-xl p-4">
          <p className="text-2xl font-bold text-primary-text-secondary">{lowFreq.length}</p>
          <p className="text-xs text-primary-text-muted mt-1">低频标签（&lt;3次）</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAll(false)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              !showAll
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-primary-text-secondary border-primary-border hover:border-amber-400'
            }`}
          >
            高频候选（{highFreq.length}）
          </button>
          <button
            onClick={() => setShowAll(true)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              showAll
                ? 'bg-primary-accent text-white border-primary-accent'
                : 'bg-white text-primary-text-secondary border-primary-border hover:border-primary-accent'
            }`}
          >
            全部（{candidates.length}）
          </button>
        </div>
        <button
          onClick={fetchCandidates}
          disabled={loading}
          className="px-3 py-1.5 text-xs text-primary-text-muted hover:text-primary-text border border-primary-border rounded-lg disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {/* Tag list */}
      {loading ? (
        <div className="text-center py-16 text-primary-text-muted text-sm">加载中...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 bg-primary-card border border-primary-border rounded-xl">
          <p className="text-primary-text-muted text-sm">
            {showAll ? '暂无自定义标签' : '暂无高频候选标签（使用≥3次）'}
          </p>
        </div>
      ) : (
        <div className="bg-primary-card border border-primary-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary-border bg-primary-sidebar/50">
                <th className="text-left px-4 py-3 font-medium text-primary-text-secondary">标签名称</th>
                <th className="text-center px-4 py-3 font-medium text-primary-text-secondary w-28">使用次数</th>
                <th className="text-center px-4 py-3 font-medium text-primary-text-secondary w-24">频率</th>
                <th className="text-right px-4 py-3 font-medium text-primary-text-secondary w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((item, idx) => (
                <tr key={item.tag_name} className={`border-b border-primary-border/50 ${idx % 2 === 1 ? 'bg-primary-sidebar/20' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 text-xs rounded-full border border-amber-200">
                      {item.tag_name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-medium text-primary-text">{item.usage_count}</td>
                  <td className="px-4 py-3 text-center">
                    {item.usage_count >= 3 ? (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full font-medium">高频</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] rounded-full">低频</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handlePromote(item.tag_name)}
                      className="px-2.5 py-1 text-xs font-medium text-primary-accent border border-primary-accent-border rounded-lg hover:bg-primary-accent-bg transition-colors"
                    >
                      加入系统标签
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Promote dialog */}
      {promoteTag && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[420px] max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-primary-border">
              <h3 className="text-base font-semibold text-primary-text">将自定义标签升级为系统标签</h3>
              <p className="text-xs text-primary-text-muted mt-1">
                选择分类后点击确认，标签将立即可用，无需重新构建
              </p>
            </div>
            <div className="px-5 py-4 flex-1 overflow-y-auto">
              <div className="mb-4">
                <span className="text-sm text-primary-text-secondary">标签：</span>
                <span className="ml-2 px-2.5 py-1 bg-amber-50 text-amber-700 text-sm rounded-full border border-amber-200 font-medium">
                  {promoteTag}
                </span>
              </div>
              {promoteResult && (
                <div className={`mb-3 px-3 py-2 rounded-lg text-xs ${
                  promoteResult.ok
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                  {promoteResult.msg}
                </div>
              )}
              {!promoteResult?.ok && (
                <>
                  <p className="text-xs text-primary-text-secondary mb-2">选择目标分类：</p>
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    {categoryList.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                          selectedCategory === cat
                            ? 'bg-primary-accent-bg text-primary-accent border-primary-accent-border font-medium'
                            : 'bg-white text-primary-text-secondary border-primary-border hover:border-primary-accent'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-primary-border flex justify-end gap-2">
              <button
                onClick={() => setPromoteTag(null)}
                className="px-4 py-2 text-xs text-primary-text-muted hover:text-primary-text border border-primary-border rounded-lg"
              >
                {promoteResult?.ok ? '关闭' : '取消'}
              </button>
              {!promoteResult?.ok && (
                <button
                  onClick={confirmPromote}
                  disabled={!selectedCategory || promoting}
                  className="px-4 py-2 text-xs font-medium bg-primary-accent text-white rounded-lg hover:opacity-90 disabled:opacity-40"
                >
                  {promoting ? '升级中...' : '确认升级'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
