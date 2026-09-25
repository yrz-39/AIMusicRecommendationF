import { describe, expect, it } from "vitest";
import {
  parseMediaSessions,
  parseWindowTitle,
  pickPlayingSession,
  sourceFromAppId,
} from "../src/core/native/nowPlaying.js";

describe("parseWindowTitle", () => {
  it("解析网易云播放标题", () => {
    const r = parseWindowTitle("我相信 - 杨培安 - 网易云音乐");
    expect(r?.playing).toBe(true);
    expect(r?.title).toBe("我相信");
    expect(r?.artist).toBe("杨培安");
    expect(r?.source).toBe("netease");
    expect(r?.via).toBe("window-title");
  });

  it("解析 QQ 音乐标题", () => {
    const r = parseWindowTitle("晴天 — 周杰伦 — QQ音乐");
    expect(r?.title).toBe("晴天");
    expect(r?.artist).toBe("周杰伦");
    expect(r?.source).toBe("qq");
  });

  it("未播放状态（仅客户端名）返回 null", () => {
    expect(parseWindowTitle("网易云音乐")).toBeNull();
    expect(parseWindowTitle("CloudMusic")).toBeNull();
  });

  it("无关窗口返回 null", () => {
    expect(parseWindowTitle("文档1 - Word")).toBeNull();
    expect(parseWindowTitle("")).toBeNull();
  });
});

describe("SMTC 媒体会话解析", () => {
  it("解析多会话 JSON（PS ConvertTo-Json 数组输出）", () => {
    const raw =
      '[{"title":"夜曲","artist":"周杰伦","status":"Playing","sourceApp":"Netease.CloudMusicMusic_daewk7qxc1t12!App"},{"title":" paused ","artist":"","status":"Paused","sourceApp":"Chrome"}]';
    const sessions = parseMediaSessions(raw);
    expect(sessions.length).toBe(2);
    expect(sessions[0]).toEqual({
      title: "夜曲",
      artist: "周杰伦",
      status: "Playing",
      sourceApp: "Netease.CloudMusicMusic_daewk7qxc1t12!App",
    });
    // 空字符串字段归一化为 undefined
    expect(sessions[1]?.artist).toBeUndefined();
    expect(sessions[1]?.title).toBe("paused");
  });

  it("PS 5.1 单元素数组 unwrap 成对象时也能解析", () => {
    const sessions = parseMediaSessions('{"title":"Song","artist":"A","status":"Playing"}');
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.title).toBe("Song");
  });

  it("空输出、非法 JSON、无有效字段时返回空数组", () => {
    expect(parseMediaSessions("")).toEqual([]);
    expect(parseMediaSessions("not json")).toEqual([]);
    expect(parseMediaSessions('[]')).toEqual([]);
    expect(parseMediaSessions('[{"artist":"no title","status":"Playing"}]')).toEqual([]);
  });

  it("pickPlayingSession 选取 Playing 会话并忽略非播放会话", () => {
    const playing = pickPlayingSession([
      { title: "A", status: "Paused" },
      { title: "B", artist: "X", status: "Playing" },
    ]);
    expect(playing?.title).toBe("B");
    expect(pickPlayingSession([{ title: "A", status: "Paused" }])).toBeNull();
    expect(pickPlayingSession([])).toBeNull();
  });

  it("sourceFromAppId 映射播放器来源", () => {
    expect(sourceFromAppId("Netease.CloudMusicMusic_daewk7qxc1t12!App")).toBe("netease");
    expect(sourceFromAppId("Tencent.QQMusicPC")).toBe("qq");
    expect(sourceFromAppId("Chrome")).toBe("unknown");
    expect(sourceFromAppId(undefined)).toBe("unknown");
  });
});
