import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnv, readLlmConfig } from "../src/config/env.js";
import { chatJson } from "../src/core/llm/deepseek.js";
import { parseContextLlm } from "../src/core/llm/contextParser.js";
import { parseSongFeedbackLlm } from "../src/core/llm/songFeedback.js";
import { parseContextAuto, parseSongFeedbackAuto } from "../src/core/llm/auto.js";
import { prelabelTracks } from "../src/core/llm/prelabel.js";
import { extractPlaylistId, fetchNeteasePlaylist } from "../src/core/import/netease.js";
import { createApp, seedSampleIfFirstRun } from "../src/server/app.js";
import { MemoryStore } from "../src/storage/jsonStore.js";
import type { Track } from "../src/core/types.js";

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

describe("LLM 批量预标注", () => {
  const unlabeled: Track[] = [
    { id: "a", title: "晴天", artist: "周杰伦", durationSec: 269, genres: ["pop"] },
    { id: "b", title: "Numb", artist: "Linkin Park", durationSec: 187, genres: ["rock"] },
  ];

  it("校验并应用标签：energy clamp、情绪白名单、vocalDensity 枚举", async () => {
    const result = await prelabelTracks(
      unlabeled,
      CONFIG,
      mockFetch({
        labels: [
          { id: "a", energy: 0.55, moodTags: ["warm", "epic", "自造词"], vocalDensity: "medium" },
          { id: "b", energy: 5, moodTags: ["uplifting"] }, // energy 越界 → clamp 到 1
        ],
      }),
    );
    expect(result?.labeled).toEqual(["a", "b"]);
    expect(result?.changes[0]?.apply).toEqual({ energy: 0.55, moodTags: ["warm"], vocalDensity: "medium" });
    expect(result?.changes[1]?.apply.energy).toBe(1);
    expect(result?.skipped).toBe(0);
  });

  it("LLM 漏掉的歌记为 skipped，全空输出记 null 触发上层回退", async () => {
    const partial = await prelabelTracks(unlabeled, CONFIG, mockFetch({ labels: [{ id: "a", energy: 0.4 }] }));
    expect(partial?.labeled).toEqual(["a"]);
    expect(partial?.skipped).toBe(1);
    expect(await prelabelTracks(unlabeled, CONFIG, mockFetch({ labels: [] }))).toEqual({
      labeled: [],
      changes: [],
      skipped: 2,
    });
    expect(await prelabelTracks(unlabeled, CONFIG, mockFetch("bad", 500))).toBeNull();
  });

  it("API：预标注写入曲库并留痕 learnEvents；未配置 LLM 返回 400", async () => {
    const store = new MemoryStore();
    await store.saveTracks([
      { id: "a", title: "晴天", artist: "周杰伦", durationSec: 269 },
      { id: "b", title: "已标注", artist: "X", durationSec: 100, energy: 0.5 },
    ]);
    const app = createApp({
      store,
      llm: { ...CONFIG, fetchImpl: mockFetch({ labels: [{ id: "a", energy: 0.45, moodTags: ["warm"] }] }) },
    });
    const res = await app.request("/api/library/prelabel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackIds: ["a", "b"] }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { labeled: string[] };
    expect(data.labeled).toEqual(["a"]);
    const tracks = await store.loadTracks();
    expect(tracks.find((t) => t.id === "a")?.energy).toBe(0.45);
    expect(tracks.find((t) => t.id === "a")?.moodTags).toEqual(["warm"]);
    expect(tracks.find((t) => t.id === "b")?.energy).toBe(0.5); // 已标注的不动
    expect((await store.loadLearnEvents()).filter((e) => e.trackId === "a").length).toBe(1);
    // 未配置 LLM
    const bare = createApp({ store: new MemoryStore() });
    const res2 = await bare.request("/api/library/prelabel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackIds: ["a"] }),
    });
    expect(res2.status).toBe(400);
  });
});

describe("网易云歌单导入", () => {
  const v3Json = JSON.stringify({
    playlist: { name: "我的学习歌单", trackCount: 2, trackIds: [{ id: 111 }, { id: 222 }], tracks: [{ id: 111 }] },
  });
  const songDetailJson = JSON.stringify({
    songs: [
      { id: 111, name: "晴天", duration: 269000, artists: [{ name: "周杰伦" }], album: { name: "叶惠美" } },
      { id: 222, name: "Numb", duration: 187000, artists: [{ name: "Linkin Park" }] },
    ],
  });
  const mockNetease = (async (url: RequestInfo | URL) => {
    const u = String(url);
    return new Response(u.includes("/v3/") ? v3Json : u.includes("song/detail") ? songDetailJson : "{}", { status: 200 });
  }) as typeof fetch;

  it("extractPlaylistId 支持长链、短链文本、纯 id", () => {
    expect(extractPlaylistId("https://music.163.com/playlist?id=3778678&userid=1")).toBe("3778678");
    expect(extractPlaylistId("【歌单】xxx：https://163cn.tv/abc/share  复制此链接")).toBeNull(); // 短链交给 fetch 跳转
    expect(extractPlaylistId("3778678")).toBe("3778678");
    expect(extractPlaylistId("随便说的话")).toBeNull();
  });

  it("抓取并映射曲目（v3 全量 id + song/detail 批量详情）", async () => {
    const playlist = await fetchNeteasePlaylist("https://music.163.com/playlist?id=42", { fetchImpl: mockNetease });
    expect(playlist.name).toBe("我的学习歌单");
    expect(playlist.tracks).toHaveLength(2);
    expect(playlist.tracks[0]).toMatchObject({
      id: "ne-111",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      durationSec: 269,
    });
    expect(playlist.tracks[1]?.artist).toBe("Linkin Park");
  });

  it("配置 cookie 时请求头带 MUSIC_U", async () => {
    let captured: string | undefined;
    const mock = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = (init?.headers as Record<string, string>)?.Cookie;
      return new Response(String(url).includes("/v3/") ? v3Json : songDetailJson, { status: 200 });
    }) as typeof fetch;
    await fetchNeteasePlaylist("3778678", { cookie: "abc123", fetchImpl: mock });
    expect(captured).toBe("MUSIC_U=abc123");
  });

  it("API：无效链接/空输入返回明确错误（不访问外网）", async () => {
    const store = new MemoryStore();
    await seedSampleIfFirstRun(store);
    const app = createApp({ store });

    const bad = await app.request("/api/library/import-netease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "不是链接" }),
    });
    expect(bad.status).toBe(502);
    expect(((await bad.json()) as { error: string }).error).toContain("无法识别歌单链接");

    const empty = await app.request("/api/library/import-netease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
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
