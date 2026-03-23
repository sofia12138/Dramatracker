'use client';

import { useEffect, useState } from 'react';

interface DashboardStats {
  totalDramas: number;
  totalPlatforms: number;
  pendingReview: number;
  aiRealCount: number;
  aiMangaCount: number;
  realCount: number;
  todaySnapshots: number;
  latestSnapshotDate: string | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(res => res.json())
      .then(data => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent"></div>
      </div>
    );
  }

  const statCards = [
    { label: '剧集总数', value: stats?.totalDramas || 0, color: 'text-primary-accent' },
    { label: 'AI真人剧', value: stats?.aiRealCount || 0, color: 'text-blue-600' },
    { label: 'AI漫剧', value: stats?.aiMangaCount || 0, color: 'text-purple-600' },
    { label: '真人剧', value: stats?.realCount || 0, color: 'text-green-600' },
    { label: '待审核', value: stats?.pendingReview || 0, color: 'text-orange-500' },
    { label: '活跃平台', value: stats?.totalPlatforms || 0, color: 'text-teal-600' },
    { label: '今日榜单数', value: stats?.todaySnapshots || 0, color: 'text-indigo-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-text">数据看板</h1>
          <p className="text-sm text-primary-text-muted mt-1">
            {stats?.latestSnapshotDate ? `最新数据日期: ${stats.latestSnapshotDate}` : '暂无榜单数据'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="card flex flex-col items-center justify-center py-5">
            <span className={`text-3xl font-bold ${card.color}`}>{card.value}</span>
            <span className="text-sm text-primary-text-secondary mt-2">{card.label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-primary-text mb-4">剧集类型分布</h2>
          <div className="h-64 flex items-center justify-center text-primary-text-muted">
            <div className="text-center">
              <div className="flex items-center justify-center gap-8">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2">
                    <span className="text-xl font-bold text-blue-600">{stats?.aiRealCount || 0}</span>
                  </div>
                  <span className="text-sm">AI真人剧</span>
                </div>
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-2">
                    <span className="text-xl font-bold text-purple-600">{stats?.aiMangaCount || 0}</span>
                  </div>
                  <span className="text-sm">AI漫剧</span>
                </div>
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                    <span className="text-xl font-bold text-green-600">{stats?.realCount || 0}</span>
                  </div>
                  <span className="text-sm">真人剧</span>
                </div>
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-2">
                    <span className="text-xl font-bold text-orange-500">{stats?.pendingReview || 0}</span>
                  </div>
                  <span className="text-sm">待审核</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-primary-text mb-4">平台概览</h2>
          <div className="h-64 flex items-center justify-center text-primary-text-muted">
            导入数据后将展示各平台榜单统计图表
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-primary-text mb-4">最近更新</h2>
        <div className="text-primary-text-muted text-center py-8">
          暂无数据，请通过数据管理页面导入榜单数据
        </div>
      </div>
    </div>
  );
}
