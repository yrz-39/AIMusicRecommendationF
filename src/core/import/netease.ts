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

/** 网易云登录态（MUSIC_U cookie），可选：提供后可读取登录账号可见的完整歌单（含私密歌单） */
export interface NeteaseFetchOptions {
  cookie?: string;
  fetchImpl?: typeof fetch;
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

async function getText(url: string, fetchImpl: typeof fetch, cookie?: string): Promise<string> {
  const res = await fetchImpl(url, {
    headers: {
      // 匿名只读公开页面；UA 取普通浏览器值避免被直接拒绝
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Referer: "https://music.163.com/",
      ...(cookie !== undefined && cookie !== "" ? { Cookie: `MUSIC_U=${cookie}` } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`网易云接口返回 ${res.status}`);
  return res.text();
}

export interface NeteaseCookieTestResult {
  ok: boolean;
  /** cookie 有效时返回登录账号昵称，用于向用户确认身份 */
  nickname?: string;
  error?: string;
}

/** 设置页「测试 Cookie」：带 MUSIC_U 查询登录账号，有效返回昵称，无效/过期返回 ok=false */
export async function testNeteaseCookie(
  cookie: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NeteaseCookieTestResult> {
  const trimmed = cookie.trim();
  if (trimmed === "") return { ok: false, error: "Cookie 为空" };
  try {
    const res = await fetchImpl("https://music.163.com/api/nuser/account/get", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Referer: "https://music.163.com/",
        Cookie: `MUSIC_U=${trimmed}`,
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, error: `网易云接口返回 ${res.status}` };
    const data = (await res.json()) as { profile?: { nickname?: string } | null };
    const nickname = data.profile?.nickname;
    if (typeof nickname === "string" && nickname !== "") return { ok: true, nickname };
    return { ok: false, error: "Cookie 已失效或未登录（网易云未返回账号信息）" };
  } catch (err) {
    return { ok: false, error: `请求失败：${(err as Error).message ?? err}` };
  }
}

/** 抓取歌单 → 规范化曲目列表。短链会先跳转，从最终地址提取 id。 */
export async function fetchNeteasePlaylist(
  input: string,
  options: NeteaseFetchOptions = {},
): Promise<NeteasePlaylist> {
  const { cookie, fetchImpl = fetch } = options;
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

  // 主路径：v3 接口的 trackIds 匿名即返回全量（实测；v1 的 tracks 匿名会被截到前 10 首）。
  // 拿到全量 id 后按批走 song/detail 取完整元数据（v1 格式：artists/duration）。
  let name = "网易云歌单";
  let allIds: number[] = [];
  try {
    const v3 = JSON.parse(
      await getText(`https://music.163.com/api/v3/playlist/detail?id=${id}&n=1000`, fetchImpl, cookie),
    ) as {
      playlist?: {
        name?: string;
        trackCount?: number;
        trackIds?: Array<{ id?: number }>;
        tracks?: NeteaseSong[];
      };
    };
    const playlist = v3.playlist;
    if (playlist !== undefined) {
      if (playlist.name?.trim() !== "") name = playlist.name?.trim() ?? name;
      allIds = (playlist.trackIds ?? [])
        .map((x) => x.id)
        .filter((x): x is number => typeof x === "number");
    }
  } catch {
    /* v3 失败时回退 v1 */
  }

  // 回退：v1 detail（官方歌单 tracks 全量；用户歌单匿名只给 10 首 + 无 trackIds）
  let songs: NeteaseSong[] = [];
  if (allIds.length === 0) {
    const v1 = JSON.parse(
      await getText(`https://music.163.com/api/playlist/detail?id=${id}`, fetchImpl, cookie),
    ) as {
      result?: { name?: string; trackCount?: number; tracks?: NeteaseSong[]; trackIds?: Array<{ id?: number }> };
    };
    if (v1.result === undefined) {
      throw new Error(
        cookie !== undefined && cookie !== ""
          ? "已配置登录 Cookie 但仍读不到该歌单：Cookie 可能已失效，请到「设置」重新获取 MUSIC_U"
          : "歌单不存在或未公开（私密歌单需要配置登录 Cookie）",
      );
    }
    if (v1.result.name?.trim() !== "") name = v1.result.name?.trim() ?? name;
    songs = v1.result.tracks ?? [];
    if (Array.isArray(v1.result.trackIds) && v1.result.trackIds.length > 0) {
      allIds = v1.result.trackIds.map((x) => x.id).filter((x): x is number => typeof x === "number");
    }
  }

  // song/detail 批量取详情（每批 50）。若 v1 已返回全量结构完整的详情则直接使用。
  const tracks: Track[] = [];
  const seen = new Set<string>();
  const push = (song: NeteaseSong): void => {
    const t = songToTrack(song);
    if (t !== null && !seen.has(t.id)) {
      seen.add(t.id);
      tracks.push(t);
    }
  };
  const v1Complete = songs.length > 0 && songs.every((s) => typeof s.duration === "number" && (s.artists?.length ?? 0) > 0);
  if (v1Complete && (allIds.length === 0 || songs.length >= allIds.length)) {
    for (const song of songs) push(song);
  } else {
    const ids = allIds.length > 0 ? allIds : songs.map((s) => s.id).filter((x): x is number => typeof x === "number");
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      try {
        const parsed = JSON.parse(
          await getText(
            `https://music.163.com/api/song/detail/?id=${batch[0]}&ids=${encodeURIComponent(JSON.stringify(batch))}`,
            fetchImpl,
            cookie,
          ),
        ) as { songs?: NeteaseSong[] };
        for (const song of parsed.songs ?? []) push(song);
      } catch {
        /* 单批失败跳过，不让整单导入卡死 */
      }
    }
  }

  if (tracks.length === 0) {
    throw new Error(
      allIds.length > 0
        ? "歌单里的歌曲详情读取失败（网易云可能临时限流，稍后重试）"
        : "歌单里没有可导入的歌曲",
    );
  }
  return { id, name, tracks };
}
