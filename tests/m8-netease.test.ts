import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { MemoryStore } from "../src/storage/jsonStore.js";
import {
  createNcmClient,
  extractSongArray,
  parseJsonOutput,
  parseNcmSong,
  type NcmClient,
  type NcmRunResult,
  type NcmRunner,
  type NcmSong,
} from "../src/core/netease/ncmCli.js";
import { generateSearchQueries, evaluateFillCandidates } from "../src/core/llm/playlistFill.js";
import type { LlmConfig } from "../src/config/env.js";
import type { StudyContext } from "../src/core/types.js";

/** noUncheckedIndexedAccess 下取末位（测试断言用，空数组直接抛错） */
function last<T>(arr: T[]): T {
  const v = arr.at(-1);
  if (v === undefined) throw new Error("数组为空");
  return v;
}

/**
 * M8 网易云联动回归：ncm-cli 适配层解析、播放/遥控端点、歌单全库补位（LLM 评估）。
 * ncm-cli 未登录也能跑的测试用 fake runner / stub client，不真正起子进程。
 */

const CONFIG: LlmConfig = { apiKey: "test-key", baseUrl: "https://api.example.com", model: "test-model" };

describe("ncm-cli 适配层：解析", () => {
  it("parseNcmSong：artists 数组 / ar 对象 / 缺字段拒绝", () => {
    const full = parseNcmSong({
      encryptedId: "330AC3639A5C32EE474A474D64654431",
      originalId: 123,
      name: "晴天",
      artists: [{ name: "周杰伦" }],
      album: { name: "叶惠美" },
      duration: 269000,
    });
    expect(full).toEqual({
      encryptedId: "330AC3639A5C32EE474A474D64654431",
      originalId: "123",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      durationSec: 269,
    });

    const arForm = parseNcmSong({ encryptedId: "AB", originalId: 1, name: "X", ar: { name: "歌手A" }, dt: 100000 });
    expect(arForm).toMatchObject({ artist: "歌手A", durationSec: 100 });

    expect(parseNcmSong({ name: "没有ID" })).toBeNull();
    expect(parseNcmSong({ encryptedId: "AB", name: "没有原始ID" })).toBeNull();
  });

  it("extractSongArray：result.songs / root 数组 / data / 空兜底", () => {
    expect(extractSongArray({ result: { songs: [{ a: 1 }] } })).toHaveLength(1);
    expect(extractSongArray([{ a: 1 }, { b: 2 }])).toHaveLength(2);
    expect(extractSongArray({ songs: [{ a: 1 }] })).toHaveLength(1);
    expect(extractSongArray({ code: 301 })).toHaveLength(0);
    expect(extractSongArray(null)).toHaveLength(0);
  });

  it("0.1.7 真实输出：data.records + id 为 32 位 HEX 加密 ID + playFlag 过滤", () => {
    const real = {
      code: 200,
      subCode: null,
      message: null,
      data: {
        recordCount: 247,
        records: [
          {
            originalId: 3440441479,
            id: "0E5C5C80289D95205284FBB40550D7F7",
            name: "晴天",
            duration: 112373,
            playFlag: true,
            noCopyrightRcmd: null,
            artists: [{ originalId: 122200643, id: "BA438474200324296E8FD5AA488B53F4", name: "Jay" }],
            album: { originalId: 400164559, id: "D1F3F8492A82CFC9FED353E91F6673AD", name: "晴天" },
          },
          {
            originalId: 999,
            id: "AAAABBBBCCCCDDDD1111222233334444",
            name: "无版权歌",
            duration: 100000,
            playFlag: true,
            noCopyrightRcmd: { type: 1 },
            artists: [{ name: "X" }],
          },
          { originalId: 998, id: "AAAABBBBCCCCDDDD1111222233334445", name: "不可播放", duration: 100000, playFlag: false, artists: [{ name: "X" }] },
        ],
      },
    };
    const songs = extractSongArray(real).map(parseNcmSong).filter((x): x is NcmSong => x !== null);
    expect(songs).toHaveLength(1); // 无版权与不可播放的都被过滤
    expect(songs[0]).toMatchObject({ encryptedId: "0E5C5C80289D95205284FBB40550D7F7", originalId: "3440441479", title: "晴天", artist: "Jay", durationSec: 112 });
  });

  it("parseJsonOutput：容忍噪音前后缀", () => {
    expect(parseJsonOutput('前缀日志\n{"a":1}\n后缀')).toEqual({ a: 1 });
    expect(parseJsonOutput("不是 JSON")).toBeNull();
  });

  it("客户端命令组参与结果解析（fake runner 捕获调用）", async () => {
    const calls: string[][] = [];
    const runner: NcmRunner = async (args) => {
      calls.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "0.1.7", stderr: "" };
      if (args[0] === "config" && args[1] === "list") {
        return { code: 0, stdout: "appId: my-app (凭证文件)\nprivateKey: te*** (凭证文件)\nplayer: (未配置)", stderr: "" };
      }
      if (args[0] === "search") {
        return {
          code: 0,
          stdout: JSON.stringify({
            result: {
              songs: [
                {
                  encryptedId: "ENC1",
                  originalId: 111,
                  name: "晴天",
                  artists: [{ name: "周杰伦" }],
                  duration: 269000,
                },
              ],
            },
          }),
          stderr: "",
        };
      }
      if (args[0] === "state") return { code: 0, stdout: JSON.stringify({ state: { status: "playing" } }), stderr: "" };
      return { code: 0, stdout: JSON.stringify({ success: true }), stderr: "" };
    };
    const client = createNcmClient(runner);

    expect(await client.version()).toBe("0.1.7");
    expect(await client.configStatus()).toEqual({ appIdSet: true, player: null });

    const songs = await client.searchSong("周杰伦 晴天", 5);
    expect(last(calls)).toEqual(["search", "song", "--keyword", "周杰伦 晴天"]);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ encryptedId: "ENC1", originalId: "111", title: "晴天" });

    await client.playSong({ encryptedId: "E", originalId: "1", title: "t", artist: "a" });
    expect(last(calls)).toEqual(["play", "--song", "--player", "mpv", "--encrypted-id", "E", "--original-id", "1"]);

    await client.queueAdd({ encryptedId: "E", originalId: "2", title: "t", artist: "a" }, { next: true });
    expect(last(calls)).toEqual(["queue", "add", "--player", "mpv", "--encrypted-id", "E", "--original-id", "2", "--next"]);

    await client.queueClear();
    expect(last(calls)).toEqual(["queue", "clear"]);

    await client.control("next");
    expect(last(calls)).toEqual(["next"]);

    const st = await client.state();
    expect(st.playing).toBe(true);
    expect(st.status).toBe("playing");

    // 命令失败 → 抛错给上层降级
    const bad = createNcmClient(async () => ({ code: 1, stdout: "", stderr: "boom" }) as NcmRunResult);
    await expect(bad.playSong({ encryptedId: "E", originalId: "1", title: "t", artist: "a" })).rejects.toThrow("boom");

    // CLI 业务失败（如未登录）exit 0 但 success:false → 同样抛错
    const unauth = createNcmClient(async () => ({
      code: 0,
      stdout: JSON.stringify({ success: false, message: "未登录，请执行 ncm-cli login 完成登录" }),
      stderr: "",
    }));
    await expect(unauth.searchSong("x")).rejects.toThrow("未登录");
  });

  it("config list 未配置时 appIdSet=false（不把『(未配置)』当值）", async () => {
    const runner: NcmRunner = async (args) =>
      args[0] === "config"
        ? { code: 0, stdout: "appId: (未配置)\nprivateKey: (未配置)\nplayer: (未配置)", stderr: "" }
        : { code: 0, stdout: "{}", stderr: "" };
    expect(await createNcmClient(runner).configStatus()).toEqual({ appIdSet: false, player: null });
  });
});

describe("ncm-cli 适配层：playlistFill LLM 环节", () => {
  const context: StudyContext = {
    task: "复习",
    durationMinutes: 30,
    moods: ["anxious"],
    rawInput: "明天考试很焦虑，复习半小时",
    parserMeta: { parser: "rules", confidence: 0.5, matched: [], unknowns: [] },
  };

  it("generateSearchQueries：LLM 输出 queries，失败回落兜底词", async () => {
    const ok = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const system = body.messages[0]?.content ?? "";
      const payload = system.includes("选歌师") ? { queries: ["轻音乐", "钢琴 纯音乐"] } : { x: 1 };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
    };
    expect(await generateSearchQueries(context, CONFIG, ok)).toEqual(["轻音乐", "钢琴 纯音乐"]);
    const fail = (async () => new Response("err", { status: 500 })) as typeof fetch;
    expect(await generateSearchQueries(context, CONFIG, fail)).toHaveLength(3); // fallback
  });

  it("evaluateFillCandidates：接受带特征，拒绝给理由；输出非法返回 null", async () => {
    const candidates = [
      { key: "1", title: "安静钢琴曲", artist: "A", durationSec: 200 },
      { key: "2", title: "蹦迪神曲", artist: "B", durationSec: 180 },
    ];
    const ok = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void init;
      const payload = {
        decisions: [
          { id: "1", accept: true, reason: "安静钢琴适合静心", energy: 0.2, moodTags: ["calm"], vocalDensity: "none" },
          { id: "2", accept: false, reason: "太吵了" },
          { id: "3", accept: true }, // 无特征的接受无效，丢弃
        ],
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
    };
    const decisions = await evaluateFillCandidates(context, candidates, CONFIG, ok);
    expect(decisions).not.toBeNull();
    expect(decisions?.get("1")).toMatchObject({ accept: true, energy: 0.2, vocalDensity: "none" });
    expect(decisions?.get("2")).toMatchObject({ accept: false });
    expect(decisions?.has("3")).toBe(false);

    const bad = (async () => new Response("err", { status: 500 })) as typeof fetch;
    expect(await evaluateFillCandidates(context, candidates, CONFIG, bad)).toBeNull();
  });
});

/** stub ncm client：记录调用，行为可配 */
function stubNcm(overrides: Partial<NcmClient> = {}): NcmClient & { calls: string[][] } {
  const calls: string[][] = [];
  const base: NcmClient = {
    version: async () => "0.1.7",
    configStatus: async () => ({ appIdSet: true, player: "netease-client" }),
    setCredentials: async (appId, privateKey) => void calls.push(["setCredentials", appId, privateKey]),
    loginCheck: async () => ({ loggedIn: true, message: "已登录" }),
    searchSong: async (keyword) => {
      calls.push(["search", keyword]);
      return [
        { encryptedId: "ENC_A", originalId: "101", title: "晴天", artist: "周杰伦", durationSec: 269 },
        { encryptedId: "ENC_B", originalId: "102", title: "晴空", artist: "某人", durationSec: 200 },
      ];
    },
    playSong: async (s) => void calls.push(["play", s.originalId]),
    queueAdd: async (s) => void calls.push(["queueAdd", s.originalId]),
    queueClear: async () => void calls.push(["queueClear"]),
    control: async (a) => void calls.push(["control", a]),
    state: async () => ({ status: "playing", playing: true, raw: null }),
  };
  const merged = { ...base, ...overrides } as NcmClient & { calls: string[][] };
  merged.calls = calls;
  return merged;
}

describe("API：网易云播放与遥控", () => {
  it("queue-start：清队列并播放（凭已有 ID 不再搜索）", async () => {
    const ncm = stubNcm();
    const app = createApp({ store: new MemoryStore(), ncm });
    const res = await app.request("/api/netease/queue-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "晴天", artist: "周杰伦", netease: { encryptedId: "ENC_A", originalId: "101" } }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; status: string; matchedTitle: string };
    expect(data.ok).toBe(true);
    expect(data.status).toBe("playing");
    expect(data.matchedTitle).toBe("晴天");
    expect(ncm.calls).toEqual([["queueClear"], ["play", "101"]]);
  });

  it("queue-add：无 ID 时搜索并按歌名歌手匹配", async () => {
    const ncm = stubNcm();
    const app = createApp({ store: new MemoryStore(), ncm });
    const res = await app.request("/api/netease/queue-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "晴天", artist: "周杰伦" }),
    });
    const data = (await res.json()) as { ok: boolean; matchedTitle: string };
    expect(data.ok).toBe(true);
    expect(data.matchedTitle).toBe("晴天");
    expect(ncm.calls[0]?.[0]).toBe("search");
    expect(last(ncm.calls)).toEqual(["queueAdd", "101"]);
  });

  it("搜索结果都不像时宁可拒绝（502）", async () => {
    const ncm = stubNcm({ searchSong: async () => [{ encryptedId: "E", originalId: "9", title: "完全无关的歌", artist: "别人" }] });
    const app = createApp({ store: new MemoryStore(), ncm });
    const res = await app.request("/api/netease/queue-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "晴天", artist: "周杰伦" }),
    });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("可靠匹配");
  });

  it("control 校验 action 并透传；state 透传；ncm 缺失返回 400", async () => {
    const ncm = stubNcm();
    const app = createApp({ store: new MemoryStore(), ncm });
    const ok = await app.request("/api/netease/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true);
    expect(last(ncm.calls)).toEqual(["control", "pause"]);

    const bad = await app.request("/api/netease/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hack" }),
    });
    expect(bad.status).toBe(400);

    const st = await app.request("/api/netease/state");
    expect(((await st.json()) as { playing: boolean }).playing).toBe(true);

    const bare = createApp({ store: new MemoryStore() });
    const noNcm = await bare.request("/api/netease/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    expect(noNcm.status).toBe(400);
  });

  it("now-playing/current：桌面无信号时回落 ncm 播放器状态并匹配曲库", async () => {
    const store = new MemoryStore();
    await store.saveTracks([{ id: "a", title: "晴天", artist: "Jay", durationSec: 269, energy: 0.5 }]);
    const ncm = stubNcm({
      state: async () => ({
        status: "playing",
        playing: true,
        raw: { state: { status: "playing", title: "晴天 - Jay", queueLength: 3, position: 1, duration: 100 } },
      }),
    });
    const app = createApp({ store, ncm, detectPlaying: async () => ({ playing: false }) });
    const res = await app.request("/api/now-playing/current");
    const data = (await res.json()) as {
      playing: boolean;
      source: string;
      title: string;
      artist: string;
      ncmQueue: { queueLength: number };
      track: { id: string } | null;
    };
    expect(data.playing).toBe(true);
    expect(data.source).toBe("ncm");
    expect(data.title).toBe("晴天");
    expect(data.artist).toBe("Jay");
    expect(data.ncmQueue).toEqual({ queueLength: 3 });
    expect(data.track?.id).toBe("a"); // 标题/歌手解析后与曲库匹配上
  });

  it("now-playing/current：ncm 暂停但队列非空 → 保持可见（playing=false + 队列信息）", async () => {
    const ncm = stubNcm({
      state: async () => ({
        status: "stopped",
        playing: false,
        raw: { state: { status: "stopped", title: "晴天 - Jay", queueLength: 2, position: 0, duration: 100 } },
      }),
    });
    const app = createApp({ store: new MemoryStore(), ncm, detectPlaying: async () => ({ playing: false }) });
    const data = (await (await app.request("/api/now-playing/current")).json()) as {
      playing: boolean;
      source: string;
      ncmQueue?: { queueLength: number };
    };
    expect(data.playing).toBe(false);
    expect(data.source).toBe("ncm");
    expect(data.ncmQueue?.queueLength).toBe(2);
  });

  it("settings 含 ncm 段；PUT ncm 凭证转写 setCredentials；test-ncm 汇总三查", async () => {
    const ncm = stubNcm();
    const app = createApp({ store: new MemoryStore(), ncm });
    const get = await app.request("/api/settings");
    const snapshot = (await get.json()) as { ncm: { available: boolean; appIdSet: boolean; player: string | null } };
    expect(snapshot.ncm).toEqual({ available: true, appIdSet: true, player: "netease-client" });

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ncm: { appId: "my-app", privateKey: "pk" } }),
    });
    expect(put.status).toBe(200);
    expect(last(ncm.calls)).toEqual(["setCredentials", "my-app", "pk"]);

    const test = await app.request("/api/settings/test-ncm", { method: "POST" });
    const testData = (await test.json()) as { ok: boolean; version: string };
    expect(testData.ok).toBe(true);
    expect(testData.version).toBe("0.1.7");
  });

  it("test-ncm：凭证缺失/未登录给出可读原因", async () => {
    const notConfigured = stubNcm({ configStatus: async () => ({ appIdSet: false, player: null }) });
    const app1 = createApp({ store: new MemoryStore(), ncm: notConfigured });
    const r1 = await app1.request("/api/settings/test-ncm", { method: "POST" });
    expect(((await r1.json()) as { ok: boolean; error: string }).error).toContain("凭证未配置");

    const notLoggedIn = stubNcm({ loginCheck: async () => ({ loggedIn: false, message: "未登录" }) });
    const app2 = createApp({ store: new MemoryStore(), ncm: notLoggedIn });
    const r2 = await app2.request("/api/settings/test-ncm", { method: "POST" });
    const d2 = (await r2.json()) as { ok: boolean; appIdSet: boolean };
    expect(d2.ok).toBe(false);
    expect(d2.appIdSet).toBe(true);
  });
});

describe("API：未入库补位曲目的反馈", () => {
  it("nes- 前缀曲目未入库也可记录反馈；普通未知 id 仍 404", async () => {
    const store = new MemoryStore();
    const app = createApp({ store });
    const ok = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "nes-901", type: "like" }),
    });
    expect(ok.status).toBe(200);
    const events = await store.loadFeedback();
    expect(events[0]?.trackId).toBe("nes-901");

    const bad = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "no-such", type: "like" }),
    });
    expect(bad.status).toBe(404);
  });
});

describe("API：歌单全库补位（LLM 评估）", () => {
  const searchSongs: NcmSong[] = [
    { encryptedId: "ENC_DUP", originalId: "900", title: "库内同款", artist: "已有歌手", durationSec: 240 },
    { encryptedId: "ENC_NEW1", originalId: "901", title: "安静练习曲", artist: "补位歌手A", durationSec: 200 },
    { encryptedId: "ENC_NEW2", originalId: "902", title: "轻柔白噪音", artist: "补位歌手B", durationSec: 260 },
  ];

  /** LLM mock：情境解析故意失败（走规则版），选歌师/审核员分别应答 */
  const llmFetch = (async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const system = body.messages[0]?.content ?? "";
    const payload =
      system.includes("选歌师")
        ? { queries: ["安静 钢琴", "白噪音"] }
        : system.includes("审核员")
          ? {
              decisions: [
                { id: "901", accept: true, reason: "安静钢琴适合焦虑时复习", energy: 0.2, moodTags: ["calm"], vocalDensity: "none" },
                { id: "902", accept: false, reason: "白噪音偏睡眠场景" },
              ],
            }
          : null;
    if (payload === null) return new Response("err", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
  }) as typeof fetch;

  it("曲库填不满时：搜索 → 去重 → LLM 评估 → 补进歌单（不写库）", async () => {
    const store = new MemoryStore();
    await store.saveTracks([
      { id: "a", title: "短歌一", artist: "甲", durationSec: 60, energy: 0.3 },
      { id: "b", title: "短歌二", artist: "乙", durationSec: 60, energy: 0.3 },
      { id: "c", title: "库内同款", artist: "已有歌手", durationSec: 240, energy: 0.3 },
    ]);
    const ncm = stubNcm({ searchSong: async () => searchSongs });
    const app = createApp({ store, llm: { ...CONFIG, fetchImpl: llmFetch }, ncm });
    const res = await app.request("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "复习 10 分钟" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      playlist: { tracks: Array<{ track: { id: string } }>; totalSec: number };
      supplements: { attempted: boolean; added: number; note: string | null };
      supplementIds: string[];
    };
    expect(data.supplements.attempted).toBe(true);
    expect(data.supplements.added).toBe(1); // 901 接受；900 曲库已有；902 被拒
    expect(data.supplementIds ?? []).toEqual(["nes-901"]);
    expect(data.playlist.tracks.some((t) => t.track.id === "nes-901")).toBe(true);
    expect(data.playlist.tracks.some((t) => t.track.id === "nes-902")).toBe(false);
    // 补位不写曲库
    expect((await store.loadTracks()).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("LLM 或 ncm 缺失时不触发补位，歌单行为与旧版一致", async () => {
    const store = new MemoryStore();
    await store.saveTracks([{ id: "a", title: "短歌一", artist: "甲", durationSec: 60, energy: 0.3 }]);
    const ncm = stubNcm();

    const emptyStore = new MemoryStore();
    await emptyStore.saveTracks([{ id: "a", title: "短歌一", artist: "甲", durationSec: 60, energy: 0.3 }]);
    const noLlm = createApp({ store: emptyStore, ncm });
    const r1 = await noLlm.request("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "复习 10 分钟" }),
    });
    const d1 = (await r1.json()) as { supplements: { attempted: boolean } };
    expect(d1.supplements.attempted).toBe(false);

    const noNcm = createApp({ store, llm: { ...CONFIG, fetchImpl: llmFetch } });
    const r2 = await noNcm.request("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "复习 10 分钟" }),
    });
    const d2 = (await r2.json()) as { supplements: { attempted: boolean } };
    expect(d2.supplements.attempted).toBe(false);
  });
});
