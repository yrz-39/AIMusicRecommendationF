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
