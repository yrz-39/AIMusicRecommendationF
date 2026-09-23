import { describe, expect, it } from "vitest";
import { parseWindowTitle } from "../src/core/native/nowPlaying.js";

describe("parseWindowTitle", () => {
  it("解析网易云播放标题", () => {
    const r = parseWindowTitle("我相信 - 杨培安 - 网易云音乐");
    expect(r?.playing).toBe(true);
    expect(r?.title).toBe("我相信");
    expect(r?.artist).toBe("杨培安");
    expect(r?.source).toBe("netease");
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
