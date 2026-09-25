import type { Track } from "../types.js";

/**
 * 网易云公开歌单导入（零凭据）。
 *
 * 只访问 music.163.com 的公开匿名接口，读取歌单名与歌曲元数据
 * （歌名/歌手/专辑/时长），不涉及音频、不需要 Cookie、不模拟登录。
 * 隐私：向网易发送的只有用户主动粘贴的歌单 id。
 */

export interface NeteasePlaylist {
  id: string;
  name: string;
  tracks: Track[];
}

/** 从分享文本/链接/纯 id 中提取歌单 id（支持 music.163.com 长链与 163cn.tv 短链跳转后的链接） */
export function extractPlaylistId(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (/^\d{6,}$/.test(text)) return text; // 纯 id
  const m = text.match(/playlist\?id=(\d+)/) ?? text.match(/[?&]id=(\d+)/);
  return m?.[1] ?? null;
}

interface NeteaseSong {
  id?: number;
  name?: string;
  duration?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
}

function songToTrack(song: NeteaseSong): Track | null {
  if (typeof song.id !== "number" || typeof song.name !== "string" || song.name.trim() === "") return null;
  const artistNames = (song.artists ?? [])
    .map((a) => a.name?.trim())
    .filter((n): n is string => n !== undefined && n !== "");
  return {
    id: `ne-${song.id}`,
    title: song.name.trim(),
    artist: artistNames.length > 0 ? artistNames.join("/") : "未知歌手",
    album: song.album?.name?.trim() || undefined,
    durationSec: typeof song.duration === "number" && song.duration > 0 ? Math.round(song.duration / 1000) : 0,
    source: { kind: "netease" },
    netease: { songId: song.id },
  };
}

async function getText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    headers: {
      // 匿名只读公开页面；UA 取普通浏览器值避免被直接拒绝
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Referer: "https://music.163.com/",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`网易云接口返回 ${res.status}`);
  return res.text();
}

/** 抓取公开歌单 → 规范化曲目列表。短链会先跳转，从最终地址提取 id。 */
export async function fetchNeteasePlaylist(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NeteasePlaylist> {
  let id = extractPlaylistId(input);
  if (id === null && /163cn\.tv|music\.163\.com/.test(input.trim())) {
    // 短链：跟随跳转后从最终 URL 提取
    try {
      const res = await fetchImpl(input.trim(), { redirect: "follow", signal: AbortSignal.timeout(15000) });
      id = extractPlaylistId(res.url);
    } catch {
      /* 保持 null，走统一报错 */
    }
  }
  if (id === null) {
    throw new Error("无法识别歌单链接：请粘贴网易云歌单的分享链接或纯数字 id");
  }

  const detail = JSON.parse(await getText(`https://music.163.com/api/playlist/detail?id=${id}`, fetchImpl)) as {
    result?: { name?: string; trackCount?: number; tracks?: NeteaseSong[]; trackIds?: Array<{ id?: number }> };
  };
  const result = detail.result;
  if (result === undefined) throw new Error("歌单不存在或未公开（私密歌单无法匿名读取）");

  const name = result.name?.trim() || "网易云歌单";
  const songs: NeteaseSong[] = result.tracks ?? [];
  const total = result.trackCount ?? songs.length;
  const tracks: Track[] = [];
  const seen = new Set<string>();
  for (const song of songs) {
    const t = songToTrack(song);
    if (t !== null && !seen.has(t.id)) {
      seen.add(t.id);
      tracks.push(t);
    }
  }

  // 个别歌单 tracks 不全（只回部分详情 + trackIds 全量）：补齐缺失部分
  if (tracks.length < total && Array.isArray(result.trackIds) && result.trackIds.length > 0) {
    const have = new Set(tracks.map((t) => t.id));
    const missingIds = result.trackIds
      .map((x) => x.id)
      .filter((x): x is number => typeof x === "number" && !have.has(`ne-${x}`));
    for (let i = 0; i < missingIds.length; i += 50) {
      const batch = missingIds.slice(i, i + 50);
      try {
        const detailText = await getText(
          `https://music.163.com/api/song/detail/?id=${batch[0]}&ids=${encodeURIComponent(JSON.stringify(batch))}`,
          fetchImpl,
        );
        const parsed = JSON.parse(detailText) as { songs?: NeteaseSong[] };
        for (const song of parsed.songs ?? []) {
          const t = songToTrack(song);
          if (t !== null && !seen.has(t.id)) {
            seen.add(t.id);
            tracks.push(t);
          }
        }
      } catch {
        /* 单批失败跳过，不让整单导入卡死 */
      }
    }
  }

  if (tracks.length === 0) throw new Error("歌单里没有可导入的歌曲");
  return { id, name, tracks };
}
