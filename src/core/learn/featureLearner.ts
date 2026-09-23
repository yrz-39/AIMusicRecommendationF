import type { Track } from "../types.js";

/**
 * 自然语言歌曲特征学习。
 *
 * 用途（PRODUCT.md 最终形态支柱 3）：用户对正在听的歌说
 * "有力气，能够提高精力，振奋精神" → 解析为结构化特征增量 → 融合进曲目元数据。
 *
 * 当前实现：词库规则解析（零依赖、可测试）。
 * 未来 LLM 解析器实现同一 parseSongFeedback 契约后可直接替换，
 * 特征融合逻辑（blend）不变。
 */

export interface FeatureDelta {
  /** 解析出的能量取向提示 */
  energyHint?: "high" | "medium" | "low";
  /** 解析出的情绪/场景标签（情绪词 → 曲目 moodTags） */
  moodTags: string[];
  /** 用户明确提到的人声偏好 */
  vocalDensity?: "none" | "low" | "medium" | "high";
  /** 命中的原始短语（可解释） */
  matched: string[];
  /** 无法理解的输入 */
  understood: boolean;
}

export interface LearnResult {
  track: Track;
  changes: string[];
  delta: FeatureDelta;
}

/** 每次反馈的能量学习率：单条反馈温和移动，多次反馈收敛到真实听感 */
export const ENERGY_LEARNING_RATE = 0.3;

interface FeedbackRule {
  pattern: RegExp;
  energy?: FeatureDelta["energyHint"];
  moodTags?: string[];
  vocalDensity?: FeatureDelta["vocalDensity"];
}

/** "这首歌给我什么感受" 词库 */
const RULES: FeedbackRule[] = [
  // 提神 / 给力
  { pattern: /(有力气|给力|提神|醒脑|振奋|带劲|带感|有劲|燃|来劲|精神了起来|提高精力|精力提高|充满能量|energetic)/i, energy: "high", moodTags: ["uplifting", "bright"] },
  { pattern: /(节奏感|动感|想跟着抖腿|律动)/, energy: "high", moodTags: ["groovy"] },
  // 平静 / 放松
  { pattern: /(安静|舒缓|平静|放松|轻柔|柔和|治愈|静心|心静|放松下来)/, energy: "low", moodTags: ["calm", "soothing"] },
  { pattern: /(催眠|想睡|睡前|入眠)/, energy: "low", moodTags: ["dreamy", "calm"] },
  // 专注
  { pattern: /(专注|专心|学习的时候|写代码的时候|工作的时候|进入状态|心流)/, moodTags: ["focus"] },
  // 情绪
  { pattern: /(开心|快乐|愉快|心情好|阳光)/, moodTags: ["bright", "warm"] },
  { pattern: /(难过|伤心|emo|伤感|忧郁|低落)/i, moodTags: ["melancholic"] },
  { pattern: /(温暖|温柔|暖)/, moodTags: ["warm", "gentle"] },
  { pattern: /(梦幻|缥缈|空灵|恍惚)/, moodTags: ["dreamy"] },
  // 人声
  { pattern: /(没有?人声|没有?歌词|纯音乐|instrumental)/i, vocalDensity: "none" },
  { pattern: /(歌词少|人声少|少唱)/, vocalDensity: "low" },
];

export function parseSongFeedback(text: string): FeatureDelta {
  const clean = text.trim();
  const delta: FeatureDelta = { moodTags: [], matched: [], understood: false };
  if (clean === "") return delta;

  for (const rule of RULES) {
    // global 标记：收集一句话里所有命中短语（"给我力气、提高精力、振奋精神" 应记 3 条）
    const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const hit of clean.matchAll(globalPattern)) {
      delta.matched.push(hit[0] ?? "");
      if (rule.energy !== undefined && delta.energyHint === undefined) {
        delta.energyHint = rule.energy;
      }
      for (const tag of rule.moodTags ?? []) {
        if (!delta.moodTags.includes(tag)) delta.moodTags.push(tag);
      }
      if (rule.vocalDensity !== undefined && delta.vocalDensity === undefined) {
        delta.vocalDensity = rule.vocalDensity;
      }
    }
  }
  delta.understood = delta.matched.length > 0;
  return delta;
}

const ENERGY_TARGET: Record<NonNullable<FeatureDelta["energyHint"]>, number> = {
  low: 0.28,
  medium: 0.5,
  high: 0.72,
};

/** 把特征增量融合进曲目：能量按学习率混合，标签增量叠加（带 cap）。 */
export function applyFeatureDelta(track: Track, delta: FeatureDelta): LearnResult {
  const next: Track = { ...track, moodTags: [...(track.moodTags ?? [])], genres: [...(track.genres ?? [])] };
  const moodTags = next.moodTags as string[];
  const changes: string[] = [];

  if (delta.energyHint !== undefined) {
    const target = ENERGY_TARGET[delta.energyHint];
    const old = next.energy ?? 0.5;
    const blended = old * (1 - ENERGY_LEARNING_RATE) + target * ENERGY_LEARNING_RATE;
    next.energy = Math.round(blended * 100) / 100;
    const direction = next.energy > old ? "提升" : next.energy < old ? "降低" : "维持";
    changes.push(`能量 ${old.toFixed(2)} → ${next.energy.toFixed(2)}（${direction}）`);
  }

  for (const tag of delta.moodTags) {
    if (!moodTags.includes(tag)) {
      if (moodTags.length < 6) {
        moodTags.push(tag);
        changes.push(`新增情绪标签「${tag}」`);
      }
    }
  }

  if (delta.vocalDensity !== undefined && next.vocalDensity !== delta.vocalDensity) {
    next.vocalDensity = delta.vocalDensity;
    changes.push(`人声密度 → ${delta.vocalDensity}`);
  }

  return { track: next, changes, delta };
}
