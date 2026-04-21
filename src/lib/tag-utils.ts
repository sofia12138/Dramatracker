import { TAG_SYSTEM, TAG_CATEGORY_LIST, ALL_TAGS, isValidTagCategory, type MergedTagSystem } from '@/constants/tag-system';

export interface ManualTagsData {
  systemTags: Record<string, string[]>;
  customTags: string[];
}

const EMPTY: ManualTagsData = { systemTags: {}, customTags: [] };
const MAX_CUSTOM_TAG_LEN = 10;
const MAX_CUSTOM_TAGS = 5;

/**
 * Parse genre_tags_manual from any legacy or current format into the standard structure.
 */
export function parseManualTags(input: unknown): ManualTagsData {
  if (input == null) return { ...EMPTY, systemTags: {}, customTags: [] };

  let parsed: unknown = input;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return { ...EMPTY, systemTags: {}, customTags: [] };
    try { parsed = JSON.parse(trimmed); } catch { return { ...EMPTY, systemTags: {}, customTags: [] }; }
  }

  if (Array.isArray(parsed)) {
    const flat = parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return migrateFlatTags(flat);
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    if ('systemTags' in obj || 'customTags' in obj) {
      const st = (typeof obj.systemTags === 'object' && obj.systemTags !== null && !Array.isArray(obj.systemTags))
        ? obj.systemTags as Record<string, unknown> : {};
      const ct = Array.isArray(obj.customTags) ? obj.customTags : [];

      const systemTags: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(st)) {
        if (!Array.isArray(v)) continue;
        const tags = v.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
        if (tags.length > 0) systemTags[k] = tags;
      }
      const customTags = ct.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      return { systemTags, customTags };
    }

    const flat: string[] = [];
    let hasCategories = false;
    const systemTags: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!Array.isArray(v)) continue;
      const tags = v.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
      if (tags.length === 0) continue;
      if (isValidTagCategory(k)) {
        systemTags[k] = tags;
        hasCategories = true;
      } else {
        flat.push(...tags);
      }
    }
    if (hasCategories) {
      const customTags: string[] = [];
      for (const tag of flat) {
        let placed = false;
        for (const category of TAG_CATEGORY_LIST) {
          if ((TAG_SYSTEM[category] as readonly string[]).includes(tag)) {
            if (!systemTags[category]) systemTags[category] = [];
            if (!systemTags[category].includes(tag)) systemTags[category].push(tag);
            placed = true;
            break;
          }
        }
        if (!placed && !customTags.includes(tag)) {
          customTags.push(tag);
        }
      }
      return { systemTags, customTags };
    }
    return migrateFlatTags(flat);
  }

  return { ...EMPTY, systemTags: {}, customTags: [] };
}

function migrateFlatTags(flat: string[]): ManualTagsData {
  const systemTags: Record<string, string[]> = {};
  const customTags: string[] = [];

  for (const tag of flat) {
    let placed = false;
    for (const category of TAG_CATEGORY_LIST) {
      if ((TAG_SYSTEM[category] as readonly string[]).includes(tag)) {
        if (!systemTags[category]) systemTags[category] = [];
        if (!systemTags[category].includes(tag)) systemTags[category].push(tag);
        placed = true;
        break;
      }
    }
    if (!placed && !customTags.includes(tag)) {
      customTags.push(tag);
    }
  }
  return { systemTags, customTags };
}

/**
 * Normalize systemTags: keep only valid categories & tags, deduplicate.
 * When merged is provided, validates against the merged (static + dynamic) tag pool.
 */
export function normalizeSystemTags(tags: Record<string, string[]>, merged?: MergedTagSystem): Record<string, string[]> {
  const pool: Record<string, readonly string[]> = merged
    ? merged
    : Object.fromEntries(Object.entries(TAG_SYSTEM).map(([k, v]) => [k, v as readonly string[]]));
  const result: Record<string, string[]> = {};
  for (const [category, tagList] of Object.entries(tags)) {
    if (!(category in pool)) continue;
    const poolTags = pool[category];
    const valid = Array.from(new Set(
      tagList.filter(t => poolTags.includes(t))
    ));
    if (valid.length > 0) result[category] = valid;
  }
  return result;
}

/**
 * Normalize customTags: trim, deduplicate, limit length & count.
 * When mergedAllTags is provided, uses the merged pool for collision detection.
 */
export function normalizeCustomTags(tags: string[], mergedAllTags?: string[]): string[] {
  const allTags = mergedAllTags || ALL_TAGS;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const t = (typeof raw === 'string' ? raw : '').trim();
    if (!t || t.length > MAX_CUSTOM_TAG_LEN) continue;
    if (allTags.includes(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= MAX_CUSTOM_TAGS) break;
  }
  return result;
}

/**
 * Flatten ManualTagsData into a simple 1D array for display.
 */
export function flattenManualTags(data: ManualTagsData): string[] {
  const result: string[] = [];
  for (const tagList of Object.values(data.systemTags)) {
    for (const tag of tagList) {
      if (!result.includes(tag)) result.push(tag);
    }
  }
  for (const tag of data.customTags) {
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}

/**
 * Check if ManualTagsData is effectively empty.
 */
export function isEmptyTags(data: ManualTagsData): boolean {
  return Object.values(data.systemTags).every(arr => arr.length === 0) && data.customTags.length === 0;
}

/**
 * Validate systemTags against TAG_SYSTEM (or merged system if provided).
 */
export function validateSystemTags(tags: Record<string, string[]>, merged?: MergedTagSystem): { valid: boolean; errors: string[] } {
  const pool: Record<string, readonly string[]> = merged
    ? merged
    : Object.fromEntries(Object.entries(TAG_SYSTEM).map(([k, v]) => [k, v as readonly string[]]));
  const errors: string[] = [];
  for (const [category, tagList] of Object.entries(tags)) {
    if (!(category in pool)) {
      errors.push(`无效分类: ${category}`);
      continue;
    }
    for (const tag of tagList) {
      if (!pool[category].includes(tag)) {
        errors.push(`分类"${category}"中不存在标签"${tag}"`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Count custom tag usage from an array of genre_tags_manual raw strings.
 */
export function countCustomTagsFromRows(rows: { genre_tags_manual: string | null }[]): { tag_name: string; usage_count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const { customTags } = parseManualTags(row.genre_tags_manual);
    for (const tag of customTags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag_name, usage_count]) => ({ tag_name, usage_count }))
    .sort((a, b) => b.usage_count - a.usage_count);
}

// ---- Compat functions for consumers that display tags as flat arrays ----

/**
 * Parse any raw tag value (genre_tags_manual/ai/scraped) into flat array.
 *
 * 入参做成 unknown 是因为不同数据源返回类型不同：
 *   - SQLite (better-sqlite3) 把 TEXT 列读成 string
 *   - MySQL (mysql2) 对 JSON 列会自动 JSON.parse，直接返回 array/object
 * 所以这里需要同时容忍 string / array / object / null / undefined。
 */
export function parseTagsCompat(raw: unknown): string[] {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string');
  }

  if (typeof raw === 'object') {
    return flattenManualTags(parseManualTags(raw));
  }

  const str = typeof raw === 'string' ? raw : String(raw);
  const trimmed = str.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    if (typeof parsed === 'object' && parsed !== null) {
      return flattenManualTags(parseManualTags(parsed));
    }
    return [];
  } catch {
    return [];
  }
}

export function getFinalTagsCompat(
  manualRaw: unknown,
  aiRaw: unknown,
  scrapedRaw: unknown,
): string[] {
  const manual = parseTagsCompat(manualRaw);
  if (manual.length > 0) return manual;
  const ai = parseTagsCompat(aiRaw);
  if (ai.length > 0) return ai;
  return parseTagsCompat(scrapedRaw);
}

export function getTagSourceCompat(
  manualRaw: unknown,
  aiRaw: unknown,
  scrapedRaw: unknown,
): 'manual' | 'ai' | 'scraped' | 'none' {
  if (parseTagsCompat(manualRaw).length > 0) return 'manual';
  if (parseTagsCompat(aiRaw).length > 0) return 'ai';
  if (parseTagsCompat(scrapedRaw).length > 0) return 'scraped';
  return 'none';
}
