'use client';

import { useEffect, useRef } from 'react';
import { useAIStream } from '@/hooks/useAIStream';
import AIMarkdown from './AIMarkdown';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AIInsightDrawer({ open, onClose }: Props) {
  const { content, loading, error, generate, abort, reset } = useAIStream();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !content && !loading) {
      generate('insight');
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
    generate('insight', undefined, true);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />
      <div className="fixed right-0 top-0 h-full w-[600px] bg-white z-50 shadow-2xl flex flex-col">
        <div className="sticky top-0 bg-white border-b border-primary-border px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h2 className="text-lg font-bold text-primary-text">AI 洞察报告</h2>
          </div>
          <div className="flex items-center gap-2">
            {content && !loading && (
              <>
                <button onClick={handleCopy}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-primary-text-muted" title="复制">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <button onClick={handleRegenerate}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-primary-text-muted" title="重新生成">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
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
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
                <p className="text-sm text-primary-text-muted">正在分析数据，生成洞察报告...</p>
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
    </>
  );
}
