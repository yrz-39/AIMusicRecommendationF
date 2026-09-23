import type { Level, StudyContext } from "../types.js";

/**
 * 可解释的经验先验表。
 * 这些数值是推荐理由的一部分，必须真实参与计算，禁止装饰性数据。
 */

/** 流派 → 感知能量先验（0..1）。用于曲目缺少 energy 字段时的稳健兜底。 */
export const GENRE_ENERGY_PRIOR: Record<string, number> = {
  ambient: 0.15,
  piano: 0.25,
  classical: 0.3,
  lofi: 0.3,
  acoustic: 0.4,
  folk: 0.4,
  soundtrack: 0.4,
  jazz: 0.45,
  "post-rock": 0.45,
  rnb: 0.5,
  "city-pop": 0.55,
  pop: 0.6,
  acg: 0.6,
  electronic: 0.7,
  hiphop: 0.7,
  rock: 0.75,
  metal: 0.9,
};

/** 情境 → 期望的曲目情绪标签方向 */
export const MOOD_DIRECTION: Record<string, string[]> = {
  tired: ["focus", "calm", "dreamy"],
  anxious: ["calm", "soothing", "warm"],
  irritable: ["calm", "focus"],
  down: ["uplifting", "warm", "gentle"],
  bored: ["uplifting", "groovy"],
  happy: ["uplifting", "bright"],
  lonely: ["warm", "gentle"],
  calm: ["calm", "focus"],
};

/** 用户情绪词（解析器输出）→ 期望方向键。 */
export const CONTEXT_MOOD_TO_DESIRED: Record<string, string> = {
  tired: "tired",
  anxious: "anxious",
  irritable: "irritable",
  down: "down",
  bored: "bored",
  happy: "happy",
  lonely: "lonely",
  calm: "calm",
};

export const LEVEL_VALUE: Record<Level, number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
};

/** 派生的"目标听感"画像 —— 推荐引擎的中间表示，方便测试与解释。 */
export interface TargetProfile {
  /** 目标能量 0..1 */
  targetEnergy: number;
  /** 期望人声密度 */
  targetVocal: "instrumental" | "few-lyrics" | "any";
  /** 期望的曲目情绪方向 */
  desiredMoods: string[];
  /** 各默认值的来源标记，用于解释"为什么这么推" */
  defaults: {
    energy: "stated" | "inferred" | "default";
    vocal: "stated" | "inferred" | "default";
  };
}
