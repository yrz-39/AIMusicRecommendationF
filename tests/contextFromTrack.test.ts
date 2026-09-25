import { describe, expect, it } from "vitest";
import { contextFromTrack, matchPlayingTrack } from "../src/core/recommend/contextFromTrack.js";
import { deriveTargetProfile } from "../src/core/recommend/engine.js";
import type { Track } from "../src/core/types.js";

const quiet: Track = {
  id: "q",
  title: "夜曲",
  artist: "周杰伦",
  durationSec: 226,
  energy: 0.28,
  isInstrumental: true,
  vocalDensity: "none",
  genres: ["piano"],
};

const hype: Track = {
  id: "h",
  title: "Titanium",
  artist: "David Guetta",
  durationSec: 245,
  energy: 0.9,
  genres: ["electronic"],
};

const mid: Track = { id: "m", title: "Song", artist: "A", durationSec: 200 };

describe("contextFromTrack", () => {
  it("安静纯音乐 → calm + instrumental，目标能量走 stated 路径", () => {
    const ctx = contextFromTrack(quiet);
    expect(ctx.musicPrefs?.calmness).toBe("calm");
    expect(ctx.musicPrefs?.vocalPreference).toBe("instrumental");
    expect(ctx.musicPrefs?.genres).toEqual(["piano"]);
    const profile = deriveTargetProfile(ctx);
    expect(profile.targetEnergy).toBe(0.25);
    expect(profile.defaults.energy).toBe("stated");
  });

  it("高能歌曲 → energetic（0.75 目标）", () => {
    const profile = deriveTargetProfile(contextFromTrack(hype));
    expect(profile.targetEnergy).toBe(0.75);
  });

  it("无能量信息的歌用流派先验/中性档，人声偏好不设限", () => {
    const ctx = contextFromTrack(mid);
    expect(ctx.musicPrefs?.calmness).toBe("balanced");
    expect(ctx.musicPrefs?.vocalPreference).toBe("any");
  });

  it("情境可解释：matched 记录正在播放的曲目", () => {
    const ctx = contextFromTrack(quiet);
    expect(ctx.rawInput).toContain("夜曲");
    expect(ctx.parserMeta.matched[0]).toContain("夜曲");
    expect(ctx.parserMeta.matched[0]).toContain("周杰伦");
  });
});

describe("matchPlayingTrack", () => {
  const library = [quiet, hype, { ...mid, title: "晴天", artist: "周杰伦" }];

  it("标题+歌手精确匹配优先", () => {
    expect(matchPlayingTrack(library, { title: "夜曲", artist: "周杰伦" })?.id).toBe("q");
  });

  it("大小写不敏感", () => {
    expect(matchPlayingTrack(library, { title: "titanium", artist: "david guetta" })?.id).toBe("h");
  });

  it("标题匹配但歌手对不上时，取标题命中的第一首", () => {
    expect(matchPlayingTrack(library, { title: "晴天", artist: "某人翻唱" })?.id).toBe("m");
  });

  it("窗口标题含附加信息时用包含匹配", () => {
    expect(matchPlayingTrack(library, { title: "夜曲 (Live 版)" })?.id).toBe("q");
  });

  it("匹配不到返回 null", () => {
    expect(matchPlayingTrack(library, { title: "不存在的歌" })).toBeNull();
    expect(matchPlayingTrack(library, {})).toBeNull();
  });
});
