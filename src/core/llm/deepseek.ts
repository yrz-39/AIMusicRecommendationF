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

export interface LlmTestResult {
  ok: boolean;
  /** 失败时的可读原因（绝不包含 apiKey） */
  error?: string;
}

/** 设置页「测试连接」：发一个 max_tokens=1 的最小请求，验证 key/baseUrl/model 是否可用 */
export async function testLlmConnection(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LlmTestResult> {
  const { apiKey, baseUrl, model, timeoutMs = 12000, fetchImpl = fetch } = args;
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true };
    const status = res.status;
    // 4xx 通常是 key 无效或模型名错误；读响应体里的 message 帮助定位（服务端报错不含 key）
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string }; message?: string };
      detail = body.error?.message ?? body.message ?? "";
    } catch {
      /* 响应体不是 JSON 就只报状态码 */
    }
    const hint =
      status === 401 || status === 403
        ? "API key 无效或没有权限"
        : status === 404
          ? "接口地址或模型名不对（404）"
          : status === 429
            ? "调用频率/额度受限（429）"
            : `服务返回 ${status}`;
    return { ok: false, error: detail !== "" ? `${hint}：${detail}` : hint };
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "连接超时" : String((err as Error).message ?? err);
    return { ok: false, error: `无法连接到 ${baseUrl}：${msg}` };
  }
}
