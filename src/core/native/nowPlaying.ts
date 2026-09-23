import { execFile } from "node:child_process";

/**
 * 正在播放检测（零凭据原型）。
 *
 * 原理：网易云/QQ 音乐桌面客户端播放时，主窗口标题会变成
 * "歌名 - 歌手 - 网易云音乐" / "歌名 - 歌手 - QQ音乐"。
 * 通过 PowerShell 枚举可见窗口标题并解析。
 *
 * 这是实验性模块：失败一律优雅降级为 { playing: false }，
 * 绝不让主流程崩溃。Electron 阶段可换原生 API 获得更稳的信号。
 */

export interface NowPlaying {
  playing: boolean;
  title?: string;
  artist?: string;
  source?: "netease" | "qq" | "unknown";
  rawTitle?: string;
}

/** 客户端窗口标题的尾部标记 → 来源 */
const SOURCE_MARKERS: Array<{ marker: string; source: NonNullable<NowPlaying["source"]> }> = [
  { marker: "网易云音乐", source: "netease" },
  { marker: "CloudMusic", source: "netease" },
  { marker: "QQ音乐", source: "qq" },
  { marker: "QQMusic", source: "qq" },
];

export function parseWindowTitle(raw: string): NowPlaying | null {
  const text = raw.trim();
  if (text === "") return null;
  const source = SOURCE_MARKERS.find((m) => text.includes(m.marker))?.source;
  if (source === undefined) return null;

  // 去掉尾部客户端标记，剩余按 " - " 切分
  let cleaned = text;
  for (const m of SOURCE_MARKERS) {
    cleaned = cleaned.replace(new RegExp(`[-—|]*\\s*${m.marker}\\s*$`), "");
  }
  const parts = cleaned.split(/\s+-\s+|\s+—\s+/).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return null;

  const title = parts[0];
  if (title === undefined || title === "") return null;
  // 常见非播放状态标题
  if (/^(网易云音乐|CloudMusic|QQ音乐)$/.test(title)) return null;

  return {
    playing: true,
    title,
    artist: parts[1],
    source,
    rawTitle: text,
  };
}

function listWindowTitles(): Promise<string[]> {
  return new Promise((resolve) => {
    const script =
      "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.MainWindowTitle }";
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5000, windowsHide: true, encoding: "utf8" },
      (err, stdout) => {
        if (err !== null || stdout === undefined) {
          resolve([]);
          return;
        }
        resolve(stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ""));
      },
    );
  });
}

export async function detectNowPlaying(): Promise<NowPlaying> {
  const titles = await listWindowTitles();
  for (const title of titles) {
    const parsed = parseWindowTitle(title);
    if (parsed !== null) return parsed;
  }
  return { playing: false };
}
