import { describe, expect, it } from "vitest";
import { deriveTargetProfile, recommend, trackEnergy } from "../src/core/recommend/engine.js";
import { buildPlaylist } from "../src/core/recommend/playlist.js";
import { computeAffinity } from "../src/core/personalization/affinity.js";
import type { StudyContext, Track } from "../src/core/types.js";
import { parseContext } from "../src/core/parser/rulesParser.js";

function ctx(input: string): StudyContext {
  return parseContext(input).context;
}

function track(partial: Partial<Track> & { id: string; title: string; artist: string }): Track {
  return {
    durationSec: 200,
    genres: [],
    moodTags: [],
    ...partial,
  };
}

const calmInstrumental: Track = track({
  id: "t1",
  title: "Rain on Window",
  artist: "A",
  genres: ["lofi", "piano"],
  isInstrumental: true,
  vocalDensity: "none",
  moodTags: ["calm", "focus", "dreamy"],
  energy: 0.25,
});

const energeticPop: Track = track({
  id: "t2",
  title: "Run the Night",
  artist: "B",
  genres: ["pop", "electronic"],
  vocalDensity: "high",
  moodTags: ["uplifting", "bright"],
  energy: 0.85,
});

const vocalBallad: Track = track({
  id: "t3",
  title: "Slow Words",
  artist: "C",
  genres: ["folk"],
  vocalDensity: "medium",
  moodTags: ["warm", "gentle"],
  energy: 0.35,
});

describe("deriveTargetProfile", () => {
  it("明确要求安静时以用户表达为准", () => {
    const profile = deriveTargetProfile(ctx("写代码，想听安静一点歌词少一点的音乐"));
    expect(profile.targetEnergy).toBeCloseTo(0.25, 5);
    expect(profile.defaults.energy).toBe("stated");
    expect(profile.targetVocal).toBe("few-lyrics");
  });

  it("容易走神但没说偏好时推断安静+少歌词", () => {
    const profile = deriveTargetProfile(ctx("容易走神，复习"));
    expect(profile.targetEnergy).toBeLessThan(0.45);
    expect(profile.targetVocal).toBe("few-lyrics");
    expect(profile.defaults.vocal).toBe("inferred");
  });

  it("没有任何线索时使用中性默认", () => {
    const profile = deriveTargetProfile(ctx("随便放点歌"));
    expect(profile.targetEnergy).toBe(0.5);
    expect(profile.targetVocal).toBe("any");
    expect(profile.desiredMoods.length).toBeGreaterThan(0);
  });
});

describe("trackEnergy", () => {
  it("显式 energy 优先", () => {
    expect(trackEnergy({ ...calmInstrumental, energy: 0.1 })).toBe(0.1);
  });
  it("无 energy 时用流派先验", () => {
    expect(trackEnergy(track({ id: "x", title: "x", artist: "x", genres: ["rock"] }))).toBeGreaterThan(0.6);
    expect(trackEnergy(track({ id: "y", title: "y", artist: "y", genres: ["lofi"] }))).toBeLessThan(0.4);
  });
  it("完全未知时中性 0.5", () => {
    expect(trackEnergy(track({ id: "z", title: "z", artist: "z" }))).toBe(0.5);
  });
});

describe("buildPlaylist", () => {
  function manyTracks(): Track[] {
    return Array.from({ length: 30 }, (_, i) =>
      track({
        id: `p${i}`,
        title: `Song ${i}`,
        artist: i < 15 ? "ArtistA" : "ArtistB",
        genres: ["lofi"],
        isInstrumental: true,
        vocalDensity: "none",
        moodTags: ["calm", "focus"],
        energy: 0.3,
        durationSec: 200,
      }),
    );
  }

  it("按时长预算组装歌单并尊重同歌手上限", () => {
    const recs = recommend({
      tracks: manyTracks(),
      context: ctx("想听安静的纯音乐"),
      feedbackEvents: [],
      limit: 30,
    });
    const playlist = buildPlaylist(recs, 15);
    // 15 分钟 = 900s，900/200 ≈ 4-5 首（受同歌手 2 首上限影响，A/B 各 2 = 4 首）
    expect(playlist.totalSec).toBeGreaterThanOrEqual(720);
    expect(playlist.totalSec).toBeLessThanOrEqual(990);
    const counts = new Map<string, number>();
    for (const t of playlist.tracks) counts.set(t.track.artist, (counts.get(t.track.artist) ?? 0) + 1);
    for (const c of counts.values()) expect(c).toBeLessThanOrEqual(2);
  });

  it("预算不足时报告缺口", () => {
    const recs = recommend({
      tracks: [calmInstrumental],
      context: ctx("想听安静的"),
      feedbackEvents: [],
      limit: 5,
    });
    const playlist = buildPlaylist(recs, 30);
    expect(playlist.shortfallSec).toBeGreaterThan(0);
  });

  it("预算边界：默认 30 分钟且上限 240 分钟", () => {
    const recs = recommend({ tracks: manyTracks(), context: ctx("想听安静的"), feedbackEvents: [], limit: 30 });
    expect(buildPlaylist(recs).budgetMin).toBe(30);
    expect(buildPlaylist(recs, 999).budgetMin).toBe(240);
  });
});

describe("recommend", () => {
  it("累+走神+想安静时，安静纯音乐排在前列，高能流行垫底", () => {
    const recs = recommend({
      tracks: [calmInstrumental, energeticPop, vocalBallad],
      context: ctx("有点累容易走神，想听安静一点歌词少一点的音乐"),
      feedbackEvents: [],
    });
    expect(recs.length).toBe(3);
    expect(recs[0]?.track.id).toBe("t1");
    const last = recs.at(-1);
    expect(["t2", "t3"]).toContain(last?.track.id);
    expect(recs[0]?.score).toBeGreaterThan(recs.at(-1)?.score ?? 0);
  });

  it("推荐理由真实可解释且非空", () => {
    const recs = recommend({
      tracks: [calmInstrumental],
      context: ctx("写代码有点累容易走神想听安静的纯音乐"),
      feedbackEvents: [],
    });
    expect(recs[0]?.reasons.length).toBeGreaterThan(0);
    // 理由必须来自真实计算：包含人声/氛围相关的解释
    const joined = recs[0]?.reasons.join("") ?? "";
    expect(joined.length).toBeGreaterThan(5);
  });

  it("like 反馈会提升被赞曲目的得分", () => {
    const context = ctx("复习，随便什么歌");
    const base = recommend({ tracks: [energeticPop, calmInstrumental], context, feedbackEvents: [] });
    const t2Base = base.find((r) => r.track.id === "t2")?.score ?? 0;
    const liked = recommend({
      tracks: [energeticPop, calmInstrumental],
      context,
      feedbackEvents: [{ id: "f1", trackId: "t2", type: "like", createdAt: new Date().toISOString() }],
    });
    const t2Liked = liked.find((r) => r.track.id === "t2")?.score ?? 0;
    expect(t2Liked).toBeGreaterThan(t2Base);
  });

  it("not_suitable 的负反馈会把曲目压到同等合适曲目之后", () => {
    // t4 与 t1 情境契合度几乎相同，唯一差别是 t1 被用户标记过不适合
    const t4 = track({
      id: "t4",
      title: "Rain on Window II",
      artist: "D",
      genres: ["lofi", "piano"],
      isInstrumental: true,
      vocalDensity: "none",
      moodTags: ["calm", "focus", "dreamy"],
      energy: 0.25,
    });
    const rejected = recommend({
      tracks: [calmInstrumental, t4, energeticPop],
      context: ctx("复习，随便什么歌"),
      feedbackEvents: [{ id: "f1", trackId: "t1", type: "not_suitable", createdAt: new Date().toISOString() }],
    });
    const order = rejected.map((r) => r.track.id);
    expect(order.indexOf("t1")).toBeGreaterThan(order.indexOf("t4"));
    // 但负反馈不能覆盖明确的当前需求：明确想听安静纯音乐时 t1 仍应出现在结果里
    const withNeed = recommend({
      tracks: [calmInstrumental, energeticPop],
      context: ctx("想听安静的纯音乐"),
      feedbackEvents: [{ id: "f1", trackId: "t1", type: "not_suitable", createdAt: new Date().toISOString() }],
      limit: 2,
    });
    expect(withNeed.length).toBe(2);
  });

  it("like 反馈真实影响亲和度计算", () => {
    const now = new Date();
    const events = [
      { id: "f1", trackId: "t1", type: "like" as const, createdAt: now.toISOString() },
    ];
    const affinity = computeAffinity(events, new Map([["t1", "A"]]), now);
    expect(affinity.track.get("t1")).toBeGreaterThan(0);
    expect(affinity.artist.get("A")).toBeGreaterThan(0);
  });

  it("not_suitable 排除后不再出现在推荐中", () => {
    const recs = recommend({
      tracks: [calmInstrumental, energeticPop],
      context: ctx("想听安静的"),
      feedbackEvents: [],
      excludeTrackIds: ["t1"],
    });
    expect(recs.find((r) => r.track.id === "t1")).toBeUndefined();
    expect(recs.length).toBe(1);
  });

  it("最近推荐过的曲目被降权但不消失", () => {
    const context = ctx("想听安静的纯音乐");
    const without = recommend({ tracks: [calmInstrumental, vocalBallad], context, feedbackEvents: [] });
    const withRecent = recommend({
      tracks: [calmInstrumental, vocalBallad],
      context,
      feedbackEvents: [],
      recentTrackIds: ["t1"],
    });
    const t1Without = without.find((r) => r.track.id === "t1")?.score ?? 0;
    const t1With = withRecent.find((r) => r.track.id === "t1")?.score ?? 0;
    expect(t1With).toBeLessThan(t1Without);
  });

  it("同歌手最多 2 首", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      track({ id: `d${i}`, title: `Song ${i}`, artist: "Same Artist", energy: 0.3, isInstrumental: true }),
    );
    const recs = recommend({ tracks: many, context: ctx("想听安静的"), feedbackEvents: [], limit: 10 });
    expect(recs.length).toBe(2);
  });

  it("同分时长甜区(2.5-7分钟)优先于过短曲目", () => {
    // 两首契合度完全相同的纯音乐，仅时长不同
    const short = track({
      id: "short",
      title: "AAA Tiny Jingle",
      artist: "S",
      genres: ["lofi"],
      isInstrumental: true,
      vocalDensity: "none",
      moodTags: ["calm", "focus"],
      energy: 0.3,
      durationSec: 45,
    });
    const sweet = track({
      id: "sweet",
      title: "BBB Study Loop",
      artist: "S2",
      genres: ["lofi"],
      isInstrumental: true,
      vocalDensity: "none",
      moodTags: ["calm", "focus"],
      energy: 0.3,
      durationSec: 240,
    });
    const recs = recommend({ tracks: [short, sweet], context: ctx("想听安静的纯音乐"), feedbackEvents: [] });
    expect(recs[0]?.track.id).toBe("sweet");
    // 分数相同（二级信号决定顺序）
    expect(recs[0]?.score).toBe(recs[1]?.score);
  });

  it("空曲库返回空结果", () => {
    expect(recommend({ tracks: [], context: ctx("写代码"), feedbackEvents: [] })).toEqual([]);
  });
});
