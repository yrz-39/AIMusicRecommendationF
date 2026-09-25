import type { FeatureDelta } from "../learn/featureLearner.js";
import { chatJson } from "./deepseek.js";
import type { LlmConfig } from "../../config/env.js";

/**
 * LLM 歌曲特征解析：一句话感受 → FeatureDelta（与规则版 parseSongFeedback 同一契约）。
 *
 * moodTags 限制在引擎已知的词表内（LLM 从词表选），避免自由发挥污染特征库；
 * 输出经代码校验，任何非法值都触发上层回退规则版。
 */

/** 引擎/融合层认识的全部情绪词（MOOD_TAG_ZH 的 keys） */
const MOOD_VOCAB = ["focus", "calm", "uplifting", "warm", "dreamy", "soothing", "gentle", "groovy", "bright", "melancholic"];

const SYSTEM = `你是歌曲听感解析器。用户会用一句话描述一首歌给他的感受，你把它解析为结构化 JSON（不要输出任何其他文字）。

输出字段：
- energyHint: "high" | "medium" | "low" | null（这首歌听起来 energy 高低；high=提神带感，medium=适中，low=安静舒缓）
- moodTags: 字符串数组，只能从这个词表选：["focus","calm","uplifting","warm","dreamy","soothing","gentle","groovy","bright","melancholic"]（分别对应专注/平静/振奋/温暖/梦幻/抚慰/柔和/律动/明亮/忧郁）
- vocalDensity: "none" | "low" | "medium" | "high" | null（none=没有人声/纯音乐，low=歌词少人声轻）
- matched: 字符串数组，每个结论对应的用户原话片段
- understood: true/false，你是否理解了这句话

示例：
用户：「这首歌给我力气，能够提高精力，振奋精神」
输出：{"energyHint":"high","moodTags":["uplifting","bright"],"vocalDensity":null,"matched":["给我力气","提高精力","振奋精神"],"understood":true}`;

function moodTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && MOOD_VOCAB.includes(x.trim()))
    .slice(0, 4);
}

/** LLM 解析歌曲反馈。失败/未理解返回 null（上层回退规则版）。 */
export async function parseSongFeedbackLlm(
  text: string,
  config: LlmConfig,
  fetchImpl?: typeof fetch,
): Promise<FeatureDelta | null> {
  const out = await chatJson({ ...config, system: SYSTEM, user: text, fetchImpl: config.fetchImpl ?? fetchImpl });
  if (out === null) return null;

  const delta: FeatureDelta = { moodTags: moodTags(out.moodTags), matched: [], understood: false };
  if (out.energyHint === "high" || out.energyHint === "medium" || out.energyHint === "low") {
    delta.energyHint = out.energyHint;
  }
  if (out.vocalDensity === "none" || out.vocalDensity === "low" || out.vocalDensity === "medium" || out.vocalDensity === "high") {
    delta.vocalDensity = out.vocalDensity;
  }
  if (Array.isArray(out.matched)) {
    delta.matched = out.matched.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 8);
  }
  // 至少解析出一项实际特征才算理解
  delta.understood =
    delta.energyHint !== undefined || delta.moodTags.length > 0 || delta.vocalDensity !== undefined;
  return delta.understood ? delta : null;
}
