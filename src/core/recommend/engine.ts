import type {
  EngineConfig,
  Recommendation,
  ScoreComponent,
  StudyContext,
  Track,
} from "../types.js";
import {
  CONTEXT_MOOD_TO_DESIRED,
  GENRE_ENERGY_PRIOR,
  MOOD_DIRECTION,
  type TargetProfile,
} from "./priors.js";
import { affinityToScore, computeAffinity, type AffinityMap } from "../personalization/affinity.js";
import type { FeedbackEvent } from "../types.js";

/**
 * 推荐引擎：情境 → 候选评分 → 排序 → 可解释推荐。
 *
 * 硬性约定：
 * - 每个推荐理由都由对应分项的真实计算结果生成，禁止事后编造；
 * - 用户当前明确表达的需求优先于历史反馈（personalCap 限制个性化影响）；
 * - 全流程纯函数，无 I/O。
 */

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  weights: {
    context: 0.36,
    vocal: 0.18,
    mood: 0.14,
    preference: 0.14,
    personal: 0.12,
    freshness: 0.06,
  },
  /** 正向（喜欢）个性化偏差上限（百分制分值）：喜欢不应强行把歌顶上去 */
  personalCap: 8,
  /** 负向（不适合/跳过）偏差上限：必须可靠地把被拒曲目压下去 */
  personalNegativeCap: 20,
};

export interface RecommendInput {
  tracks: Track[];
  context: StudyContext;
  /** 历史反馈事件（可为空） */
  feedbackEvents: FeedbackEvent[];
  /** 近期已推荐过的曲目 id（降权，避免连续重复） */
  recentTrackIds?: string[];
  /** 明确排除的曲目 id（如本会话中用户反馈"不适合"的） */
  excludeTrackIds?: string[];
  limit?: number;
  config?: EngineConfig;
  now?: Date;
}

const MOOD_TAG_ZH: Record<string, string> = {
  focus: "专注",
  calm: "平静",
  uplifting: "振奋",
  warm: "温暖",
  dreamy: "梦幻",
  soothing: "抚慰",
  gentle: "柔和",
  groovy: "律动",
  bright: "明亮",
  melancholic: "忧郁",
};

const GENRE_ZH: Record<string, string> = {
  lofi: "Lo-Fi",
  classical: "古典",
  piano: "钢琴",
  "post-rock": "后摇",
  electronic: "电子",
  jazz: "爵士",
  folk: "民谣",
  rock: "摇滚",
  pop: "流行",
  "city-pop": "City Pop",
  acg: "ACG",
  ambient: "氛围",
  acoustic: "原声",
  rnb: "R&B",
  hiphop: "嘻哈",
  soundtrack: "影视原声",
  metal: "金属",
};

const LANG_ZH: Record<string, string> = {
  zh: "中文",
  en: "英文",
  ja: "日语",
  ko: "韩语",
  instrumental: "纯音乐",
};

function energyWord(v: number): string {
  if (v < 0.33) return "安静舒缓";
  if (v < 0.66) return "张弛适中";
  return "提神带感";
}

/** 曲目有效能量：显式 energy > 流派先验 > 中性 0.5 */
export function trackEnergy(track: Track): number {
  if (track.energy !== undefined) return track.energy;
  const genres = track.genres ?? [];
  const priors = genres.map((g) => GENRE_ENERGY_PRIOR[g]).filter((v): v is number => v !== undefined);
  if (priors.length > 0) return priors.reduce((a, b) => a + b, 0) / priors.length;
  return 0.5;
}

/** 由情境派生目标听感画像（推荐中间表示，独立导出便于测试与解释） */
export function deriveTargetProfile(context: StudyContext): TargetProfile & { energyReason: string } {
  const prefs = context.musicPrefs ?? {};
  let targetEnergy: number;
  let energyDefault: TargetProfile["defaults"]["energy"];
  let energyReason: string;

  if (prefs.calmness === "calm") {
    targetEnergy = 0.25;
    energyDefault = "stated";
    energyReason = "你明确想要安静的音乐";
  } else if (prefs.calmness === "energetic") {
    targetEnergy = 0.75;
    energyDefault = "stated";
    energyReason = "你明确想要提神的音乐";
  } else if (prefs.calmness === "balanced") {
    targetEnergy = 0.5;
    energyDefault = "stated";
    energyReason = "你想要张弛适中的音乐";
  } else if (context.focusDifficulty === "high") {
    targetEnergy = 0.35;
    energyDefault = "inferred";
    energyReason = "你提到容易走神，倾向更安静、更少干扰的曲目";
  } else if (context.energy === "low") {
    targetEnergy = 0.45;
    energyDefault = "inferred";
    energyReason = "你现在比较累，选了温和不吵的曲目";
  } else if (context.energy === "high") {
    targetEnergy = 0.65;
    energyDefault = "inferred";
    energyReason = "你现在精力充沛，可以驾驭更有活力的曲目";
  } else if (context.stress === "high") {
    targetEnergy = 0.4;
    energyDefault = "inferred";
    energyReason = "你有压力，倾向平稳放松的曲目";
  } else {
    targetEnergy = 0.5;
    energyDefault = "default";
    energyReason = "未特别说明，采用张弛适中的默认取向";
  }

  // 细微修正：明确表达仍然主导，只做小幅偏移
  if (energyDefault === "stated") {
    if (context.focusDifficulty === "high") targetEnergy -= 0.04;
    if (context.stress === "high") targetEnergy -= 0.04;
    if (context.energy === "high") targetEnergy += 0.04;
  }

  let targetVocal: TargetProfile["targetVocal"];
  let vocalDefault: TargetProfile["defaults"]["vocal"];
  if (prefs.vocalPreference !== undefined) {
    targetVocal = prefs.vocalPreference;
    vocalDefault = "stated";
  } else if (context.focusDifficulty === "high") {
    targetVocal = "few-lyrics";
    vocalDefault = "inferred";
  } else {
    targetVocal = "any";
    vocalDefault = "default";
  }

  const desiredMoodSet = new Set<string>();
  for (const mood of context.moods ?? []) {
    const key = CONTEXT_MOOD_TO_DESIRED[mood];
    if (key === undefined) continue;
    for (const d of MOOD_DIRECTION[key] ?? []) desiredMoodSet.add(d);
  }
  if (desiredMoodSet.size === 0) {
    desiredMoodSet.add("focus");
    desiredMoodSet.add("calm");
  }

  return {
    targetEnergy: Math.min(1, Math.max(0, targetEnergy)),
    targetVocal,
    desiredMoods: [...desiredMoodSet],
    defaults: { energy: energyDefault, vocal: vocalDefault },
    energyReason,
  };
}

function vocalScore(track: Track, targetVocal: TargetProfile["targetVocal"]): number {
  if (targetVocal === "any") return 0.5; // 中性：不奖不罚
  const density = track.isInstrumental || track.vocalDensity === "none" ? "none" : track.vocalDensity ?? "medium";
  switch (density) {
    case "none":
      return 1;
    case "low":
      return targetVocal === "instrumental" ? 0.75 : 1;
    case "medium":
      return targetVocal === "instrumental" ? 0.25 : 0.6;
    case "high":
      return targetVocal === "instrumental" ? 0.05 : 0.2;
  }
}

function moodScore(track: Track, desiredMoods: string[]): { score: number; matched: string[] } {
  const tags = track.moodTags ?? [];
  const matched = tags.filter((t) => desiredMoods.includes(t));
  if (matched.length === 0) {
    return { score: tags.length === 0 ? 0.35 : 0.2, matched: [] };
  }
  return { score: Math.min(1, 0.6 + 0.4 * (matched.length / desiredMoods.length)), matched };
}

function preferenceScore(
  track: Track,
  context: StudyContext,
): { score: number; matchedGenres: string[]; matchedLangs: string[] } {
  const prefs = context.musicPrefs ?? {};
  const parts: Array<{ score: number; note?: string }> = [];

  if (prefs.genres && prefs.genres.length > 0) {
    const trackGenres = track.genres ?? [];
    const matchedGenres = prefs.genres.filter((g) => trackGenres.includes(g));
    parts.push({
      score: matchedGenres.length > 0 ? 1 : 0.35,
      note: matchedGenres.length > 0 ? "genre" : undefined,
    });
  }
  if (prefs.languages && prefs.languages.length > 0) {
    const matchedLangs = track.language !== undefined ? prefs.languages.filter((l) => l === track.language) : [];
    parts.push({ score: matchedLangs.length > 0 ? 1 : track.isInstrumental ? 0.7 : 0.4 });
  }

  if (parts.length === 0) return { score: 0.5, matchedGenres: [], matchedLangs: [] };
  const score = parts.reduce((sum, p) => sum + p.score, 0) / parts.length;
  const matchedGenres =
    parts.some((p) => p.note === "genre") && prefs.genres
      ? prefs.genres.filter((g) => (track.genres ?? []).includes(g))
      : [];
  const matchedLangs = track.language !== undefined && (prefs.languages ?? []).includes(track.language) ? [track.language] : [];
  return { score, matchedGenres, matchedLangs };
}

function personalScore(track: Track, affinity: AffinityMap): { score: number; trackSum: number; artistSum: number } {
  const trackSum = affinity.track.get(track.id) ?? 0;
  const artistSum = track.artist ? (affinity.artist.get(track.artist) ?? 0) : 0;
  const score = 0.7 * affinityToScore(trackSum) + 0.3 * affinityToScore(artistSum);
  return { score, trackSum, artistSum };
}

function buildReasons(args: {
  track: Track;
  profile: ReturnType<typeof deriveTargetProfile>;
  context: StudyContext;
  components: ScoreComponent[];
  moodMatched: string[];
  matchedGenres: string[];
  matchedLangs: string[];
  personal: { trackSum: number; artistSum: number };
}): string[] {
  const { track, profile, components, moodMatched, matchedGenres, matchedLangs, personal } = args;
  const reasons: string[] = [];

  const contextComp = components.find((c) => c.key === "context");
  if (contextComp && Math.abs(contextComp.score - 0.5) > 0.08) {
    reasons.push(
      `曲目${energyWord(trackEnergy(track))}，${profile.energyReason}`,
    );
  }

  const vocalComp = components.find((c) => c.key === "vocal");
  if (vocalComp && profile.targetVocal !== "any") {
    if (track.isInstrumental || track.vocalDensity === "none") {
      reasons.push("纯音乐没有人声，不会抢走注意力");
    } else if (vocalComp.score >= 0.6) {
      reasons.push("人声轻、歌词少，适合需要专注的时候");
    }
  }

  if (moodMatched.length > 0) {
    const zh = moodMatched.map((m) => MOOD_TAG_ZH[m] ?? m).join("、");
    reasons.push(`曲风情绪偏「${zh}」，契合你现在的状态`);
  }

  if (matchedGenres.length > 0) {
    const zh = matchedGenres.map((g) => GENRE_ZH[g] ?? g).join("、");
    reasons.push(`符合你点名的「${zh}」风格`);
  }
  if (matchedLangs.length > 0) {
    const zh = matchedLangs.map((l) => LANG_ZH[l] ?? l).join("、");
    reasons.push(`是${zh}歌曲，符合你的偏好`);
  }

  if (personal.trackSum > 0.5) {
    reasons.push("你之前喜欢过这首歌");
  } else if (personal.artistSum > 0.5) {
    reasons.push(`你反馈过不错，${track.artist} 的作品适合你`);
  } else if (personal.trackSum < -0.5) {
    reasons.push("你之前跳过/标记过不适合，已明显降权");
  }

  const freshComp = components.find((c) => c.key === "freshness");
  if (freshComp && freshComp.score < 1) {
    reasons.push("最近刚推荐过，这次稍微靠后");
  }

  return reasons;
}

/** 主入口：给定曲目库与情境，返回排序后的可解释推荐。 */
export function recommend(input: RecommendInput): Recommendation[] {
  const {
    tracks,
    context,
    feedbackEvents,
    recentTrackIds = [],
    excludeTrackIds = [],
    limit = 10,
    config = DEFAULT_ENGINE_CONFIG,
    now = new Date(),
  } = input;

  if (tracks.length === 0) return [];

  const profile = deriveTargetProfile(context);
  const artistOfTrack = new Map(tracks.map((t) => [t.id, t.artist] as const));
  // 反馈相关性：发生在相似任务情境下的反馈更值得参考
  const relevance = (event: FeedbackEvent): number => {
    const snapTask = event.contextSnapshot?.task;
    if (snapTask === undefined || context.task === undefined) return 0.7;
    return snapTask === context.task ? 1 : 0.45;
  };
  const affinity = computeAffinity(feedbackEvents, artistOfTrack, now, relevance);
  const excluded = new Set(excludeTrackIds);
  const recent = new Set(recentTrackIds);

  const scored = tracks
    .filter((t) => !excluded.has(t.id))
    .map((track) => {
      const energy = trackEnergy(track);
      const contextScore = 1 - Math.abs(energy - profile.targetEnergy);

      const vScore = vocalScore(track, profile.targetVocal);
      const { score: mScore, matched: moodMatched } = moodScore(track, profile.desiredMoods);
      const { score: pScore, matchedGenres, matchedLangs } = preferenceScore(track, context);
      const personal = personalScore(track, affinity);
      const freshScore = recent.has(track.id) ? 0.35 : 1;

      const components: ScoreComponent[] = [
        { key: "context", score: contextScore, weight: config.weights.context, reason: "" },
        { key: "vocal", score: vScore, weight: config.weights.vocal, reason: "" },
        { key: "mood", score: mScore, weight: config.weights.mood, reason: "" },
        { key: "preference", score: pScore, weight: config.weights.preference, reason: "" },
        { key: "personal", score: personal.score, weight: config.weights.personal, reason: "" },
        { key: "freshness", score: freshScore, weight: config.weights.freshness, reason: "" },
      ];

      // 综合分：个性化分项只允许其"偏离中性"的部分在 cap 内生效
      let total = 0;
      for (const comp of components) {
        let contribution = comp.score * comp.weight * 100;
        if (comp.key === "personal") {
          const deviation = (comp.score - 0.5) * comp.weight * 100;
          const cap = deviation >= 0 ? config.personalCap : config.personalNegativeCap;
          const capped = Math.max(-cap, Math.min(cap, deviation));
          contribution = 0.5 * comp.weight * 100 + capped;
        }
        total += contribution;
      }
      const score = Math.round(Math.min(100, Math.max(0, total)) * 10) / 10;

      const reasons = buildReasons({
        track,
        profile,
        context,
        components,
        moodMatched,
        matchedGenres,
        matchedLangs,
        personal,
      });

      return { track, score, components, reasons };
    })
    .sort((a, b) => b.score - a.score);

  // 简单多样性：同一歌手最多出现 2 首
  const perArtist = new Map<string, number>();
  const results: Recommendation[] = [];
  for (const item of scored) {
    const count = perArtist.get(item.track.artist) ?? 0;
    if (count >= 2) continue;
    perArtist.set(item.track.artist, count + 1);
    results.push({ track: item.track, score: item.score, components: item.components, reasons: item.reasons });
    if (results.length >= limit) break;
  }
  return results;
}
