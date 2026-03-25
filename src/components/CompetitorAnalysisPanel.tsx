'use client';

import { useState } from 'react';

interface AnalysisItem {
  title: string;
  type: string;
  replicability: string;
  confidence: number;
  reason: string[];
  risk: string[];
  signals: string[];
}

interface Props {
  type: 'ai_real' | 'ai_manga' | 'real';
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  ai_real: 'AI真人剧',
  ai_manga: 'AI漫剧',
  real: '真人剧',
};

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  '爆发增长型': { bg: 'bg-red-50', text: 'text-red-700' },
  '投放驱动型': { bg: 'bg-blue-50', text: 'text-blue-700' },
  '内容驱动型': { bg: 'bg-green-50', text: 'text-green-700' },
  '稳定长尾型': { bg: 'bg-gray-100', text: 'text-gray-600' },
  '衰退下滑型': { bg: 'bg-orange-50', text: 'text-orange-700' },
};

const REPLIC_STYLES: Record<string, { bg: string; text: string }> = {
  '高可复制': { bg: 'bg-green-50', text: 'text-green-600' },
  '有条件可复制': { bg: 'bg-yellow-50', text: 'text-yellow-700' },
  '不可复制': { bg: 'bg-gray-100', text: 'text-gray-500' },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-gray-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-primary-text-muted tabular-nums">{pct}%</span>
    </div>
  );
}

export default function CompetitorAnalysisPanel({ type, onClose }: Props) {
  const [data, setData] = useState<AnalysisItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch(`/api/ai/competitor-analysis?type=${type}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '请求失败');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h2 className="text-base font-semibold text-primary-text">竞品增长模式分析</h2>
          <span className="text-xs text-primary-text-muted">基于{TYPE_LABELS[type] || type}榜单 Top20 数据</span>
        </div>
        <div className="flex items-center gap-2">
          {!data && !loading && (
            <button
              onClick={handleAnalyze}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-primary-accent to-indigo-500 text-white shadow-sm hover:opacity-90 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              开始分析
            </button>
          )}
          {data && !loading && (
            <button
              onClick={handleAnalyze}
              className="px-3 py-1.5 text-xs text-primary-text-muted hover:text-primary-accent border border-primary-border rounded-lg transition-colors"
            >
              重新分析
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-primary-sidebar text-primary-text-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 mb-4">
          {error}
          <button onClick={handleAnalyze} className="ml-2 underline">重试</button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
            <p className="text-sm text-primary-text-muted">正在分析 Top20 竞品增长模式...</p>
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-2">
          {data.map((item, i) => {
            const ts = TYPE_STYLES[item.type] || TYPE_STYLES['稳定长尾型'];
            const rs = REPLIC_STYLES[item.replicability] || REPLIC_STYLES['有条件可复制'];
            const expanded = expandedIdx === i;

            return (
              <div key={i}
                className="border border-primary-border rounded-lg overflow-hidden hover:border-primary-accent/30 transition-colors"
              >
                <button
                  onClick={() => setExpandedIdx(expanded ? null : i)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="text-xs text-primary-text-muted w-5 shrink-0 tabular-nums">{i + 1}</span>
                  <span className="text-sm font-medium text-primary-text truncate min-w-0 flex-1">{item.title}</span>
                  <span className={`px-2 py-0.5 text-[11px] font-medium rounded ${ts.bg} ${ts.text} shrink-0`}>
                    {item.type}
                  </span>
                  <span className={`px-2 py-0.5 text-[11px] rounded ${rs.bg} ${rs.text} shrink-0`}>
                    {item.replicability}
                  </span>
                  <ConfidenceBar value={item.confidence} />
                  <svg className={`w-4 h-4 text-primary-text-muted shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {expanded && (
                  <div className="px-4 pb-3 pt-0 border-t border-primary-border/50">
                    <div className="grid grid-cols-3 gap-4 mt-3">
                      <div>
                        <h4 className="text-[11px] font-semibold text-primary-accent mb-1.5">判断依据</h4>
                        <ul className="space-y-1">
                          {item.reason.map((r, j) => (
                            <li key={j} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                              <span className="text-primary-accent mt-0.5 shrink-0">•</span>{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-[11px] font-semibold text-orange-600 mb-1.5">风险信号</h4>
                        <ul className="space-y-1">
                          {item.risk.map((r, j) => (
                            <li key={j} className="text-xs text-primary-text leading-relaxed flex gap-1.5">
                              <span className="text-orange-500 mt-0.5 shrink-0">•</span>{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-[11px] font-semibold text-green-600 mb-1.5">关键特征</h4>
                        <div className="flex flex-wrap gap-1">
                          {item.signals.map((s, j) => (
                            <span key={j} className="px-1.5 py-0.5 text-[10px] bg-primary-accent-bg text-primary-accent rounded">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-8 text-primary-text-muted text-sm">
          点击"开始分析"，AI 将识别 Top20 竞品的增长模式
        </div>
      )}
    </div>
  );
}
