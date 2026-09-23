import type { Track } from "../types.js";

/**
 * 音乐库导入校验：把不可信的外部数据（JSON/CSV 行）安全映射为 Track。
 * M3 的第一个导入器（JSON/CSV），字段缺失时尽量兜底而不是整行拒绝。
 */

export interface ImportResult {
  accepted: Track[];
  rejected: Array<{ row: number; reason: string }>;
}

export interface ImportOptions {
  /** 已存在的曲目 id，用于去重（重复 id 的行会被拒绝） */
  existingIds?: Set<string>;
  source?: Track["source"];
}

export function validateImportRows(rows: unknown, options: ImportOptions = {}): ImportResult {
  const result: ImportResult = { accepted: [], rejected: [] };
  if (!Array.isArray(rows)) {
    result.rejected.push({ row: -1, reason: "导入内容必须是数组" });
    return result;
  }
  const existing = options.existingIds ?? new Set<string>();
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    try {
      if (typeof row !== "object" || row === null) throw new Error("不是对象");
      const r = row as Record<string, unknown>;

      const title = str(r.title ?? r.name ?? r.歌名);
      if (!title) throw new Error("缺少歌名 title");
      const artist = str(r.artist ?? r.singer ?? r.artists ?? r.歌手);
      if (!artist) throw new Error("缺少歌手 artist");
      const durationSec = parseDuration(r.durationSec ?? r.duration ?? r["时长"]);
      if (durationSec === undefined || durationSec <= 0 || durationSec > 3600) {
        throw new Error("时长 durationSec 无效");
      }

      const id = str(r.id) || slugify(`${title}-${artist}`);
      if (seen.has(id) || existing.has(id)) throw new Error(`id 重复: ${id}`);
      seen.add(id);

      const energyRaw = num(r.energy);
      const track: Track = {
        id,
        title,
        artist: Array.isArray(r.artists) ? artist : artist,
        album: str(r.album) || undefined,
        durationSec,
        language: str(r.language ?? r.lang) || undefined,
        isInstrumental: bool(r.isInstrumental) || str(r.language) === "instrumental",
        genres: strArray(r.genres ?? r.genre ?? r.tags),
        energy: energyRaw === undefined ? undefined : clamp(energyRaw, 0, 1),
        moodTags: strArray(r.moodTags ?? r.moods),
        vocalDensity: parseVocalDensity(r.vocalDensity),
        source: options.source ?? { kind: "json", importedAt: new Date().toISOString() },
        netease: {
          songId: intOrNull(r.neteaseSongId ?? (r.netease as Record<string, unknown> | undefined)?.songId),
          searchKeyword: str(r.neteaseSearchKeyword) || `${title} ${artist}`,
        },
      };
      result.accepted.push(track);
    } catch (err) {
      result.rejected.push({ row: index, reason: (err as Error).message });
    }
  });
  return result;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function intOrNull(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined || !Number.isInteger(n) ? undefined : n;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  if (typeof v === "string") {
    return v.split(/[,，;；/|]/).map((s) => s.trim()).filter((s) => s !== "");
  }
  return [];
}

function parseVocalDensity(v: unknown): Track["vocalDensity"] {
  const s = str(v).toLowerCase();
  if (["none", "low", "medium", "high"].includes(s)) return s as Track["vocalDensity"];
  return undefined;
}

/** 支持 "3:45" / "225" / 225 秒三种形式 */
function parseDuration(v: unknown): number | undefined {
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2}):([0-5]?\d)$/);
    if (m && m[1] !== undefined && m[2] !== undefined) return Number(m[1]) * 60 + Number(m[2]);
  }
  return num(v);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function slugify(text: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `track-${Date.now().toString(36)}`;
}
