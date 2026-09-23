import type { Level, MusicPrefs, StudyContext } from "../types.js";

/**
 * 规则式中文情境解析器。
 *
 * 设计原则：
 * - 只输出真正从输入中"读到"的信息，缺失字段留空并记录到 unknowns，
 *   由推荐引擎用稳健默认值兜底；
 * - 每个结论都携带命中的原始关键词（matched），保证可解释；
 * - 未来 LLM 解析器实现同一接口，输出同一 StudyContext 结构。
 */

interface LexiconRule {
  /** 命中关键词（正则） */
  pattern: RegExp;
  /** 命中后的赋值 */
  apply: (ctx: ParserDraft) => void;
}

/** 解析过程中的可变草稿 */
interface ParserDraft {
  task?: string;
  durationMinutes?: number;
  energy?: Level;
  stress?: Level;
  focusDifficulty?: Level;
  moods: string[];
  prefs: MusicPrefs;
  matched: string[];
}

export interface ParseResult {
  context: StudyContext;
}

const LEVELS: Record<string, Level> = {
  low: "low",
  medium: "medium",
  high: "high",
};

/* ------------------------------ 任务词库 ------------------------------ */

const TASK_RULES: LexiconRule[] = [
  { pattern: /(写代码|敲代码|编程|开发|debug|调试|码代码)/i, apply: (d) => (d.task = "写代码") },
  { pattern: /(复习|备考|温书|考试|刷题|做卷子)/, apply: (d) => (d.task = "复习备考") },
  { pattern: /(写论文|论文|写作业|赶报告|写报告|写文档|写文章|写作)/, apply: (d) => (d.task = "写作") },
  { pattern: /(读书|看书|阅读|文献)/, apply: (d) => (d.task = "阅读") },
  { pattern: /(背单词|学外语|学英语|网课|听课|上课|做题库)/, apply: (d) => (d.task = "上课学习") },
  { pattern: /(加班|上班|处理工作|工作)/, apply: (d) => (d.task = "工作") },
  { pattern: /(画图|设计|剪视频|剪片|做图|渲染|建模)/, apply: (d) => (d.task = "设计创作") },
];

/* ------------------------------ 精力词库 ------------------------------ */

const ENERGY_RULES: LexiconRule[] = [
  // 注意：特例（"有点累"=中度）必须先于一般规则（"累"=低度）判定
  {
    pattern: /(有点累|有点儿累|有点困|还行|一般般|状态一般|还算精神)/,
    apply: (d) => {
      if (!d.energy) d.energy = LEVELS.medium;
    },
  },
  {
    pattern: /(累|疲惫|疲倦|困|乏|没力气|没劲|精疲力尽|心力交瘁|头昏|提不起精神|熬不动)/,
    apply: (d) => {
      if (!d.energy) d.energy = LEVELS.low;
    },
  },
  {
    pattern: /(精力充沛|精神满满|精神很好|状态很好|亢奋|睡不着|特别清醒|元气满满)/,
    apply: (d) => {
      if (!d.energy) d.energy = LEVELS.high;
    },
  },
];

/* ------------------------------ 压力词库 ------------------------------ */

const STRESS_RULES: LexiconRule[] = [
  {
    pattern: /(压力大|很紧张|太紧张|焦虑|心慌|发愁|愁得|烦躁|烦得|喘不过气|内耗|崩不住|绷不住)/,
    apply: (d) => {
      if (!d.stress) d.stress = LEVELS.high;
    },
  },
  {
    pattern: /(没什么压力|没有压力|毫无压力|很放松|挺放松|放松|轻松)/,
    apply: (d) => {
      if (!d.stress) d.stress = LEVELS.low;
    },
  },
];

/* ---------------------------- 专注难度词库 ---------------------------- */

const FOCUS_RULES: LexiconRule[] = [
  {
    pattern: /(走神|分心|跑神|注意力不集中|无法集中|不能集中|静不下心|坐不住|专注不了|容易被打断|脑子乱|思绪乱)/,
    apply: (d) => {
      if (!d.focusDifficulty) d.focusDifficulty = LEVELS.high;
    },
  },
  {
    pattern: /(很专注|特别专注|沉浸|心流|状态很稳)/,
    apply: (d) => {
      if (!d.focusDifficulty) d.focusDifficulty = LEVELS.low;
    },
  },
];

/* ------------------------------ 情绪词库 ------------------------------ */

const MOOD_RULES: Array<LexiconRule & { mood: string }> = [
  { mood: "irritable", pattern: /(烦躁|烦|上火|毛躁)/, apply: (d) => pushMood(d, "irritable") },
  { mood: "anxious", pattern: /(焦虑|担心|紧张|心神不宁)/, apply: (d) => pushMood(d, "anxious") },
  { mood: "down", pattern: /(低落|难过|伤心|emo|丧|郁闷|不开心|沮丧)/i, apply: (d) => pushMood(d, "down") },
  { mood: "bored", pattern: /(无聊|乏味|提不起兴趣)/, apply: (d) => pushMood(d, "bored") },
  { mood: "happy", pattern: /(开心|高兴|愉快|兴奋|期待)/, apply: (d) => pushMood(d, "happy") },
  { mood: "lonely", pattern: /(孤独|寂寞|一个人)/, apply: (d) => pushMood(d, "lonely") },
  { mood: "calm", pattern: /(平静|心如止水|很稳)/, apply: (d) => pushMood(d, "calm") },
];

/* --------------------------- 音乐偏好词库 --------------------------- */

const PREF_RULES: LexiconRule[] = [
  // 整体安静程度
  {
    pattern: /(安静|轻柔|舒缓|柔和|温柔|平静一点|静一点|低沉|催眠|放松的音乐|白噪音|氛围)/,
    apply: (d) => (d.prefs.calmness = "calm"),
  },
  {
    pattern: /(提神|醒脑|有劲|带感|燃|动感|节奏感|热血|嗨|活力|激昂)/,
    apply: (d) => (d.prefs.calmness = "energetic"),
  },
  // 人声/歌词
  {
    pattern: /(纯音乐|没有人声|不要人声|无人声|没有歌词|不要歌词|instrumental|白噪音|钢琴曲|轻音乐)/i,
    apply: (d) => (d.prefs.vocalPreference = "instrumental"),
  },
  {
    pattern: /(歌词少|少歌词|人声少|没什么歌词|少一点歌词|别有人声|不要唱|少唱)/,
    apply: (d) => (d.prefs.vocalPreference = "few-lyrics"),
  },
  // 流派
  { pattern: /lo-?fi|低保真/i, apply: (d) => pushGenre(d, "lofi") },
  { pattern: /(古典|交响|室内乐|巴洛克)/, apply: (d) => pushGenre(d, "classical") },
  { pattern: /(钢琴)/, apply: (d) => pushGenre(d, "piano") },
  { pattern: /(后摇|post-?rock)/i, apply: (d) => pushGenre(d, "post-rock") },
  { pattern: /(电子|电音|edm|synth|合成器)/i, apply: (d) => pushGenre(d, "electronic") },
  { pattern: /(爵士|jazz)/i, apply: (d) => pushGenre(d, "jazz") },
  { pattern: /(民谣|folk)/i, apply: (d) => pushGenre(d, "folk") },
  { pattern: /(摇滚|rock)/i, apply: (d) => pushGenre(d, "rock") },
  { pattern: /(流行|pop)/i, apply: (d) => pushGenre(d, "pop") },
  { pattern: /(city\s?pop|城市流行|都市流行)/i, apply: (d) => pushGenre(d, "city-pop") },
  { pattern: /(acg|动漫|二次元|游戏音乐|ost|原声)/i, apply: (d) => pushGenre(d, "acg") },
  // 语言
  { pattern: /(中文歌|国语|华语)/, apply: (d) => pushLang(d, "zh") },
  { pattern: /(英文歌|英语|欧美)/, apply: (d) => pushLang(d, "en") },
  { pattern: /(日语歌|日文歌|日语|日系)/, apply: (d) => pushLang(d, "ja") },
  { pattern: /(韩语歌|韩文歌|韩语|k-?pop)/i, apply: (d) => pushLang(d, "ko") },
];

/* ------------------------------ 时长解析 ------------------------------ */

const CN_NUM: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function parseDurationMinutes(input: string): number | undefined {
  // "一个半小时" / "两个半小时"
  const half = input.match(/([0-9一两二三四五六七八九十]+)\s*个?半\s*[个]?\s*小时/);
  if (half && half[1] !== undefined) {
    const h = toNumber(half[1]);
    if (h !== undefined) return (h + 0.5) * 60;
  }
  // "两小时" / "2个小时" / "半小时"
  const hours = input.match(/([0-9一两二三四五六七八九十半]+)\s*[个]?\s*小时/);
  if (hours && hours[1] !== undefined) {
    const h = toNumber(hours[1]);
    if (h !== undefined) return Math.round(h * 60);
  }
  // "90分钟" / "四十五分钟"
  const minutes = input.match(/([0-9一两二三四五六七八九十半百]+)\s*分\s*[钟]?/);
  if (minutes && minutes[1] !== undefined) {
    const m = toNumber(minutes[1]);
    if (m !== undefined) return m;
  }
  // 模糊时段
  if (/一整天|整天/.test(input)) return 480;
  if (/一下午/.test(input)) return 180;
  if (/一上午/.test(input)) return 180;
  if (/(一)?晚上/.test(input) && !/今晚|今晚就/.test(input)) return 150;
  return undefined;
}

function toNumber(text: string): number | undefined {
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  if (text === "半") return 0.5;
  // 简单纯中文数字（一到十），如 "两小时"
  if (text.length === 1 && CN_NUM[text] !== undefined) return CN_NUM[text];
  if (text === "十") return 10;
  // "十五" "二十" 等两位组合
  const m = text.match(/^(十|([一二两三四五六七八九])?十)?([一二两三四五六七八九]?)$/);
  if (m) {
    const tens = m[2] !== undefined ? CN_NUM[m[2]] : m[1] === "十" ? 1 : undefined;
    const ones = m[3] !== undefined && m[3] !== "" ? CN_NUM[m[3]] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  return undefined;
}

/* ------------------------------ 主入口 ------------------------------ */

export function parseContext(input: string): ParseResult {
  const text = input.trim();
  const draft: ParserDraft = {
    moods: [],
    prefs: {},
    matched: [],
  };

  const applyRules = (rules: LexiconRule[]) => {
    for (const rule of rules) {
      const hit = text.match(rule.pattern);
      if (hit) {
        rule.apply(draft);
        draft.matched.push(hit[0] ?? "");
      }
    }
  };

  applyRules(TASK_RULES);
  applyRules(ENERGY_RULES);
  applyRules(STRESS_RULES);
  applyRules(FOCUS_RULES);
  for (const rule of MOOD_RULES) {
    const hit = text.match(rule.pattern);
    if (hit) {
      rule.apply(draft);
      draft.matched.push(hit[0] ?? "");
    }
  }
  applyRules(PREF_RULES);

  const duration = parseDurationMinutes(text);
  if (duration !== undefined) {
    draft.durationMinutes = duration;
    draft.matched.push(duration >= 60 ? `${Math.floor(duration / 60)}小时余` : `${duration}分钟`);
  }

  const unknowns: string[] = [];
  if (!draft.task) unknowns.push("学习任务");
  if (draft.durationMinutes === undefined) unknowns.push("学习时长");
  if (draft.energy === undefined) unknowns.push("精力水平");
  if (draft.stress === undefined) unknowns.push("压力水平");
  if (draft.focusDifficulty === undefined) unknowns.push("专注难度");
  if (draft.moods.length === 0) unknowns.push("情绪");
  if (!draft.prefs.calmness && !draft.prefs.vocalPreference && (draft.prefs.genres?.length ?? 0) === 0) {
    unknowns.push("音乐偏好");
  }

  // 置信度：捕捉到的方面越多越高；什么都捕到 -> 0.95
  const aspects = [
    draft.task !== undefined,
    draft.durationMinutes !== undefined,
    draft.energy !== undefined,
    draft.stress !== undefined,
    draft.focusDifficulty !== undefined,
    draft.moods.length > 0,
    draft.prefs.calmness !== undefined,
    draft.prefs.vocalPreference !== undefined,
    (draft.prefs.genres?.length ?? 0) > 0,
  ];
  const captured = aspects.filter(Boolean).length;
  const confidence = Math.min(0.95, 0.15 + captured * 0.12);

  const context: StudyContext = {
    task: draft.task,
    durationMinutes: draft.durationMinutes,
    energy: draft.energy,
    stress: draft.stress,
    focusDifficulty: draft.focusDifficulty,
    moods: draft.moods,
    musicPrefs: draft.prefs,
    rawInput: input,
    parserMeta: {
      parser: "rules",
      confidence,
      matched: draft.matched,
      unknowns,
    },
  };
  return { context };
}

function pushMood(d: ParserDraft, mood: string): void {
  if (!d.moods.includes(mood)) d.moods.push(mood);
}

function pushGenre(d: ParserDraft, genre: string): void {
  d.prefs.genres = d.prefs.genres ?? [];
  if (!d.prefs.genres.includes(genre)) d.prefs.genres.push(genre);
}

function pushLang(d: ParserDraft, lang: string): void {
  d.prefs.languages = d.prefs.languages ?? [];
  if (!d.prefs.languages.includes(lang)) d.prefs.languages.push(lang);
}
