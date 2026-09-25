import type { MusicPrefs, StudyContext, Track } from "../types.js";
import { trackEnergy } from "./engine.js";

/**
 * 由一首曲目构造"基于这首歌"的推荐情境。
 *
 * 场景：用户正在听某首歌，想找感觉类似的歌——不需要描述状态，
 * 曲目自身的特征（能量/人声/流派）就是最直接的情境表达。
 *
 * 能量经三档映射后由引擎走"明确表达"路径（0.25/0.5/0.75），
 * 有量化损失但换来了完全一致的可解释链路：每个推荐理由仍由真实计算生成。
 */
export function contextFromTrack(track: Track): StudyContext {
  const energy = trackEnergy(track);
  const calmness: NonNullable<MusicPrefs["calmness"]> =
    energy < 0.33 ? "calm" : energy < 0.66 ? "balanced" : "energetic";
  const instrumental = track.isInstrumental === true || track.vocalDensity === "none";
  const prefs: MusicPrefs = {
    calmness,
    vocalPreference: instrumental ? "instrumental" : "any",
    genres: track.genres,
  };
  return {
    task: `类似《${track.title}》的感觉`,
    musicPrefs: prefs,
    rawInput: `正在听《${track.title}》- ${track.artist}，想听感觉类似的歌`,
    parserMeta: {
      parser: "rules",
      confidence: 1,
      matched: [`正在播放：《${track.title}》- ${track.artist}`],
      unknowns: [],
    },
  };
}

/**
 * 把检测到的正在播放（标题/歌手）匹配到曲库内的曲目。
 * 匹配从强到弱：标题+歌手精确 → 标题精确 → 标题包含（大小写不敏感）。
 * 匹配不到返回 null，由上层决定如何引导用户（如先导入）。
 */
export function matchPlayingTrack(
  tracks: Track[],
  playing: { title?: string; artist?: string },
): Track | null {
  const title = playing.title?.trim().toLowerCase();
  if (title === undefined || title === "") return null;
  const artist = playing.artist?.trim().toLowerCase();

  const byTitle = tracks.filter((t) => t.title.trim().toLowerCase() === title);
  if (byTitle.length > 0) {
    const exact = byTitle.find((t) => artist !== undefined && t.artist.trim().toLowerCase() === artist);
    return exact ?? byTitle[0] ?? null;
  }
  const contains = tracks.find(
    (t) =>
      t.title.trim().toLowerCase().includes(title) ||
      title.includes(t.title.trim().toLowerCase()),
  );
  return contains ?? null;
}
