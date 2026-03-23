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
}

const DRAMA_TYPES = [
  { value: 'ai_real', label: 'AI真人剧', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'ai_manga', label: 'AI漫剧', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { value: 'real', label: '真人剧', color: 'bg-green-100 text-green-700 border-green-200' },
];

export default function ReviewPage() {
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [classifying, setClassifying] = useState<number | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      is_ai_drama: 'null',
      page: String(page),
      pageSize: '20',
    });
    if (search) params.set('search', search);

    fetch(`/api/drama?${params}`)
      .then(r => r.json())
      .then(result => {
        setDramas(result.data || []);
        setTotal(result.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleClassify = async (dramaId: number, type: string) => {
    setClassifying(dramaId);
    try {
      await fetch(`/api/drama/${dramaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_ai_drama: type }),
      });
      fetchData();
    } catch (error) {
      console.error('Classification failed:', error);
    } finally {
      setClassifying(null);
    }
  };

  const parseTags = (tags: string) => {
    try { return JSON.parse(tags || '[]'); } catch { return []; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-text">人工审核队列</h1>
          <p className="text-sm text-primary-text-muted mt-1">共 {total} 条待审核剧集</p>
        </div>
      </div>

      <div className="card">
        <div className="mb-6">
          <input
            type="text"
            placeholder="搜索剧名或 Playlet ID..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full max-w-md px-4 py-2 border border-primary-border rounded-lg bg-white text-sm text-primary-text focus:outline-none focus:border-primary-accent"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent"></div>
          </div>
        ) : dramas.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 mx-auto text-primary-text-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-primary-text-muted text-lg">所有剧集已审核完毕</p>
          </div>
        ) : (
          <div className="space-y-4">
            {dramas.map((drama) => (
              <div
                key={drama.id}
                className="flex gap-4 p-4 bg-white rounded-lg border border-primary-border hover:shadow-card transition-shadow"
              >
                {drama.cover_url && (
                  <img src={drama.cover_url} alt="" className="w-20 h-28 object-cover rounded-lg shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-primary-text">{drama.title}</h3>
                      <p className="text-xs text-primary-text-muted mt-0.5">ID: {drama.playlet_id}</p>
                    </div>
                    <span className="px-2 py-1 bg-orange-100 text-orange-600 text-xs rounded-full border border-orange-200 shrink-0">
                      待审核
                    </span>
                  </div>
                  {drama.description && (
                    <p className="text-sm text-primary-text-secondary mt-2 line-clamp-2">{drama.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {drama.language && (
                      <span className="text-xs text-primary-text-muted">语种: {drama.language}</span>
                    )}
                    {drama.first_air_date && (
                      <span className="text-xs text-primary-text-muted">上线: {drama.first_air_date}</span>
                    )}
                    {parseTags(drama.tags).map((tag: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-primary-accent-bg text-primary-accent text-xs rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-sm text-primary-text-secondary mr-2">分类为:</span>
                    {DRAMA_TYPES.map((dt) => (
                      <button
                        key={dt.value}
                        onClick={() => handleClassify(drama.id, dt.value)}
                        disabled={classifying === drama.id}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-all hover:shadow-sm disabled:opacity-50 ${dt.color}`}
                      >
                        {dt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {total > 20 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-primary-border">
            <span className="text-sm text-primary-text-muted">第 {page} 页，共 {Math.ceil(total / 20)} 页</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-card"
              >上一页</button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * 20 >= total}
                className="px-3 py-1 text-sm border border-primary-border rounded-lg disabled:opacity-50 hover:bg-primary-card"
              >下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
