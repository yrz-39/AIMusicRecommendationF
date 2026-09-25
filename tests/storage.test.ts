import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileStore, MemoryStore } from "../src/storage/jsonStore.js";
import type { Track } from "../src/core/types.js";

const dirs: string[] = [];

async function makeStore(): Promise<JsonFileStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "studymood-test-"));
  dirs.push(dir);
  const store = new JsonFileStore(dir);
  await store.init();
  return store;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const sampleTrack: Track = {
  id: "t1",
  title: "Test Song",
  artist: "Tester",
  durationSec: 180,
  genres: ["lofi"],
  energy: 0.3,
};

describe("JsonFileStore", () => {
  it("曲目保存后可读回", async () => {
    const store = await makeStore();
    await store.saveTracks([sampleTrack]);
    const loaded = await store.loadTracks();
    expect(loaded).toEqual([sampleTrack]);
  });

  it("反馈追加持久化", async () => {
    const store = await makeStore();
    await store.appendFeedback({ id: "f1", trackId: "t1", type: "like", createdAt: new Date().toISOString() });
    await store.appendFeedback({ id: "f2", trackId: "t1", type: "skip", createdAt: new Date().toISOString() });
    const events = await store.loadFeedback();
    expect(events.map((e) => e.id)).toEqual(["f1", "f2"]);
  });

  it("原子写入不残留 tmp 文件", async () => {
    const store = await makeStore();
    await store.saveTracks([sampleTrack]);
    const dir = dirs[dirs.length - 1];
    if (dir === undefined) throw new Error("no temp dir");
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("损坏的数据文件被隔离保留，应用从空状态继续（不静默清空、不卡死）", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studymood-test-"));
    dirs.push(dir);
    const broken = "{broken json —— 用户写了一半崩溃了";
    await writeFile(path.join(dir, "feedback.json"), broken, "utf8");
    const store = new JsonFileStore(dir);
    // 读取得到空状态而不是抛错
    expect(await store.loadFeedback()).toEqual([]);
    // 原文件被改名保留（数据没有丢），原名位置不再有损坏文件
    const files = await readdir(dir);
    const quarantined = files.find((f) => f.startsWith("feedback.json.corrupt-"));
    expect(quarantined).toBeDefined();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(path.join(dir, quarantined as string), "utf8")).toBe(broken);
    // 应用继续正常工作：追加反馈会写出新的合法文件
    await store.appendFeedback({ id: "f1", trackId: "t1", type: "like", createdAt: new Date().toISOString() });
    expect((await store.loadFeedback()).map((e) => e.id)).toEqual(["f1"]);
  });

  it("JSON 合法但结构异常（events 为 null）时返回空数组而不是崩溃", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studymood-test-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "feedback.json"), '{"events": null}', "utf8");
    const store = new JsonFileStore(dir);
    expect(await store.loadFeedback()).toEqual([]);
  });

  it("空库返回空数组", async () => {
    const store = await makeStore();
    expect(await store.loadTracks()).toEqual([]);
  });
});

describe("MemoryStore", () => {
  it("行为与 JsonFileStore 一致", async () => {
    const store = new MemoryStore();
    await store.saveTracks([sampleTrack]);
    await store.appendFeedback({ id: "f1", trackId: "t1", type: "like", createdAt: new Date().toISOString() });
    expect(await store.loadTracks()).toEqual([sampleTrack]);
    expect((await store.loadFeedback()).length).toBe(1);
  });
});
