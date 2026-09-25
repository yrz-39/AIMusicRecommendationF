import type { StudyContext } from "../types.js";
import type { FeatureDelta } from "../learn/featureLearner.js";
import { parseContext } from "../parser/rulesParser.js";
import { parseSongFeedback } from "../learn/featureLearner.js";
import { parseContextLlm } from "./contextParser.js";
import { parseSongFeedbackLlm } from "./songFeedback.js";
import type { LlmConfig } from "../../config/env.js";

/**
 * 解析调度：配置了 LLM 时优先 LLM，失败/未理解/未配置一律回退规则版。
 *
 * 回退是无感的（记录 parsedBy 供观察），保证外部服务故障不阻塞主流程
 * （PRODUCT 原则：外部服务失败不应让整个产品不可用）。
 */

export type ParsedBy = "llm" | "rules";

export async function parseContextAuto(
  input: string,
  llm: LlmConfig | null,
): Promise<{ context: StudyContext; parsedBy: ParsedBy }> {
  if (llm !== null) {
    const ctx = await parseContextLlm(input, llm);
    if (ctx !== null) return { context: ctx, parsedBy: "llm" };
    console.error("[llm] 情境解析失败，回退规则版");
  }
  return { context: parseContext(input).context, parsedBy: "rules" };
}

export async function parseSongFeedbackAuto(
  text: string,
  llm: LlmConfig | null,
): Promise<{ delta: FeatureDelta; parsedBy: ParsedBy }> {
  if (llm !== null) {
    const delta = await parseSongFeedbackLlm(text, llm);
    if (delta !== null) return { delta, parsedBy: "llm" };
    console.error("[llm] 歌曲特征解析失败，回退规则版");
  }
  return { delta: parseSongFeedback(text), parsedBy: "rules" };
}
