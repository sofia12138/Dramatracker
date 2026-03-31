'use client';

import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { parseManualTags, isEmptyTags } from '@/lib/tag-utils';
import { apiFetch } from '@/lib/fetch';

const MAX_SYSTEM_TAGS = 10;
const MAX_CUSTOM_TAGS = 5;
const MAX_CUSTOM_TAG_LEN = 10;

interface Props {
  dramaId: number;
  genreTagsManual: string | null | undefined;
  genreTagsAi?: string | null;
  scrapedTags?: string | null;
  onSaved: (newTagsJson: string | null) => void;
  onCancel: () => void;
}

export default function TagSelector({ dramaId, genreTagsManual, genreTagsAi, scrapedTags, onSaved, onCancel }: Props) {
  const [tagPool, setTagPool] = useState<Record<string, string[]> | null>(null);
  const [tagPoolLoading, setTagPoolLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/drama/genre').then(r => r.json()).then(res => {
      if (!cancelled && res.success) setTagPool(res.data);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setTagPoolLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const tagCategoryList = useMemo(() => tagPool ? Object.keys(tagPool) : [], [tagPool]);
  const allPoolTags = useMemo(() => tagPool ? Object.values(tagPool).flat() : [], [tagPool]);

  const initial = useMemo(() => {
    const manual = parseManualTags(genreTagsManual);
    if (!isEmptyTags(manual)) return manual;
    const ai = parseManualTags(genreTagsAi);
    if (!isEmptyTags(ai)) return ai;
    return parseManualTags(scrapedTags);
  }, [genreTagsManual, genreTagsAi, scrapedTags]);
  const [systemTags, setSystemTags] = useState<Record<string, string[]>>(() =>
    JSON.parse(JSON.stringify(initial.systemTags))
  );
  const [customTags, setCustomTags] = useState<string[]>(() => [...initial.customTags]);
  const [candidateHint, setCandidateHint] = useState<string | null>(null);
  const inheritedFrom = useMemo(() => {
    const manual = parseManualTags(genreTagsManual);
    if (!isEmptyTags(manual)) return null;
    const ai = parseManualTags(genreTagsAi);
    if (!isEmptyTags(ai)) return 'ai' as const;
    const scraped = parseManualTags(scrapedTags);
    if (!isEmptyTags(scraped)) return 'scraped' as const;
    return null;
  }, [genreTagsManual, genreTagsAi, scrapedTags]);
  const [search, setSearch] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const customInputRef = useRef<HTMLInputElement>(null);

  const systemFlat = useMemo(() => {
    const result: string[] = [];
    for (const list of Object.values(systemTags)) {
      for (const tag of list) if (!result.includes(tag)) result.push(tag);
    }
    return result;
  }, [systemTags]);

  const systemCount = systemFlat.length;
  const customCount = customTags.length;
  const totalCount = systemCount + customCount;

  const toggleSystemTag = (category: string, tag: string) => {
    setSystemTags(prev => {
      const next = { ...prev };
      const list = next[category] ? [...next[category]] : [];
      const idx = list.indexOf(tag);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        if (systemCount >= MAX_SYSTEM_TAGS) return prev;
        list.push(tag);
      }
      if (list.length > 0) next[category] = list;
      else delete next[category];
      return next;
    });
  };

  const removeSystemTag = (tag: string) => {
    setSystemTags(prev => {
      const next: Record<string, string[]> = {};
      for (const [cat, tags] of Object.entries(prev)) {
        const filtered = tags.filter(t => t !== tag);
        if (filtered.length > 0) next[cat] = filtered;
      }
      return next;
    });
  };

  const addCustomTag = () => {
    const val = customInput.trim();
    if (!val) return;
    if (val.length > MAX_CUSTOM_TAG_LEN) return;
    if (customTags.length >= MAX_CUSTOM_TAGS) return;
    if (customTags.includes(val)) return;
    if (allPoolTags.includes(val)) return;
    setCustomTags(prev => [...prev, val]);
    setCustomInput('');
    customInputRef.current?.focus();
  };

  const removeCustomTag = (tag: string) => {
    setCustomTags(prev => prev.filter(t => t !== tag));
  };

  const handleCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomTag();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setCandidateHint(null);
    try {
      const res = await apiFetch('/api/drama/genre', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drama_id: dramaId, systemTags, customTags }),
      });
      const result = await res.json();
      if (result.success) {
        const d = result.data;
        const empty = !d || (Object.keys(d.systemTags || {}).length === 0 && (d.customTags || []).length === 0);

        const candidates: { tag_name: string; usage_count: number; isNewCandidate: boolean }[] = result.candidateTags || [];
        const newCandidates = candidates.filter(c => c.isNewCandidate);
        if (newCandidates.length > 0) {
          const names = newCandidates.map(c => `「${c.tag_name}」(${c.usage_count}次)`).join('、');
          setCandidateHint(`自定义标签 ${names} 已达到候选条件，可前往「标签管理」查看`);
          setTimeout(() => {
            onSaved(empty ? null : JSON.stringify(d));
          }, 3000);
        } else {
          const approaching = candidates.filter(c => c.usage_count >= 2 && !c.isNewCandidate);
          if (approaching.length > 0) {
            const names = approaching.map(c => `「${c.tag_name}」(${c.usage_count}/3)`).join('、');
            setCandidateHint(`自定义标签 ${names} 即将达到候选条件`);
          }
          onSaved(empty ? null : JSON.stringify(d));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/drama/genre', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drama_id: dramaId, systemTags: {}, customTags: [] }),
      });
      const result = await res.json();
      if (result.success) onSaved(null);
    } finally {
      setSaving(false);
    }
  };

  const toggleCollapse = (cat: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const searchLower = search.trim().toLowerCase();

  const filteredCategories = useMemo(() => {
    if (!tagPool) return [];
    if (!searchLower) return tagCategoryList;
    return tagCategoryList.filter(cat =>
      (tagPool[cat] || []).some(tag => tag.toLowerCase().includes(searchLower))
    );
  }, [searchLower, tagPool, tagCategoryList]);

  if (tagPoolLoading) {
    return (
      <div className="p-4 text-xs text-primary-text-muted text-center border border-primary-border rounded-lg">
        加载标签系统...
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 border border-primary-border rounded-lg bg-primary-sidebar/30">
      {/* Candidate hint */}
      {candidateHint && (
        <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-[11px] text-green-700 flex items-start gap-1.5">
          <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{candidateHint}</span>
        </div>
      )}
      {/* Inherited tags hint */}
      {inheritedFrom && !candidateHint && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-600">
          已自动继承{inheritedFrom === 'ai' ? 'AI识别' : '抓取'}的标签，保存后将转为人工标签。可直接修改或删除。
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-primary-text">
          已选标签 ({totalCount})
          <span className="text-primary-text-muted ml-1">
            系统{systemCount}/{MAX_SYSTEM_TAGS} · 自定义{customCount}/{MAX_CUSTOM_TAGS}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {totalCount > 0 && (
            <button onClick={handleClear} disabled={saving}
              className="text-xs text-red-500 hover:underline disabled:opacity-50">
              清除全部
            </button>
          )}
          <button onClick={onCancel}
            className="text-xs text-primary-text-muted hover:underline">
            取消
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1 text-xs font-medium bg-primary-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Selected system tags */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {systemFlat.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-accent-bg text-primary-accent text-xs rounded-full border border-primary-accent-border">
            {tag}
            <button onClick={() => removeSystemTag(tag)} className="hover:text-red-500 transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {customTags.map(tag => (
          <span key={`c-${tag}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full border border-amber-200">
            🏷 {tag}
            <button onClick={() => removeCustomTag(tag)} className="hover:text-red-500 transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {totalCount === 0 && (
          <span className="text-xs text-primary-text-muted">暂无人工标签，请从下方分类中选择或添加自定义标签</span>
        )}
      </div>

      {/* Custom tag input */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={customInputRef}
            type="text"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={handleCustomKeyDown}
            placeholder={customCount >= MAX_CUSTOM_TAGS ? `最多${MAX_CUSTOM_TAGS}个自定义标签` : '输入自定义标签（回车添加）'}
            maxLength={MAX_CUSTOM_TAG_LEN}
            disabled={customCount >= MAX_CUSTOM_TAGS}
            className="w-full px-3 py-1.5 border border-amber-200 rounded-lg text-xs bg-amber-50/50 focus:outline-none focus:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <button
          onClick={addCustomTag}
          disabled={!customInput.trim() || customCount >= MAX_CUSTOM_TAGS}
          className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          添加
        </button>
      </div>
      {customInput.trim() && allPoolTags.includes(customInput.trim()) && (
        <p className="text-[10px] text-amber-600 -mt-1">该标签已存在于系统标签中，请从下方分类中选择</p>
      )}
      {customInput.trim().length > MAX_CUSTOM_TAG_LEN && (
        <p className="text-[10px] text-red-500 -mt-1">标签长度不能超过{MAX_CUSTOM_TAG_LEN}个字符</p>
      )}

      {/* Search (system tags only) */}
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索系统标签..."
          className="w-full pl-8 pr-3 py-1.5 border border-primary-border rounded-lg text-xs bg-white focus:outline-none focus:border-primary-accent"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-primary-text-muted hover:text-primary-text">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tag categories */}
      <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
        {filteredCategories.length === 0 ? (
          <p className="text-xs text-primary-text-muted text-center py-4">无匹配标签</p>
        ) : (
          filteredCategories.map(category => {
            const tags = tagPool ? (tagPool[category] || []) : [];
            const visibleTags = searchLower
              ? tags.filter(t => t.toLowerCase().includes(searchLower))
              : tags;
            if (visibleTags.length === 0) return null;
            const isCollapsed = collapsed.has(category);
            const catSelected = systemTags[category] || [];
            const catCount = catSelected.length;

            return (
              <div key={category} className="border border-primary-border/50 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleCollapse(category)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-primary-sidebar/50 hover:bg-primary-sidebar transition-colors"
                >
                  <span className="text-xs font-medium text-primary-text-secondary">
                    {category}
                    {catCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 bg-primary-accent text-white text-[10px] rounded-full">
                        {catCount}
                      </span>
                    )}
                  </span>
                  <svg className={`w-3.5 h-3.5 text-primary-text-muted transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="px-3 py-2 flex flex-wrap gap-1.5">
                    {visibleTags.map(tag => {
                      const active = catSelected.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleSystemTag(category, tag)}
                          disabled={!active && systemCount >= MAX_SYSTEM_TAGS}
                          className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                            active
                              ? 'bg-primary-accent text-white border-primary-accent'
                              : systemCount >= MAX_SYSTEM_TAGS
                                ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                                : 'bg-white text-primary-text-secondary border-primary-border hover:border-primary-accent hover:text-primary-accent'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
