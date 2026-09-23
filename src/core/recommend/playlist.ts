import type { Recommendation } from "../types.js";

/**
 * 歌单组装：把排序后的推荐按时长预算装配成一份完整歌单。
 *
 * "我现在精力比较低，要背书 40 分钟" → 预算 40 分钟，
 * 贪心选取高分曲目，单首超出预算过多时跳过（轻量背包）。
 */

export interface Playlist {
  tracks: Recommendation[];
  totalSec: number;
  budgetMin: number;
  /** 因曲库不足没能填满预算时的提示 */
  shortfallSec: number;
}

export const DEFAULT_PLAYLIST_BUDGET_MIN = 30;
/** 单首曲目允许超出剩余预算的上限（秒） */
const OVERSHOOT_TOLERANCE_SEC = 90;

export function buildPlaylist(
  ranked: Recommendation[],
  budgetMin: number | undefined = DEFAULT_PLAYLIST_BUDGET_MIN,
): Playlist {
  const budget = Math.max(5, Math.min(240, budgetMin)) * 60;
  const picked: Recommendation[] = [];
  let totalSec = 0;

  for (const rec of ranked) {
    const dur = rec.track.durationSec;
    if (totalSec + dur <= budget + OVERSHOOT_TOLERANCE_SEC) {
      picked.push(rec);
      totalSec += dur;
    }
    if (totalSec >= budget) break;
  }

  return {
    tracks: picked,
    totalSec,
    budgetMin: Math.round(budget / 60),
    shortfallSec: Math.max(0, budget - totalSec),
  };
}
