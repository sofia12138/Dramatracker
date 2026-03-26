'use client';

import { useState } from 'react';
import { useAIStream } from '@/hooks/useAIStream';
import AIMarkdown from '@/components/AIMarkdown';

function getWeekLabel(date: Date) {
  const y = date.getFullYear();
  const jan1 = new Date(y, 0, 1);
  const days = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return { year: y, week, dateStr: `${y}-${mm}-${dd}` };
}

export default function WeeklyReportPage() {
  const report = useAIStream();
  const [showDetail, setShowDetail] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const now = new Date();
  const { year, week } = getWeekLabel(now);

  const handleGenerate = () => {
    if (report.loading) { report.abort(); return; }
    report.reset();
    setShowDetail(false);
    setGeneratedAt(null);
    report.generate('weekly_report', undefined, true);
    setGeneratedAt(new Date().toLocaleString('zh-CN'));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(report.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([report.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `周报_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const status: 'idle' | 'loading' | 'done' | 'error' =
    report.error ? 'error' : report.loading ? 'loading' : report.content ? 'done' : 'idle';

  const STATUS_CONFIG = {
    idle:    { label: '未生成', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
    loading: { label: '生成中', color: 'bg-blue-50 text-blue-600', dot: 'bg-blue-500 animate-pulse' },
    done:    { label: '已生成', color: 'bg-green-50 text-green-600', dot: 'bg-green-500' },
    error:   { label: '生成失败', color: 'bg-red-50 text-red-600', dot: 'bg-red-500' },
  };
  const sc = STATUS_CONFIG[status];

  return (
    <div className="space-y-4">
      {/* === Header === */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary-text">市场周报</h1>
          <p className="text-sm text-primary-text-muted mt-0.5">
            基于本周与上周榜单变化，自动生成短剧市场分析摘要
          </p>
        </div>
        <button
          onClick={handleGenerate}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-accent to-indigo-500 rounded-lg hover:opacity-90 transition-all shadow-sm"
        >
          {report.loading ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              停止生成
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              立即生成
            </>
          )}
        </button>
      </div>

      {/* === Current Week Status Card === */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-primary-text">
              {year}年 第{week}周
            </h2>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${sc.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {sc.label}
            </span>
          </div>
          {status === 'done' && (
            <div className="flex items-center gap-1.5">
              <button onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-primary-text-secondary bg-primary-bg border border-primary-border rounded-md hover:bg-primary-sidebar transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copied ? '已复制' : '复制'}
              </button>
              <button onClick={handleExport}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-primary-accent rounded-md hover:opacity-90 transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                导出
              </button>
              <button onClick={handleGenerate}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-primary-text-secondary bg-primary-bg border border-primary-border rounded-md hover:bg-primary-sidebar transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                重新生成
              </button>
            </div>
          )}
        </div>

        {/* Idle */}
        {status === 'idle' && (
          <div className="flex items-center gap-4 p-4 bg-primary-bg rounded-lg border border-primary-border/50">
            <div className="w-10 h-10 rounded-lg bg-primary-accent-bg flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-primary-text">本周周报尚未生成</p>
              <p className="text-xs text-primary-text-muted mt-0.5">
                AI 将基于本周与上周榜单数据对比，生成市场趋势摘要、平台表现与选题建议
              </p>
            </div>
            <button onClick={handleGenerate}
              className="shrink-0 px-3 py-1.5 text-xs font-medium text-primary-accent border border-primary-accent-border bg-primary-accent-bg rounded-lg hover:bg-primary-accent hover:text-white transition-colors">
              立即生成
            </button>
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && !report.content && (
          <div className="flex items-center gap-4 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-accent border-t-transparent shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-primary-text">正在生成本周市场周报…</p>
              <p className="text-xs text-primary-text-muted mt-0.5">AI 正在分析榜单数据，通常需要 15-30 秒</p>
            </div>
            <button onClick={() => report.abort()}
              className="shrink-0 px-3 py-1.5 text-xs font-medium text-primary-text-secondary border border-primary-border rounded-lg hover:bg-primary-sidebar transition-colors">
              取消
            </button>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="flex items-center gap-4 p-4 bg-red-50/50 rounded-lg border border-red-100">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-700">生成失败</p>
              <p className="text-xs text-red-500 mt-0.5 truncate">{report.error}</p>
            </div>
            <button onClick={handleGenerate}
              className="shrink-0 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
              重试
            </button>
          </div>
        )}

        {/* Done — preview */}
        {status === 'done' && !showDetail && (
          <div className="space-y-2">
            <div className="p-4 bg-primary-bg rounded-lg border border-primary-border/50">
              <div className="text-sm text-primary-text line-clamp-4 leading-relaxed">
                <AIMarkdown content={report.content.slice(0, 500)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-primary-text-muted">
                {generatedAt && `生成于 ${generatedAt}`}
                {report.content && ` · 约${Math.ceil(report.content.length / 500)}分钟阅读`}
              </span>
              <button onClick={() => setShowDetail(true)}
                className="text-xs font-medium text-primary-accent hover:underline">
                展开查看全文 →
              </button>
            </div>
          </div>
        )}

        {/* Done — full content */}
        {status === 'done' && showDetail && (
          <div className="space-y-2">
            <div className="p-5 bg-primary-bg rounded-lg border border-primary-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
              <AIMarkdown content={report.content} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-primary-text-muted">
                {generatedAt && `生成于 ${generatedAt}`}
              </span>
              <button onClick={() => setShowDetail(false)}
                className="text-xs font-medium text-primary-accent hover:underline">
                ← 收起全文
              </button>
            </div>
          </div>
        )}

        {/* Streaming content */}
        {report.loading && report.content && (
          <div className="mt-3 p-5 bg-primary-bg rounded-lg border border-primary-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
            <AIMarkdown content={report.content} />
            <span className="inline-block w-2 h-4 bg-primary-accent animate-pulse ml-0.5" />
          </div>
        )}
      </div>

      {/* === History === */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-primary-text">历史周报</h2>
        </div>
        <div className="border border-primary-border/50 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-bg text-left">
                <th className="px-4 py-2.5 font-medium text-primary-text-secondary text-xs">周期</th>
                <th className="px-4 py-2.5 font-medium text-primary-text-secondary text-xs">生成时间</th>
                <th className="px-4 py-2.5 font-medium text-primary-text-secondary text-xs">状态</th>
                <th className="px-4 py-2.5 font-medium text-primary-text-secondary text-xs text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center">
                  <p className="text-xs text-primary-text-muted">暂无历史周报，生成后的周报将自动归档至此</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
