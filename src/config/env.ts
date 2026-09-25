import { existsSync, readFileSync } from "node:fs";

/**
 * 零依赖 .env 加载与 LLM 配置读取。
 *
 * 约定：key 只存在于本地 .env（已被 .gitignore 排除，永不入库）。
 * 已存在的进程环境变量优先于 .env 文件（便于临时覆盖测试）。
 */

export function loadDotEnv(paths: string[]): void {
  for (const p of paths) {
    if (!existsSync(p)) continue;
    let raw: string;
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key !== "" && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export interface LlmConfig {
  apiKey: string;
  /** OpenAI 兼容根地址，默认 DeepSeek */
  baseUrl: string;
  model: string;
  /** 测试注入；生产用全局 fetch */
  fetchImpl?: typeof fetch;
}

/** 读取 LLM 配置；未配置 key 时返回 null（全部功能自动走规则版） */
export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.STUDYMOOD_LLM_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") return null;
  return {
    apiKey,
    baseUrl: (env.STUDYMOOD_LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, ""),
    model: env.STUDYMOOD_LLM_MODEL?.trim() || "deepseek-chat",
  };
}
