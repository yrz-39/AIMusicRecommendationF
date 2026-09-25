import { execFile } from "node:child_process";

/**
 * 正在播放检测（零凭据）。
 *
 * 优先走 Windows 系统媒体会话（SMTC, GlobalSystemMediaTransportControls）：
 * 这是操作系统的"正在播放"官方通道，桌面客户端最小化到托盘、
 * 网易云/QQ 音乐网页版、其他播放器（Spotify 等）都能覆盖。
 *
 * 兜底走窗口标题解析："歌名 - 歌手 - 网易云音乐"（覆盖 SMTC 不可用的场景）。
 *
 * 失败一律优雅降级为 { playing: false }，绝不让主流程崩溃。
 */

export interface NowPlaying {
  playing: boolean;
  title?: string;
  artist?: string;
  source?: "netease" | "qq" | "unknown";
  rawTitle?: string;
  /** SMTC 会话来源应用（AUMID），如 "Netease.CloudMusicMusic_daewk...";  */
  sourceApp?: string;
  /** 检测通道 */
  via?: "media-session" | "window-title";
}

/** 客户端窗口标题的尾部标记 → 来源 */
const SOURCE_MARKERS: Array<{ marker: string; source: NonNullable<NowPlaying["source"]> }> = [
  { marker: "网易云音乐", source: "netease" },
  { marker: "CloudMusic", source: "netease" },
  { marker: "QQ音乐", source: "qq" },
  { marker: "QQMusic", source: "qq" },
];

/** SMTC 会话的 AUMID → 来源（不认识的播放器归为 unknown，仍然可用） */
export function sourceFromAppId(appId?: string): NonNullable<NowPlaying["source"]> {
  const id = appId ?? "";
  if (/cloudmusic|netease/i.test(id)) return "netease";
  if (/qqmusic|tencent.*music/i.test(id)) return "qq";
  return "unknown";
}

/** 解析 SMTC PowerShell 脚本的 JSON 输出（容忍 PS 5.1 单元素数组 unwrap 与空输出） */
export interface MediaSessionInfo {
  title: string;
  artist?: string;
  status: string;
  sourceApp?: string;
}

export function parseMediaSessions(raw: string): MediaSessionInfo[] {
  const text = raw.trim();
  if (text === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === "object" ? [parsed] : [];
  const out: MediaSessionInfo[] = [];
  for (const item of arr) {
    const s = item as { title?: unknown; artist?: unknown; status?: unknown; sourceApp?: unknown };
    if (typeof s.title !== "string" || s.title.trim() === "") continue;
    if (typeof s.status !== "string") continue;
    out.push({
      title: s.title.trim(),
      artist: typeof s.artist === "string" && s.artist.trim() !== "" ? s.artist.trim() : undefined,
      status: s.status,
      sourceApp: typeof s.sourceApp === "string" && s.sourceApp !== "" ? s.sourceApp : undefined,
    });
  }
  return out;
}

/** 从媒体会话中选出正在播放、且带有效曲目信息的会话 */
export function pickPlayingSession(sessions: MediaSessionInfo[]): MediaSessionInfo | null {
  return (
    sessions.find((s) => s.status === "Playing" && !/^(未在播放|正在播放)$/.test(s.title)) ?? null
  );
}

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
    via: "window-title",
  };
}

/**
 * 新版客户端主窗口标题不再带「网易云音乐」后缀（如「歌名 - 歌手」），
 * 托盘最小化时窗口仍在（隐藏但标题可读）。因此按所属进程识别来源，
 * 客户端进程的任何非默认标题都视为播放信息。
 */
export function parseProcessWindow(processName: string, title: string): NowPlaying | null {
  const proc = processName.toLowerCase();
  const known = SOURCE_MARKERS.find(
    (m) =>
      (m.source === "netease" && /cloudmusic|netease/i.test(proc)) ||
      (m.source === "qq" && /qqmusic|tencent.*music/i.test(proc)),
  );
  if (known === undefined) return null;

  // 客户端自己的通用标题（未在播放/主界面）不当作歌名
  if (/^(网易云音乐|CloudMusic|QQ音乐)\s*[-—|]?\s*$/.test(title.trim())) return null;
  const byMarker = parseWindowTitle(title);
  if (byMarker !== null) return byMarker;

  const parts = title.trim().split(/\s+-\s+|\s+—\s+/).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return null;
  const first = parts[0];
  if (first === undefined || first === "") return null;
  return {
    playing: true,
    title: first,
    artist: parts[1],
    source: known.source,
    rawTitle: title,
    via: "window-title",
  };
}

function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    // EncodedCommand 规避引号/反引号转义问题；脚本内部自行把输出流切到 UTF-8
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        resolve(err !== null || stdout === undefined ? "" : String(stdout));
      },
    );
  });
}

/** 系统媒体会话（SMTC）：覆盖托盘化客户端与网页版播放 */
async function detectViaMediaSession(): Promise<NowPlaying | null> {
  const script = [
    "try {",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]",
    "  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    "  function Await($op, $t) { $m = $asTask.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }",
    "  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])",
    "  $out = @()",
    "  foreach ($s in $mgr.GetSessions()) {",
    "    try {",
    "      $props = Await ($s.TryGetTextPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionTextProperties])",
    "      $pb = $s.GetPlaybackInfo()",
    "      $out += [pscustomobject]@{ title = [string]$props.Title; artist = [string]$props.Artist; status = [string]$pb.PlaybackStatus; sourceApp = [string]$s.SourceAppUserModelId }",
    "    } catch {}",
    "  }",
    "  ConvertTo-Json -InputObject @($out) -Compress",
    "} catch { Write-Output '[]' }",
  ].join("\n");
  const raw = await runPowerShell(script, 6000);
  const session = pickPlayingSession(parseMediaSessions(raw));
  if (session === null) return null;
  return {
    playing: true,
    title: session.title,
    artist: session.artist,
    source: sourceFromAppId(session.sourceApp),
    rawTitle: [session.title, session.artist].filter(Boolean).join(" - "),
    sourceApp: session.sourceApp,
    via: "media-session",
  };
}

function listProcessWindows(): Promise<Array<{ process: string; title: string }>> {
  return new Promise((resolve) => {
    // 中文 Windows 上 PowerShell 默认按 GBK 输出，Node 按 UTF-8 解码会全部乱码，
    // 必须先显式切换输出流编码（实测缺失时永远检测不到窗口标题）。
    const script =
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
      "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { \"$($_.ProcessName)|$($_.MainWindowTitle)\" }";
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5000, windowsHide: true, encoding: "utf8" },
      (err, stdout) => {
        if (err !== null || stdout === undefined) {
          resolve([]);
          return;
        }
        resolve(
          stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l !== "")
            .map((line) => {
              const sep = line.indexOf("|");
              return sep > 0
                ? { process: line.slice(0, sep), title: line.slice(sep + 1) }
                : { process: "", title: line };
            }),
        );
      },
    );
  });
}

export async function detectNowPlaying(): Promise<NowPlaying> {
  try {
    const viaSession = await detectViaMediaSession();
    if (viaSession !== null) return viaSession;
  } catch {
    /* SMTC 不可用时回落窗口标题 */
  }
  const windows = await listProcessWindows();
  for (const w of windows) {
    const parsed = parseProcessWindow(w.process, w.title);
    if (parsed !== null) return parsed;
  }
  return { playing: false };
}
