import { describe, expect, it } from "vitest";
import { assembleTrack, parseAudioFileName, trackIdFromAudio } from "../src/core/import/audio.js";

describe("parseAudioFileName", () => {
  it("『歌手 - 歌名.mp3』拆出歌手与歌名", () => {
    expect(parseAudioFileName("周杰伦 - 晴天.mp3")).toEqual({ artist: "周杰伦", title: "晴天" });
    expect(parseAudioFileName("Nujabes – Aruarian Dance.flac")).toEqual({ artist: "Nujabes", title: "Aruarian Dance" });
  });

  it("多个连字符时第一段是歌手，其余归歌名", () => {
    expect(parseAudioFileName("周杰伦 - 晴天 - Live.mp3")).toEqual({ artist: "周杰伦", title: "晴天 - Live" });
  });

  it("无连字符时整名作歌名", () => {
    expect(parseAudioFileName("Bohemian Rhapsody.mp3")).toEqual({ title: "Bohemian Rhapsody" });
  });
});

describe("assembleTrack", () => {
  it("优先使用标签，缺失时用文件名兜底", () => {
    const tagged = assembleTrack("ignored.mp3", {
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      durationSec: 269.2,
      genres: ["Pop"],
    });
    expect(tagged.track).toMatchObject({
      id: "audio-周杰伦-晴天",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      durationSec: 269,
      genres: ["pop"],
    });
    const fallback = assembleTrack("陈绮贞 - 旅行的意义.mp3", { durationSec: 216 });
    expect(fallback.track).toMatchObject({ id: "audio-陈绮贞-旅行的意义", artist: "陈绮贞", title: "旅行的意义" });
  });

  it("拒绝坏数据并给出原因", () => {
    expect(assembleTrack("untitled.mp3", { durationSec: 100 }).reason).toContain("歌手");
    expect(assembleTrack("xyz.mp3", { artist: "A", durationSec: 0 }).reason).toContain("时长");
    expect(assembleTrack("xyz.mp3", { artist: "A" }).reason).toContain("时长");
    expect(assembleTrack(".mp3", { artist: "A", durationSec: 1 }).reason).toContain("歌名");
  });

  it("相同歌手+歌名生成稳定 id（天然去重）", () => {
    expect(trackIdFromAudio("晴天", "周杰伦")).toBe(trackIdFromAudio("晴天", "周杰伦"));
  });
});
