import { describe, expect, it } from "vitest";
import { applyFeatureDelta, parseSongFeedback } from "../src/core/learn/featureLearner.js";
import type { Track } from "../src/core/types.js";

const base: Track = {
  id: "t1",
  title: "我相信",
  artist: "杨培安",
  durationSec: 270,
  genres: ["pop"],
  energy: 0.5,
  moodTags: [],
  vocalDensity: "high",
};

describe("parseSongFeedback", () => {
  it("用户示例：有力气、提高精力、振奋精神 → 高能量 + 振奋标签", () => {
    const delta = parseSongFeedback("这首歌给我力气，能够提高精力，振奋精神");
    expect(delta.understood).toBe(true);
    expect(delta.energyHint).toBe("high");
    expect(delta.moodTags).toContain("uplifting");
    expect(delta.matched.length).toBeGreaterThan(1);
  });

  it("安静放松的反馈 → 低能量 + 平静", () => {
    const delta = parseSongFeedback("听这个能静下心来，很舒缓");
    expect(delta.energyHint).toBe("low");
    expect(delta.moodTags).toContain("calm");
  });

  it("纯音乐反馈 → 人声密度 none", () => {
    const delta = parseSongFeedback("没有歌词，写代码的时候很专注");
    expect(delta.vocalDensity).toBe("none");
    expect(delta.moodTags).toContain("focus");
  });

  it("无法理解的输入返回 understood=false", () => {
    expect(parseSongFeedback("这首歌还行吧").understood).toBe(false);
  });
});

describe("applyFeatureDelta", () => {
  it("能量按学习率向目标混合，而不是跳变", () => {
    const { track, changes } = applyFeatureDelta(base, parseSongFeedback("给我力气，振奋精神"));
    const expected = Math.round((0.5 * 0.7 + 0.72 * 0.3) * 100) / 100;
    expect(track.energy).toBe(expected);
    expect(track.moodTags).toContain("uplifting");
    expect(changes.some((c) => c.includes("能量"))).toBe(true);
  });

  it("多次同向反馈会收敛到目标附近", () => {
    let t: Track = base;
    for (let i = 0; i < 10; i++) {
      t = applyFeatureDelta(t, parseSongFeedback("提神带感")).track;
    }
    expect(t.energy).toBeGreaterThan(0.68);
    expect(t.energy).toBeLessThan(0.73);
  });

  it("反向反馈能把高能歌曲拉回安静", () => {
    let t: Track = { ...base, energy: 0.8 };
    t = applyFeatureDelta(t, parseSongFeedback("很安静很舒缓")).track;
    expect(t.energy).toBeLessThan(0.8);
  });

  it("情绪标签去重且有上限", () => {
    let t: Track = { ...base, moodTags: ["warm", "gentle", "bright", "uplifting", "groovy", "focus"] };
    const { changes } = applyFeatureDelta(t, parseSongFeedback("难过的时候听"));
    expect(t.moodTags?.length).toBe(6);
    expect(changes).toEqual([]); // 已满且能量无提示 → 无变化
  });

  it("不修改原对象", () => {
    const snapshot = JSON.stringify(base);
    applyFeatureDelta(base, parseSongFeedback("提神振奋"));
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
