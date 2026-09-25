import type { Track } from "../types.js";
import { chatJson } from "./deepseek.js";
import type { LlmConfig } from "../../config/env.js";

/**
 * LLM 批量预标注：导入歌曲的特征冷启动。
 *
 * 用户导入的音频通常只有歌名/歌手/流派，energy/moodTags/vocalDensity 全空。
 * DeepSeek 的训练语料覆盖大量主流歌曲的公开听感信息，凭"歌名 + 歌手 + 流派"
 * 即可给出合理的初始特征（用户后续用「教它」修正）。
 *
 * 校验纪律：情绪词白名单、energy clamp 到 0..1、vocalDensity 枚举校验，
 * 每首歌独立容错——LLM 漏掉或给错的字段保持缺失，绝不写进坏数据。
 */

/** 引擎/融合层认识的全部情绪词 */
const MOOD_VOCAB = ["focus", "calm", "uplifting", "warm", "dreamy", "soothing", "gentle", "groovy", "bright", "melancholic"];

const SYSTEM = `你是音乐听感标注器。根据歌曲名、歌手、流派，判断每首歌的听感特征（你的知识里有大量主流歌曲的公开评价与听感信息；不确定的歌宁可不填，不要编造）。

输入是 JSON 数组，每项 {"id","title","artist","genres"}。
输出 JSON 对象（不要输出任何其他文字）：{"labels": [...]}，labels 每项：
- id: 原样返回
- energy: 0..1 的数字，感知能量（0=极安静舒缓如钢琴纯音乐，0.5=适中流行，1=高能带感如金属/舞曲）
- moodTags: 从词表选 1-3 个：["focus","calm","uplifting","warm","dreamy","soothing","gentle","groovy","bright","melancholic"]（专注/平静/振奋/温暖/梦幻/抚慰/柔和/律动/明亮/忧郁）
- vocalDensity: "none" | "low" | "medium" | "high"（none=纯音乐无人声，low=歌词少，medium=正常演唱，high=说唱/密集人声）
某首歌不确定时该字段省略。energy 与 vocalDensity 至少给出一个。`;

export interface PrelabelChange {
  trackId: string;
  title: string;
  /** 可读变化（learnEvents 追溯与 UI 反馈） */
  changes: string[];
  /** 校验后的增量值（由服务端合并进曲目） */
  apply: {
    energy?: number;
    moodTags: string[];
    vocalDensity?: Track["vocalDensity"];
  };
}

export interface PrelabelResult {
  /** 成功标注并应用的曲目 id */
  labeled: string[];
  changes: PrelabelChange[];
  /** LLM 没有给出有效输出的曲目数 */
  skipped: number;
}

function clamp01(v: unknown): number | undefined {
  // 数字一律收进 0..1：轻微越界 clamp，明显错误的值（如 5）也会落边界而不是被丢弃
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
}

function moodTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && MOOD_VOCAB.includes(x.trim())).slice(0, 3);
}

function vocalDensity(v: unknown): Track["vocalDensity"] | undefined {
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : undefined;
}

/** 对一批曲目做预标注；返回已校验的增量。LLM 失败/输出为空时返回 null（由上层重试或跳过）。 */
export async function prelabelTracks(
  tracks: Track[],
  config: LlmConfig,
  fetchImpl?: typeof fetch,
): Promise<PrelabelResult | null> {
  if (tracks.length === 0) return { labeled: [], changes: [], skipped: 0 };
  const user = JSON.stringify(
    tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, genres: t.genres ?? [] })),
  );
  const out = await chatJson({
    ...config,
    system: SYSTEM,
    user,
    temperature: 0.2,
    fetchImpl: config.fetchImpl ?? fetchImpl,
  });
  if (out === null || !Array.isArray(out.labels)) return null;

  const byId = new Map(tracks.map((t) => [t.id, t] as const));
  const result: PrelabelResult = { labeled: [], changes: [], skipped: 0 };
  for (const item of out.labels as Array<Record<string, unknown>>) {
    if (typeof item.id !== "string") continue;
    const track = byId.get(item.id);
    if (track === undefined) continue;

    const energy = clamp01(item.energy);
    const tags = moodTags(item.moodTags);
    const vocal = vocalDensity(item.vocalDensity);
    if (energy === undefined && tags.length === 0 && vocal === undefined) {
      continue;
    }

    const changes: string[] = [];
    if (energy !== undefined) changes.push(`能量 → ${energy.toFixed(2)}`);
    if (tags.length > 0) changes.push(`情绪标签 ${tags.join("、")}`);
    if (vocal !== undefined) changes.push(`人声密度 ${vocal}`);
    result.labeled.push(track.id);
    result.changes.push({
      trackId: track.id,
      title: track.title,
      changes,
      apply: { energy, moodTags: tags, vocalDensity: vocal },
    });
  }
  // LLM 完全没给出输出的歌也算 skipped
  result.skipped = tracks.length - result.labeled.length;
  return result;
}
