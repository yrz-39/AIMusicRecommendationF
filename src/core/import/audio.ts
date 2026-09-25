import type { Track } from "../types.js";
import { normalizeGenres } from "./genreMap.js";

/**
 * 本地音频文件导入（M3）：标签 → 曲目装配与校验。
 *
 * 纯函数：tags 来自 music-metadata 的浏览器端解析（File/Blob 不经过后端）。
 * 文件名兜底：大量本地音频的元数据缺失或错误，"歌手 - 歌名.mp3" 是最常见的可靠信号。
 */

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  genres?: string[];
  language?: string;
}

export interface AssembledAudio {
  fileName: string;
  track?: Track;
  reason?: string;
}

/** 从 "歌手 - 歌名.mp3" 类文件名推断（兼容 - – — 与 " - " 混排），无法拆分时整个作为歌名 */
export function parseAudioFileName(fileName: string): { title: string; artist?: string } {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/_\s*$/, "").trim();
  const parts = base.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length >= 2) {
    return { artist: parts[0] ?? "", title: parts.slice(1).join(" - ") };
  }
  return { title: base };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function trackIdFromAudio(title: string, artist: string): string {
  return `audio-${slugify(artist) || "unknown"}-${slugify(title) || "untitled"}`;
}

/** 组装单首曲目；信息不足/时长缺失时给出拒绝原因（绝不静默导入坏数据） */
export function assembleTrack(fileName: string, tags: AudioTags): AssembledAudio {
  const fromName = parseAudioFileName(fileName);
  const title = tags.title?.trim() || fromName.title;
  const artist = tags.artist?.trim() || fromName.artist;
  if (title === "") return { fileName, reason: "没有歌名（标签与文件名都无法提供）" };
  if (artist === undefined || artist === "") return { fileName, reason: "没有歌手（标签与文件名都无法提供）" };
  if (typeof tags.durationSec !== "number" || !Number.isFinite(tags.durationSec) || tags.durationSec <= 0) {
    return { fileName, reason: "无法读取时长（文件可能损坏或格式不支持）" };
  }
  const genres = normalizeGenres(tags.genres);
  return {
    fileName,
    track: {
      id: trackIdFromAudio(title, artist),
      title,
      artist,
      album: tags.album?.trim() || undefined,
      durationSec: Math.round(tags.durationSec),
      genres,
      source: { kind: "manual" },
    },
  };
}
