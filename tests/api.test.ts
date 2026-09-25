import { describe, expect, it } from "vitest";
import { createApp, seedSampleIfFirstRun } from "../src/server/app.js";
import { MemoryStore } from "../src/storage/jsonStore.js";

function json(res: Response): Promise<unknown> {
  return res.json() as Promise<unknown>;
}

async function makeSeededApp() {
  const store = new MemoryStore();
  await seedSampleIfFirstRun(store);
  const app = createApp({ store });
  return { store, app };
}

describe("API", () => {
  it("health 检查", async () => {
    const { app } = await makeSeededApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await json(res)) as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it("health 返回注入的版本号与数据目录", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, appVersion: "0.1.0", dataDir: "D:/somewhere/data" });
    const res = await app.request("/api/health");
    const data = (await json(res)) as { ok: boolean; version: string | null; dataDir: string | null };
    expect(data.version).toBe("0.1.0");
    expect(data.dataDir).toBe("D:/somewhere/data");
  });

  it("recommend-similar：基于曲目构造情境、排除自身、记录会话", async () => {
    const { app, store } = await makeSeededApp();
    const tracks = await store.loadTracks();
    const base = tracks.find((t) => t.energy !== undefined && t.energy < 0.4);
    if (base === undefined) throw new Error("示例库缺少安静曲目");
    const res = await app.request("/api/recommend-similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: base.id }),
    });
    expect(res.status).toBe(200);
    const data = (await json(res)) as {
      sessionId: string;
      context: { musicPrefs?: { calmness?: string }; parserMeta: { matched: string[] } };
      recommendations: Array<{ track: { id: string } }>;
      basedOn: { id: string };
    };
    expect(data.basedOn.id).toBe(base.id);
    expect(data.context.musicPrefs?.calmness).toBe("calm");
    expect(data.context.parserMeta.matched[0]).toContain(base.title);
    expect(data.recommendations.length).toBeGreaterThan(0);
    expect(data.recommendations.some((r) => r.track.id === base.id)).toBe(false);
    // 会话已记录（历史页可见）
    expect((await store.loadSessions()).some((s) => s.id === data.sessionId)).toBe(true);
  });

  it("recommend-similar 参数错误与未知曲目", async () => {
    const { app } = await makeSeededApp();
    const missing = await app.request("/api/recommend-similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    const unknown = await app.request("/api/recommend-similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "no-such-id" }),
    });
    expect(unknown.status).toBe(404);
  });

  it("now-playing/current：无播放时优雅降级，不暴露 track", async () => {
    const { app } = await makeSeededApp();
    const res = await app.request("/api/now-playing/current");
    expect(res.status).toBe(200);
    const data = (await json(res)) as { playing: boolean; track?: unknown };
    expect(typeof data.playing).toBe("boolean");
    if (!data.playing) expect(data.track).toBeUndefined();
  });

  it("首次运行导入示例库且只执行一次", async () => {
    const store = new MemoryStore();
    expect(await seedSampleIfFirstRun(store)).toBe(true);
    expect((await store.loadTracks()).length).toBeGreaterThan(50);
    // 第二次不再导入
    expect(await seedSampleIfFirstRun(store)).toBe(false);
    // 用户清空曲库后也不会重新填充
    await store.saveTracks([]);
    expect(await seedSampleIfFirstRun(store)).toBe(false);
    expect(await store.loadTracks()).toEqual([]);
  });

  it("完整推荐流程：理解→推荐→理由→反馈→下批排除", async () => {
    const { app } = await makeSeededApp();

    const res = await app.request("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "今晚准备写代码两个小时，有点累，而且容易走神。想听安静一点、歌词少一点的音乐。" }),
    });
    expect(res.status).toBe(200);
    const data = (await json(res)) as {
      sessionId: string;
      context: { task?: string; focusDifficulty?: string; musicPrefs?: { calmness?: string } };
      recommendations: Array<{ track: { id: string }; score: number; reasons: string[] }>;
    };
    expect(data.sessionId).toBeTruthy();
    expect(data.context.task).toBe("写代码");
    expect(data.context.focusDifficulty).toBe("high");
    expect(data.context.musicPrefs?.calmness).toBe("calm");
    expect(data.recommendations.length).toBeGreaterThan(5);
    expect(data.recommendations.length).toBeLessThanOrEqual(10);
    // 每个推荐都有可解释理由
    for (const rec of data.recommendations) {
      expect(rec.reasons.length).toBeGreaterThan(0);
      expect(rec.score).toBeGreaterThan(0);
    }
    // 分数降序
    const scores = data.recommendations.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // 反馈：不喜欢第一首
    const first = data.recommendations[0]!;
    const fbRes = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: first.track.id, type: "not_suitable", sessionId: data.sessionId }),
    });
    expect(fbRes.status).toBe(200);

    // 同会话再推荐：第一首不再出现
    const res2 = await app.request("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "继续写代码，还是累", sessionId: data.sessionId }),
    });
    const data2 = (await json(res2)) as { recommendations: Array<{ track: { id: string } }> };
    expect(data2.recommendations.find((r) => r.track.id === first.track.id)).toBeUndefined();
  });

  it("空输入返回 400，非法反馈类型返回 400", async () => {
    const { app } = await makeSeededApp();
    const bad = await app.request("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "   " }),
    });
    expect(bad.status).toBe(400);

    const badFb = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "river-flows-in-you", type: "meh" }),
    });
    expect(badFb.status).toBe(400);
  });

  it("JSON 导入：合法行入库，非法行被拒", async () => {
    const { app, store } = await makeSeededApp();
    const before = (await store.loadTracks()).length;

    const res = await app.request("/api/library/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tracks: [
          { title: "测试曲", artist: "测试者", duration: "3:21", genres: "pop, rock", energy: "0.6" },
          { title: "", artist: "没名字" },
          { title: "没时长", artist: "测试者" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = (await json(res)) as { imported: number; rejected: Array<{ reason: string }> };
    expect(data.imported).toBe(1);
    expect(data.rejected.length).toBe(2);
    expect((await store.loadTracks()).length).toBe(before + 1);
  });

  it("CSV 导入：中英表头入库，坏行被拒", async () => {
    const { app, store } = await makeSeededApp();
    const before = (await store.loadTracks()).length;
    const csv = [
      "title,artist,duration,genres",
      '"Song, A",某人,3:30,"pop, rock"',
      "Bad Row",
    ].join("\n");
    const res = await app.request("/api/library/import-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    expect(res.status).toBe(200);
    const data = (await json(res)) as { imported: number };
    expect(data.imported).toBe(1);
    expect((await store.loadTracks()).length).toBe(before + 1);
  });

  it("历史接口返回会话与反馈统计", async () => {
    const { app } = await makeSeededApp();
    const rec = await app.request("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "复习，随便什么歌" }),
    });
    const data = (await json(rec)) as { sessionId: string; recommendations: Array<{ track: { id: string } }> };
    await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: data.recommendations[0]!.track.id, type: "like", sessionId: data.sessionId }),
    });

    const res = await app.request("/api/history");
    expect(res.status).toBe(200);
    const history = (await json(res)) as {
      sessions: Array<{ id: string; tracks: Array<{ track: { id: string }; feedback?: string }> }>;
      stats: { likes: number; skips: number; rejected: number };
    };
    expect(history.sessions.length).toBeGreaterThan(0);
    const session = history.sessions.find((s) => s.id === data.sessionId);
    expect(session).toBeDefined();
    expect(session?.tracks[0]?.feedback).toBe("like");
    expect(history.stats.likes).toBe(1);
  });

  it("特征学习：自然语言反馈写入曲目特征并可追溯", async () => {
    const { app, store } = await makeSeededApp();
    const tracks = await store.loadTracks();
    const target = tracks.find((t) => t.energy !== undefined && t.energy < 0.4)!;

    const res = await app.request(`/api/tracks/${target.id}/learn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "这首歌给我力气，能够提高精力，振奋精神" }),
    });
    expect(res.status).toBe(200);
    const data = (await json(res)) as { track: { energy?: number }; changes: string[] };
    expect(data.track.energy!).toBeGreaterThan(target.energy!);
    expect(data.changes.length).toBeGreaterThan(0);
    // 学习事件持久化
    const events = await store.loadLearnEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.trackId).toBe(target.id);
    expect(events[0]?.delta.energyHint).toBe("high");
  });

  it("特征学习：无法理解时 422 且不写入", async () => {
    const { app, store } = await makeSeededApp();
    const tracks = await store.loadTracks();
    const res = await app.request(`/api/tracks/${tracks[0]!.id}/learn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "还行吧" }),
    });
    expect(res.status).toBe(422);
    expect(await store.loadLearnEvents()).toEqual([]);
  });

  it("歌单接口：按时长预算返回完整歌单", async () => {
    const { app } = await makeSeededApp();
    const res = await app.request("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "我现在精力比较低，要背书 40 分钟左右，想听安静的" }),
    });
    expect(res.status).toBe(200);
    const data = (await json(res)) as {
      playlist: { tracks: Array<{ track: { durationSec: number } }>; totalSec: number; budgetMin: number };
      context: { durationMinutes?: number };
    };
    expect(data.context.durationMinutes).toBe(40);
    expect(data.playlist.budgetMin).toBe(40);
    expect(data.playlist.tracks.length).toBeGreaterThan(5);
    expect(data.playlist.totalSec).toBeGreaterThanOrEqual(35 * 60);
    expect(data.playlist.totalSec).toBeLessThanOrEqual(42 * 60);
  });

  it("now-playing 接口优雅降级", async () => {
    const { app } = await makeSeededApp();
    const res = await app.request("/api/now-playing");
    expect(res.status).toBe(200);
    const data = (await json(res)) as { playing: boolean };
    expect(typeof data.playing).toBe("boolean");
  });

  it("反馈不存在的曲目返回 404", async () => {
    const { app } = await makeSeededApp();
    const res = await app.request("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "no-such-track", type: "like" }),
    });
    expect(res.status).toBe(404);
  });
});
