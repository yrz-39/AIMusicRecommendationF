import type { MusicPrefs, StudyContext } from "../types.js";
import { chatJson } from "./deepseek.js";
import type { LlmConfig } from "../../config/env.js";

/**
 * LLM 情境解析：自然语言 → StudyContext（与 rulesParser 同一契约）。
 *
 * 原则与规则版一致：只输出真正读到的信息，缺失项放 unknowns，绝不编造。
 * 输出经代码逐字段校验，任何非法值都触发上层回退规则版。
 */

const SYSTEM = `你是学习情境解析器。从用户的一句话中提取结构化信息，输出 JSON 对象（不要输出任何其他文字）。

可提取字段（只输出真正读到的，没提到的一律省略，绝不编造）：
- task: 学习/工作任务的短语描述（如 "写代码"、"复习"）
- durationMinutes: 数字，学习时长（分钟）
- energy: "low" | "medium" | "high"（当前精力）
- stress: "low" | "medium" | "high"（压力水平）
- focusDifficulty: "low" | "medium" | "high"（专注难度，越 high 越容易走神）
- moods: 字符串数组，情绪（如 ["tired","anxious","calm","motivated","bored"]）
- musicPrefs: 对象，可含：
  - calmness: "calm" | "balanced" | "energetic"（想听安静/适中/提神）
  - vocalPreference: "instrumental" | "few-lyrics" | "any"（纯音乐/歌词少/无所谓）
  - genres: 字符串数组（用户点名的流派，用英文小写如 ["lofi","classical","pop"]）
  - languages: 字符串数组（zh/en/ja/ko）
- evidence: 字符串数组，每个结论对应的用户原话片段
- missing: 字符串数组，用户没提到的方面（中文名词，如 "压力水平"）
- confidence: 0..1 数字，解析置信度

示例输出：
{"task":"写代码","durationMinutes":120,"energy":"medium","focusDifficulty":"high","musicPrefs":{"calmness":"calm","vocalPreference":"few-lyrics"},"evidence":["写代码","两个小时","有点累","容易走神","想听安静一点"],"missing":["压力水平"],"confidence":0.9}`;

const LEVELS = new Set(["low", "medium", "high"]);

function level(v: unknown): "low" | "medium" | "high" | undefined {
  return typeof v === "string" && LEVELS.has(v) ? (v as "low" | "medium" | "high") : undefined;
}

function stringArray(v: unknown, max = 8): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().toLowerCase());
  return out.length > 0 ? out.slice(0, max) : undefined;
}

function prefs(v: unknown): MusicPrefs | undefined {
  if (v === null || typeof v !== "object") return undefined;
  const p = v as Record<string, unknown>;
  const out: MusicPrefs = {};
  if (p.calmness === "calm" || p.calmness === "balanced" || p.calmness === "energetic") {
    out.calmness = p.calmness;
  }
  if (p.vocalPreference === "instrumental" || p.vocalPreference === "few-lyrics" || p.vocalPreference === "any") {
    out.vocalPreference = p.vocalPreference;
  }
  const genres = stringArray(p.genres);
  if (genres !== undefined) out.genres = genres;
  const languages = stringArray(p.languages, 3);
  if (languages !== undefined) out.languages = languages;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** LLM 解析情境。失败/输出不合法返回 null（上层回退规则版）。 */
export async function parseContextLlm(
  input: string,
  config: LlmConfig,
  fetchImpl?: typeof fetch,
): Promise<StudyContext | null> {
  const out = await chatJson({ ...config, system: SYSTEM, user: input, fetchImpl: config.fetchImpl ?? fetchImpl });
  if (out === null) return null;

  const ctx: StudyContext = { rawInput: input, parserMeta: { parser: "llm", confidence: 0.9, matched: [], unknowns: [] } };
  if (typeof out.task === "string" && out.task.trim() !== "") {
    ctx.task = out.task.trim().slice(0, 50);
  }
  if (typeof out.durationMinutes === "number" && Number.isFinite(out.durationMinutes)) {
    ctx.durationMinutes = Math.min(720, Math.max(5, Math.round(out.durationMinutes)));
  }
  const energy = level(out.energy);
  if (energy !== undefined) ctx.energy = energy;
  const stress = level(out.stress);
  if (stress !== undefined) ctx.stress = stress;
  const focusDifficulty = level(out.focusDifficulty);
  if (focusDifficulty !== undefined) ctx.focusDifficulty = focusDifficulty;
  const moods = stringArray(out.moods, 4);
  if (moods !== undefined) ctx.moods = moods;
  const mp = prefs(out.musicPrefs);
  if (mp !== undefined) ctx.musicPrefs = mp;

  if (Array.isArray(out.evidence)) {
    ctx.parserMeta.matched = out.evidence
      .filter((x): x is string => typeof x === "string" && x.trim() !== "")
      .slice(0, 8);
  }
  if (Array.isArray(out.missing)) {
    ctx.parserMeta.unknowns = out.missing
      .filter((x): x is string => typeof x === "string" && x.trim() !== "")
      .slice(0, 8);
  }
  if (typeof out.confidence === "number" && Number.isFinite(out.confidence)) {
    ctx.parserMeta.confidence = Math.min(1, Math.max(0, out.confidence));
  }

  // 至少读到一点信息才算理解（只有 confidence 的输出视为失败）
  const hasContent =
    ctx.task !== undefined ||
    ctx.durationMinutes !== undefined ||
    ctx.energy !== undefined ||
    ctx.stress !== undefined ||
    ctx.focusDifficulty !== undefined ||
    ctx.moods !== undefined ||
    ctx.musicPrefs !== undefined;
  return hasContent ? ctx : null;
}
