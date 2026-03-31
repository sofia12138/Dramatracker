export const TAG_SYSTEM = {
  "剧情Tag-核心爱情/关系类": [
    "先婚后爱", "契约婚姻", "追妻火葬场", "破镜重圆", "替嫁", "替婚",
    "替嫁冲喜", "闪婚", "闪恋", "办公室恋情", "霸总秘书", "年下恋",
    "姐弟恋", "虐恋", "囚宠", "强制爱", "双向救赎", "治愈",
    "隐婚", "地下恋", "豪门恩怨", "家族联姻",
  ],
  "剧情Tag-逆袭/打脸/爽点类": [
    "打脸虐渣", "逆袭", "重生逆袭", "马甲", "掉马", "真假千金",
    "替罪", "替父坐牢", "顶罪", "扮猪吃老虎", "复仇", "黑化",
    "赘婿逆袭", "上门女婿",
  ],
  "剧情Tag-奇幻/脑洞/穿越类": [
    "穿书", "穿成炮灰", "穿成反派", "重生", "重生回到过去", "系统",
    "金手指", "穿越", "古代穿越", "民国穿越", "玄幻", "修仙",
    "兽王", "魔尊", "双重身份", "人格分裂",
  ],
  "剧情Tag-题材场景类": [
    "都市", "豪门", "霸总", "古装", "王爷", "皇帝", "宅斗", "权谋",
    "娱乐圈", "顶流", "影帝", "练习生", "校园", "学霸", "校草",
    "重生校园", "萌宝", "天才宝宝", "带球跑", "职场", "医生",
    "律师", "设计师", "女频大女主", "搞事业", "男频", "战神", "神医",
  ],
  "人设Tag-男主（现代都市）": [
    "高冷霸总", "腹黑总裁", "财阀大佬", "偏执霸总", "疯批霸总",
    "病娇霸总", "追妻火葬场男主", "破镜重圆男主", "哑巴总裁",
    "缄默症霸总", "禁欲系总裁", "斯文败类", "黑道大佬", "黑帮总裁",
    "隐婚霸总", "秘密老公",
  ],
  "人设Tag-男主（古装/奇幻）": [
    "腹黑王爷", "冷酷王爷", "战神王爷", "深情帝王", "偏执帝王",
    "暴君", "魔尊", "兽王", "妖帝", "神医", "毒医", "隐世高人",
    "反派男主", "疯批反派",
  ],
  "人设Tag-男主（男频/逆袭）": [
    "赘婿", "上门女婿", "隐忍男主", "战神回归", "退役兵王",
    "神医男主", "系统男主", "重生学霸", "隐忍大佬", "扮猪吃老虎男主",
  ],
  "人设Tag-女主（现代都市）": [
    "清冷美人", "钓系美人", "破碎感美人", "马甲女主", "隐藏大佬",
    "全能女主", "替罪女主", "出狱女主", "落魄千金", "清醒女主",
    "搞事业女主", "反恋爱脑", "秘书", "打工人", "酒吧服务员",
    "带球跑女主", "单亲妈妈", "白切黑女主", "复仇女主",
  ],
  "人设Tag-女主（古装/奇幻）": [
    "替嫁新娘", "冲喜新娘", "假千金", "穿越女主", "现代灵魂",
    "真千金", "落魄贵女", "医女", "毒女", "杀手女主",
  ],
  "人设Tag-女主（校园）": [
    "学霸女主", "重生学神", "校园小白花", "逆袭女主",
  ],
  "人设Tag-高频配角": [
    "忠犬特助", "万能助理", "温柔男二", "骑士男二", "医生男二",
    "闺蜜", "助攻姐妹", "萌宝", "天才宝宝",
  ],
  "人设Tag-高频反派": [
    "白月光", "前女友", "初恋", "绿茶女配", "心机女", "白莲花",
    "恶毒婆婆", "恶母", "偏心父母", "假千金", "继妹", "庶妹",
    "商业对手", "情敌", "恶毒男配", "偏执追求者",
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
