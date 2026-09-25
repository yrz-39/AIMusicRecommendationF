/**
 * DeepSeek（OpenAI 兼容）客户端。
 *
 * 设计约束：
 * - fetch 注入（测试时 mock），超时保护，任何失败返回 null 由上层走规则版兜底；
 * - 启用 JSON mode（response_format: json_object），解析任务要求输出可校验的 JSON；
 * - 绝不打印或记录 apiKey。
 */

export interface ChatJsonArgs {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function chatJson(args: ChatJsonArgs): Promise<Record<string, unknown> | null> {
  const {
    apiKey,
    baseUrl,
    model,
    system,
    user,
    temperature = 0,
    timeoutMs = 15000,
    fetchImpl = fetch,
  } = args;
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") return null;
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
