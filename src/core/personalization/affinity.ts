import type { FeedbackEvent } from "../types.js";

/**
 * 从反馈历史计算曲目/歌手亲和度。
 *
 * 原则（来自 PRODUCT.md）：
 * - 历史反馈只能"逐渐影响"推荐，不能压过用户当前明确表达的需求；
 *   因此亲和度最终会被引擎的 personalCap 限制。
 * - 反馈随时间衰减，老反馈影响变小。
 */

/** 单类反馈的原始权重 */
const FEEDBACK_WEIGHT: Record<FeedbackEvent["type"], number> = {
  like: 1,
  skip: -0.4,
  not_suitable: -1,
};

/** 反馈半衰期（毫秒）：60 天 */
const HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000;

export interface AffinityMap {
  track: Map<string, number>;
  artist: Map<string, number>;
  /** 曲目 → 歌手名（引擎补充，用于歌手亲和查询） */
  artistOfTrack: Map<string, string>;
}

export function computeAffinity(
  events: FeedbackEvent[],
  artistOfTrack: Map<string, string>,
  now: Date = new Date(),
  relevance?: (event: FeedbackEvent) => number,
): AffinityMap {
  const track = new Map<string, number>();
  const artist = new Map<string, number>();

  for (const event of events) {
    const base = FEEDBACK_WEIGHT[event.type];
    const ageMs = now.getTime() - new Date(event.createdAt).getTime();
    // 指数衰减：每过半衰期权重减半
    const decay = Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
    const scale = relevance ? relevance(event) : 1;
    const weight = base * decay * scale;

    track.set(event.trackId, (track.get(event.trackId) ?? 0) + weight);

    const artistName = artistOfTrack.get(event.trackId);
    if (artistName !== undefined) {
      // 歌手层面的影响减半，避免一首歌封杀/捧红整个歌手
      artist.set(artistName, (artist.get(artistName) ?? 0) + weight * 0.5);
    }
  }
  return { track, artist, artistOfTrack };
}

/** 原始亲和度累加值 → 0..1 分项得分。0.5 为中性。 */
export function affinityToScore(sum: number): number {
  return 0.5 + 0.5 * Math.tanh(sum / 1.5);
}
