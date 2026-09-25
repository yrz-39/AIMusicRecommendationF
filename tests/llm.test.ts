import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnv, readLlmConfig } from "../src/config/env.js";
import { chatJson } from "../src/core/llm/deepseek.js";
import { parseContextLlm } from "../src/core/llm/contextParser.js";
import { parseSongFeedbackLlm } from "../src/core/llm/songFeedback.js";
import { parseContextAuto, parseSongFeedbackAuto } from "../src/core/llm/auto.js";
import { createApp, seedSampleIfFirstRun } from "../src/server/app.js";
import { MemoryStore } from "../src/storage/jsonStore.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function mockFetch(content: unknown, status = 200): typeof fetch {
  return (async (): Promise<Response> => {
    if (status !== 200) return new Response("err", { status });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
}

const CONFIG = { apiKey: "test-key", baseUrl: "https://api.example.com", model: "test-model" };

describe(".env 加载", () => {
  it("读取键值对，跳过注释，不覆盖已有环境变量", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studymood-env-"));
    dirs.push(dir);
    const file = path.join(dir, ".env");
    await writeFile(file, '# 注释\nA=1\n\nB = "quoted value"\nC=existing', "utf8");
    process.env.C = "preset";
    loadDotEnv([file]);
    expect(process.env.A).toBe("1");
    expect(process.env.B).toBe("quoted value");
    expect(process.env.C).toBe("preset");
    delete process.env.A;
    delete process.env.B;
    delete process.env.C;
  });

  it("readLlmConfig：无 key 返回 null，有 key 补默认值", () => {
    expect(readLlmConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(readLlmConfig({ STUDYMOOD_LLM_API_KEY: "  " } as NodeJS.ProcessEnv)).toBeNull();
    const cfg = readLlmConfig({ STUDYMOOD_LLM_API_KEY: "sk-x" } as NodeJS.ProcessEnv);
    expect(cfg?.apiKey).toBe("sk-x");
    expect(cfg?.baseUrl).toBe("https://api.deepseek.com");
    expect(cfg?.model).toBe("deepseek-chat");
  });
});

describe("chatJson", () => {
  it("解析 choices 里的 JSON 内容", async () => {
    const out = await chatJson({ ...CONFIG, system: "s", user: "u", fetchImpl: mockFetch({ ok: 1 }) });
    expect(out).toEqual({ ok: 1 });
  });

  it("HTTP 错误 / 非 JSON 内容 / 网络异常 → null", async () => {
    expect(await chatJson({ ...CONFIG, system: "s", user: "u", fetchImpl: mockFetch("x", 500) })).toBeNull();
    expect(await chatJson({ ...CONFIG, system: "s", user: "u", fetchImpl: mockFetch("不是json") })).toBeNull();
    const boom = (async (): Promise<Response> => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await chatJson({ ...CONFIG, system: "s", user: "u", fetchImpl: boom })).toBeNull();
  });
});

describe("LLM 情境解析", () => {
  it("合法输出映射为 StudyContext 并保留证据", async () => {
    const ctx = await parseContextLlm(
      "写代码两小时有点累",
      CONFIG,
      mockFetch({
        task: "写代码",
        durationMinutes: 120,
        energy: "medium",
        focusDifficulty: "high",
        musicPrefs: { calmness: "calm", vocalPreference: "few-lyrics" },
        evidence: ["写代码", "有点累"],
        missing: ["压力水平"],
        confidence: 0.88,
      }),
    );
    expect(ctx?.task).toBe("写代码");
    expect(ctx?.durationMinutes).toBe(120);
    expect(ctx?.parserMeta.parser).toBe("llm");
    expect(ctx?.parserMeta.matched).toEqual(["写代码", "有点累"]);
    expect(ctx?.parserMeta.unknowns).toEqual(["压力水平"]);
  });

  it("非法字段被丢弃，空信息返回 null（触发回退）", async () => {
    const ctx = await parseContextLlm("x", CONFIG, mockFetch({ energy: "超强", task: "  " }));
    expect(ctx?.energy).toBeUndefined();
    expect(ctx?.task).toBeUndefined();
    expect(await parseContextLlm("x", CONFIG, mockFetch({ confidence: 0.9 }))).toBeNull();
  });

  it("parseContextAuto：LLM 失败回退规则版；未配置直接规则版", async () => {
    const failed = await parseContextAuto("写代码两小时", { ...CONFIG, fetchImpl: mockFetch("bad", 500) });
    expect(failed.parsedBy).toBe("rules");
    expect(failed.context.parserMeta.parser).toBe("rules");
    const ok = await parseContextAuto("任意", { ...CONFIG, fetchImpl: mockFetch({ task: "复习" }) });
    expect(ok.parsedBy).toBe("llm");
    const none = await parseContextAuto("写代码两小时", null);
    expect(none.parsedBy).toBe("rules");
  });
});

describe("LLM 歌曲特征解析", () => {
  it("合法输出映射为 FeatureDelta", async () => {
    const delta = await parseSongFeedbackLlm(
      "这首歌给我力气",
      CONFIG,
      mockFetch({ energyHint: "high", moodTags: ["uplifting", "bright"], matched: ["给我力气"], understood: true }),
    );
    expect(delta?.energyHint).toBe("high");
    expect(delta?.moodTags).toEqual(["uplifting", "bright"]);
    expect(delta?.understood).toBe(true);
  });

  it("moodTags 白名单过滤，LLM 自造的标签被丢弃", async () => {
    const delta = await parseSongFeedbackLlm(
      "x",
      CONFIG,
      mockFetch({ energyHint: "low", moodTags: ["calm", "epic", "仙气飘飘"] }),
    );
    expect(delta?.moodTags).toEqual(["calm"]);
  });

  it("未解析出任何特征 → null（上层回退规则版）", async () => {
    expect(await parseSongFeedbackLlm("x", CONFIG, mockFetch({ understood: false }))).toBeNull();
    const auto = await parseSongFeedbackAuto("x", { ...CONFIG, fetchImpl: mockFetch({ understood: false }) });
    expect(auto.parsedBy).toBe("rules");
  });
});

describe("API 层 LLM 接入", () => {
  it("配置 LLM 时推荐带 parsedBy=llm", async () => {
    const store = new MemoryStore();
    const app = createApp({
      store,
      llm: { ...CONFIG, fetchImpl: mockFetch({ task: "写代码", energy: "medium" }) },
    });
    await seedSampleIfFirstRun(store);
    const res = await app.request("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "写代码" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { parsedBy: string; context: { parserMeta: { parser: string } } };
    expect(data.parsedBy).toBe("llm");
    expect(data.context.parserMeta.parser).toBe("llm");
  });

  it("未配置 LLM 时 parsedBy=rules（现有行为不变）", async () => {
    const store = new MemoryStore();
    const app = createApp({ store });
    await seedSampleIfFirstRun(store);
    const res = await app.request("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "写代码" }),
    });
    const data = (await res.json()) as { parsedBy: string };
    expect(data.parsedBy).toBe("rules");
  });
});
