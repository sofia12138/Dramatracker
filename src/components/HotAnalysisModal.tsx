'use client';

import { useEffect, useRef } from 'react';
import { useAIStream } from '@/hooks/useAIStream';
import AIMarkdown from './AIMarkdown';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HotAnalysisModal({ open, onClose }: Props) {
  const { content, loading, error, generate, abort, reset } = useAIStream();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !content && !loading) {
      generate('hot_analysis');
    }
  }, [open, content, loading, generate]);

  useEffect(() => {
    if (loading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [content, loading]);

  const handleClose = () => {
    abort();
    onClose();
  };

  const handleRegenerate = () => {
    reset();
    generate('hot_analysis', undefined, true);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
  };

  const handleExport = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `爆款分析_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[800px] max-h-[85vh] flex flex-col z-10">
        <div className="px-6 py-4 border-b border-primary-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            </svg>
            <h2 className="text-lg font-bold text-primary-text">爆款规律分析 & 选题建议</h2>
          </div>
          <div className="flex items-center gap-2">
            {content && !loading && (
              <>
                <button onClick={handleCopy}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-text-secondary bg-primary-card border border-primary-border rounded-lg hover:bg-primary-sidebar transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  复制
                </button>
                <button onClick={handleExport}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-accent rounded-lg hover:opacity-90 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  导出
                </button>
                <button onClick={handleRegenerate}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-text-secondary bg-primary-card border border-primary-border rounded-lg hover:bg-primary-sidebar transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重新生成
                </button>
              </>
            )}
            <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <svg className="w-5 h-5 text-primary-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
              <button onClick={handleRegenerate} className="ml-2 underline">重试</button>
            </div>
          )}

          {loading && !content && (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
                <p className="text-sm text-primary-text-muted">正在分析Top20剧集数据，挖掘爆款规律...</p>
              </div>
            </div>
          )}

          {content && <AIMarkdown content={content} />}

          {loading && content && (
            <span className="inline-block w-2 h-4 bg-primary-accent animate-pulse ml-0.5" />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
