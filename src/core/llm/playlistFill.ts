import type { StudyContext, Track } from "../types.js";
import { chatJson } from "./deepseek.js";
import type { LlmConfig } from "../../config/env.js";

/**
 * 歌单补位的 LLM 环节（M8「库不够 → 去官方全库找」）。
 *
 * 流程：情境 → 搜索关键词（LLM 生成 2-4 个）→ ncm-cli 搜索得到候选
 * → 本地按「歌名|歌手」去重 → LLM 逐首评估是否符合当前情境
 * → 通过的候选以「网易云补充」身份进入歌单填充预算。
 *
 * 校验纪律与预标注一致：情绪词白名单、energy clamp、vocalDensity 枚举；
 * LLM 任一环节失败返回 null，上层放弃补位（歌单照旧，不阻塞主流程）。
 */

const MOOD_VOCAB = ["focus", "calm", "uplifting", "warm", "dreamy", "soothing", "gentle", "groovy", "bright", "melancholic"];

const KEYWORDS_SYSTEM = `你是学习场景选歌师。根据用户的学习状态描述，生成 2-4 个网易云歌曲搜索关键词，用于找到适合该情境的背景音乐。

要求：
- 每个关键词 2-6 个字/词，偏「听感+曲风」组合，如：安静 钢琴 纯音乐 / 轻电子 专注 / lofi 学习 / 轻柔 民谣
- 覆盖不同角度（曲风、听感、器乐类型），避免只搜一个词
- 不要使用具体歌名或歌手名（那是已有曲库的事，这里是补充曲库外的新歌）
输出 JSON：{"queries": ["...", "..."]}`;

const EVAL_SYSTEM = `你是学习场景音乐审核员。给一段学习状态描述和一批候选歌曲（来自全网搜索），逐首判断"放这首歌是否符合该学习情境"。

判断要点：听感能量是否匹配（疲惫/焦虑要安静，无聊/低落可稍明快）、人声密度（专注难度高时少歌词）、明显不符的（健身/蹦迪/重金属/催眠曲式睡眠白噪音等）坚决拒绝。

输入 JSON：{"context": {...情境}, "candidates": [{"id","title","artist","album","durationSec"}]}
输出 JSON：{"decisions": [{"id","accept","reason","energy","moodTags","vocalDensity"}]}
- id 原样返回
- accept: 布尔
- reason: 一句话中文理由（10-30 字，说明为什么适合/不适合，会被展示给用户）
- energy: 0..1 感知能量（0=极安静，1=高能）；接受时必给
- moodTags: 从 ["focus","calm","uplifting","warm","dreamy","soothing","gentle","groovy","bright","melancholic"] 选 1-3 个；接受时尽量给
- vocalDensity: "none"|"low"|"medium"|"high"；接受时尽量给
不确定的歌宁可拒绝，不要硬凑。`;

function clamp01(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
}

function moodTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && MOOD_VOCAB.includes(x.trim())).slice(0, 3);
}

function vocalDensity(v: unknown): Track["vocalDensity"] | undefined {
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : undefined;
}

/** 情境 → 搜索关键词。LLM 失败时返回兜底关键词组（仍可补位，只是不够聪明）。 */
export async function generateSearchQueries(
  context: StudyContext,
  config: LlmConfig,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const fallback = ["轻音乐 学习", "钢琴 纯音乐 安静", "lofi 专注"];
  const user = JSON.stringify({
    task: context.task ?? "",
    durationMinutes: context.durationMinutes ?? null,
    energy: context.energy ?? null,
    stress: context.stress ?? null,
    focusDifficulty: context.focusDifficulty ?? null,
    moods: context.moods ?? [],
    musicPrefs: context.musicPrefs ?? null,
    rawInput: context.rawInput ?? "",
  });
  try {
    const out = await chatJson({ ...config, system: KEYWORDS_SYSTEM, user, temperature: 0.4, fetchImpl: config.fetchImpl ?? fetchImpl });
    const queries = Array.isArray((out as { queries?: unknown } | null)?.queries)
      ? ((out as { queries: unknown[] }).queries.filter((q): q is string => typeof q === "string" && q.trim() !== ""))
      : [];
    return queries.length > 0 ? queries.slice(0, 4) : fallback;
  } catch {
    return fallback;
  }
}

export interface FillDecision {
  accept: boolean;
  reason: string;
  energy?: number;
  moodTags: string[];
  vocalDensity?: Track["vocalDensity"];
}

export interface FillCandidate {
  /** 候选唯一键（songId 字符串） */
  key: string;
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
}

/** LLM 逐首评估候选是否适合当前情境；失败返回 null（上层放弃补位） */
export async function evaluateFillCandidates(
  context: StudyContext,
  candidates: FillCandidate[],
  config: LlmConfig,
  fetchImpl?: typeof fetch,
): Promise<Map<string, FillDecision> | null> {
  if (candidates.length === 0) return new Map();
  const user = JSON.stringify({
    context: {
      task: context.task ?? "",
      energy: context.energy ?? null,
      stress: context.stress ?? null,
      focusDifficulty: context.focusDifficulty ?? null,
      moods: context.moods ?? [],
      musicPrefs: context.musicPrefs ?? null,
    },
    candidates: candidates.map((c) => ({
      id: c.key,
      title: c.title,
      artist: c.artist,
      album: c.album ?? "",
      durationSec: c.durationSec,
    })),
  });
  const out = await chatJson({
    ...config,
    system: EVAL_SYSTEM,
    user,
    temperature: 0.2,
    fetchImpl: config.fetchImpl ?? fetchImpl,
  });
  if (out === null || !Array.isArray((out as { decisions?: unknown }).decisions)) return null;

  const decisions = new Map<string, FillDecision>();
  for (const item of (out as { decisions: Array<Record<string, unknown>> }).decisions) {
    if (typeof item.id !== "string") continue;
    const accept = item.accept === true;
    const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, 80) : "";
    if (!accept) {
      decisions.set(item.id, { accept: false, reason: reason || "不符合当前学习情境", moodTags: [] });
      continue;
    }
    const energy = clamp01(item.energy);
    const tags = moodTags(item.moodTags);
    const vocal = vocalDensity(item.vocalDensity);
    // 接受的候选必须至少带 energy 或 vocalDensity，否则歌单排序没有依据
    if (energy === undefined && vocal === undefined) continue;
    decisions.set(item.id, {
      accept: true,
      reason: reason || "符合当前学习情境",
      energy,
      moodTags: tags,
      vocalDensity: vocal,
    });
  }
  return decisions;
}
