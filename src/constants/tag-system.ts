export const TAG_SYSTEM = {
  "剧情Tag": [
    "先婚后爱", "契约婚姻", "追妻", "破镜重圆", "替嫁", "LGBT",
    "禁忌恋", "闪婚", "一夜情", "办公室恋情", "BDSM", "虐恋",
    "团宠", "初恋", "甜宠", "打脸", "逆袭", "复仇", "赘婿",
    "穿越", "重生", "马甲", "西方神话", "都市", "豪门",
    "娱乐圈", "反向后宫", "大女主", "男频", "带球跑", "萌宝",
  ],
  "人设Tag": [
    "霸总", "狼人", "黑手党", "特工", "龙王", "赛车手", "运动员",
    "落魄千金", "秘书", "处女", "好女孩", "吸血鬼", "校草", "坏男孩",
  ],
} as const;

export type TagSystem = typeof TAG_SYSTEM;
export type TagCategory = keyof TagSystem;
export type TagValue = TagSystem[TagCategory][number];

export const TAG_CATEGORY_LIST = Object.keys(TAG_SYSTEM) as TagCategory[];
export const ALL_TAGS: string[] = Object.values(TAG_SYSTEM).flat();

export function isValidTagCategory(category: string): category is TagCategory {
  return category in TAG_SYSTEM;
}

export function isValidTag(category: TagCategory, tag: string): boolean {
  return (TAG_SYSTEM[category] as readonly string[]).includes(tag);
}

export type MergedTagSystem = Record<string, string[]>;

export function getMergedTagSystem(extraRows: { category: string; tag_name: string }[]): MergedTagSystem {
  const merged: MergedTagSystem = {};
  for (const [cat, tags] of Object.entries(TAG_SYSTEM)) {
    merged[cat] = [...(tags as readonly string[])];
  }
  for (const row of extraRows) {
    if (!(row.category in merged)) continue;
    if (!merged[row.category].includes(row.tag_name)) {
      merged[row.category].push(row.tag_name);
    }
  }
  return merged;
}

export function getMergedAllTags(merged: MergedTagSystem): string[] {
  return Object.values(merged).flat();
}

export function isValidInMerged(merged: MergedTagSystem, category: string, tag: string): boolean {
  return category in merged && merged[category].includes(tag);
}
