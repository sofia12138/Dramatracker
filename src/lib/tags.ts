export const PRESET_GENRE_TAGS = [
  '复仇', '情感', '豪门', '逆袭', '隐藏身份', '契约婚姻',
  '穿越', '重生', '甜宠', '虐恋', '悬疑', '萌宝',
  '霸总', '校园', '都市', '古风', '马甲', '先婚后爱',
  '狼人', '家庭',
];

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    let t = (raw ?? '').trim();
    if (!t) continue;
    if (/^[\x20-\x7e]+$/.test(t)) t = t.toLowerCase();
    if (t.length > 10) t = t.slice(0, 10);
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= 10) break;
  }
  return result;
}

export function getFinalTags(
  manualRaw: string | null | undefined,
  aiRaw: string | null | undefined,
  scrapedRaw: string | null | undefined,
): string[] {
  const manual = parseTags(manualRaw);
  if (manual.length > 0) return manual;
  const ai = parseTags(aiRaw);
  if (ai.length > 0) return ai;
  return parseTags(scrapedRaw);
}

export type TagSource = 'manual' | 'ai' | 'scraped' | 'none';

export function getTagSource(
  manualRaw: string | null | undefined,
  aiRaw: string | null | undefined,
  scrapedRaw: string | null | undefined,
): TagSource {
  if (parseTags(manualRaw).length > 0) return 'manual';
  if (parseTags(aiRaw).length > 0) return 'ai';
  if (parseTags(scrapedRaw).length > 0) return 'scraped';
  return 'none';
}
