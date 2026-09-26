import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 网易云官方 ncm-cli 适配层（@music163/ncm-cli，2026-03 官方发布）。
 *
 * 职责：把 ncm-cli 的命令行面封装成类型化接口，供「在网易云播放」「小窗遥控」
 * 与「歌单补位搜索」使用。命令面以 0.1.7 实测为准：
 *   search song --keyword K        → JSON，含加密 ID（32 hex）与原始 ID（数字）
 *   play --song --encrypted-id E --original-id O
 *   queue add --encrypted-id E --original-id O [--next] / queue clear
 *   pause / resume / stop / next / prev / state / login --check / config set|list
 *
 * 所有命令默认输出 JSON；解析做防御性兜底（CLI 尚在 0.1.x，字段名可能变动）。
 * runner 可注入：测试不真正起子进程；生产 runner 负责解析可执行文件路径并调用。
 */

export interface NcmRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type NcmRunner = (args: string[], timeoutMs: number) => Promise<NcmRunResult>;

export interface NcmSong {
  /** 32 位 hex，API 播放用 */
  encryptedId: string;
  /** 数字明文 id，唤起客户端用 */
  originalId: string;
  title: string;
  artist: string;
  album?: string;
  /** 秒；搜索结果缺失时为 undefined */
  durationSec?: number;
}

export interface NcmState {
  status: string;
  playing: boolean;
  raw: unknown;
}

export interface NcmConfigStatus {
  appIdSet: boolean;
  player: string | null;
}

export interface NcmClient {
  version(): Promise<string | null>;
  configStatus(): Promise<NcmConfigStatus>;
  setCredentials(appId: string, privateKey: string): Promise<void>;
  /** 登录检查（0.1.7 起顺带自动续期 token） */
  loginCheck(): Promise<{ loggedIn: boolean; message: string }>;
  searchSong(keyword: string, limit?: number): Promise<NcmSong[]>;
  playSong(song: NcmSong): Promise<void>;
  queueAdd(song: NcmSong, opts?: { next?: boolean }): Promise<void>;
  queueClear(): Promise<void>;
  control(action: "pause" | "resume" | "stop" | "next" | "prev"): Promise<void>;
  state(): Promise<NcmState>;
}

/** 从混合 JSON 里提取歌曲数组（兼容 root 数组 / result.songs / data.records / songs / data 等形态） */
export function extractSongArray(payload: unknown): Array<Record<string, unknown>> {
  const candidateOf = (v: unknown): Array<Record<string, unknown>> | null => {
    if (!Array.isArray(v)) return null;
    return v.filter(
      (x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x),
    );
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return candidateOf(payload) ?? [];
  }
  const obj = payload as Record<string, unknown>;
  for (const key of ["songs", "result", "data", "list", "items"]) {
    const v = obj[key];
    if (Array.isArray(v)) return candidateOf(v) ?? [];
    if (v !== null && typeof v === "object") {
      // 0.1.7 真实返回 data: { recordCount, records: [...] }
      const inner = (v as Record<string, unknown>).songs ?? (v as Record<string, unknown>).records ?? (v as Record<string, unknown>).list;
      const arr = candidateOf(inner);
      if (arr !== null && arr.length > 0) return arr;
    }
  }
  return [];
}

const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** ID 字段兼容 number 与纯数字字符串两种形态 */
const asIdNum = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
};

/** 单个搜索结果对象 → NcmSong；字段名防御性兼容。
 *  0.1.7 真实形态：{ originalId: number, id: "32位HEX"(加密ID), name, artists: [{name}], album: {name}, duration(ms), playFlag } */
export function parseNcmSong(item: Record<string, unknown>): NcmSong | null {
  const asHexId = (v: unknown): string | undefined =>
    typeof v === "string" && /^[0-9a-f]{16,64}$/i.test(v.trim()) ? v.trim() : undefined;
  const encryptedId = asStr(item.encryptedId) ?? asStr(item.encrypted_id) ?? asHexId(item.id);
  const originalIdRaw = asIdNum(item.originalId) ?? asIdNum(item.original_id) ?? asIdNum(item.songId);
  const title = asStr(item.name) ?? asStr(item.title);
  if (encryptedId === undefined || originalIdRaw === undefined || title === undefined) return null;

  // 无版权/不可播放的歌搜到了也没法播，直接过滤
  if (item.playFlag === false) return null;
  if (item.noCopyrightRcmd !== null && item.noCopyrightRcmd !== undefined) return null;

  let artist = "";
  if (Array.isArray(item.artists)) {
    artist = item.artists
      .map((a) => (a !== null && typeof a === "object" ? asStr((a as Record<string, unknown>).name) : undefined))
      .filter((n): n is string => n !== undefined)
      .join("/");
  } else if (item.ar !== null && typeof item.ar === "object") {
    artist = asStr((item.ar as Record<string, unknown>).name) ?? "";
  } else if (item.artist !== null && typeof item.artist === "object") {
    artist = asStr((item.artist as Record<string, unknown>).name) ?? "";
  } else {
    artist = asStr(item.artist) ?? "";
  }

  let album: string | undefined;
  if (item.album !== null && typeof item.album === "object") album = asStr((item.album as Record<string, unknown>).name);
  else if (item.al !== null && typeof item.al === "object") album = asStr((item.al as Record<string, unknown>).name);
  else album = asStr(item.album);

  const durationMs = asNum(item.duration) ?? asNum(item.dt);
  return {
    encryptedId,
    originalId: String(originalIdRaw),
    title,
    artist: artist || "未知歌手",
    album,
    durationSec: durationMs !== undefined && durationMs > 0 ? Math.round(durationMs / 1000) : undefined,
  };
}

/** 宽松解析 CLI 的 stdout JSON（容忍前后噪音行），失败返回 null */
export function parseJsonOutput(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const startArr = stdout.indexOf("[");
  const from = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (from === -1) return null;
  const end = Math.max(stdout.lastIndexOf("}"), stdout.lastIndexOf("]"));
  if (end <= from) return null;
  try {
    return JSON.parse(stdout.slice(from, end + 1));
  } catch {
    return null;
  }
}

function parseConfigList(stdout: string): NcmConfigStatus {
  const appIdSet = /^(appId):\s*\S+/m.test(stdout) && !/appId:\s*\S*未配置/.test(stdout);
  const playerMatch = stdout.match(/^player:\s*(.+)$/m);
  const playerRaw = playerMatch?.[1]?.trim() ?? "";
  const player = playerRaw !== "" && !playerRaw.includes("未配置") ? playerRaw : null;
  return { appIdSet, player };
}

/** 默认 runner：解析 ncm-cli 可执行文件路径 → 优先 node 直跑其 JS 入口，兜底 shell 调用 */
export function resolveNcmBin(): string | null {
  const override = process.env.STUDYMOOD_NCM_CLI_PATH?.trim();
  if (override !== undefined && override !== "" && override.length > 0) return override;
  const isWin = process.platform === "win32";
  try {
    const found = execSync(isWin ? "where ncm-cli" : "which ncm-cli", { encoding: "utf8", timeout: 5000 })
      .split(/\r?\n/)
      .map((l: string) => l.trim())
      .find((l: string) => l !== "");
    if (found !== undefined) return found;
  } catch {
    /* where/which 找不到继续猜常见路径 */
  }
  if (isWin && process.env.APPDATA !== undefined) {
    const guess = path.join(process.env.APPDATA, "npm", "ncm-cli.cmd");
    if (existsSync(guess)) return guess;
  }
  return null;
}

function shellQuote(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * 解析 npm .cmd shim 指向的真实 JS 入口（如 %APPDATA%\npm\node_modules\@music163\ncm-cli\dist\index.js）。
 * 直接用 node 跑 JS 而不是过 cmd.exe：批处理 %* 对中文参数会按 ANSI 转码产生乱码，
 * 且 cmd /c 对带引号路径的引号剥离规则脆弱。找不到目标时返回 null（走 shell 兜底）。
 */
export function resolveCmdShimTarget(binPath: string): string | null {
  try {
    const content = readFileSync(binPath, "utf8");
    // 带引号（路径可含空格）与不带引号两种 shim 形态；避免贪婪匹配把 %* 之类吞进路径
    const m =
      content.match(/node(?:\.exe)?"?\s+"([^"\r\n]+\.(?:js|mjs|cjs))"/i) ??
      content.match(/node(?:\.exe)?"?\s+(\S+\.(?:js|mjs|cjs))/i);
    if (m?.[1] !== undefined) {
      const expanded = m[1]
        .replace(/%~dp0/gi, path.dirname(binPath) + path.sep)
        .replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? "");
      const resolved = path.resolve(expanded.trim());
      if (existsSync(resolved)) return resolved;
    }
    // npm 全局 shim 的标准布局兜底
    const sibling = path.join(path.dirname(binPath), "node_modules", "@music163", "ncm-cli", "dist", "index.js");
    return existsSync(sibling) ? sibling : null;
  } catch {
    return null;
  }
}

export function createDefaultRunner(): NcmRunner {
  let cachedBin: string | null | undefined;
  const bin = async (): Promise<string | null> => {
    if (cachedBin === undefined) cachedBin = resolveNcmBin();
    return cachedBin;
  };
  return async (args, timeoutMs) => {
    const binPath = await bin();
    if (binPath === null) return { code: 127, stdout: "", stderr: "ncm-cli 未找到（请先 npm install -g @music163/ncm-cli）" };

    // 首选：解析到真实 JS 入口 → node 直接跑（参数走 UTF-16，无 cmd 转码/引号问题）
    const ext = path.extname(binPath).toLowerCase();
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      return runNode(process.execPath, [binPath, ...args], timeoutMs);
    }
    if (ext === ".cmd" || ext === ".bat") {
      const script = resolveCmdShimTarget(binPath);
      if (script !== null) return runNode(process.execPath, [script, ...args], timeoutMs);
    }
    // 兜底：shell 直跑（Unix shebang 脚本或无法解析的 shim）
    return new Promise((resolve) => {
      const child = spawn([binPath, ...args].map(shellQuote).join(" "), {
        shell: true,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: `${stderr}${String(err)}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  };
}

/** 用 node 执行 ncm-cli 的 JS 入口。打包版 process.execPath 是 Electron，需要 ELECTRON_RUN_AS_NODE=1 */
function runNode(execPath: string, args: string[], timeoutMs: number): Promise<NcmRunResult> {
  return new Promise((resolve) => {
    const child = spawn(execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${String(err)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function createNcmClient(runner: NcmRunner): NcmClient {
  /**
   * 播放后端。Windows 版网易云客户端不支持 orpheus 唤起（实测仅 macOS），
   * 因此固定走 ncm-cli 内置 mpv；环境变量可覆盖以便 macOS 用户选 orpheus。
   */
  const playerArgs = ["--player", process.env.STUDYMOOD_NCM_PLAYER?.trim() || "mpv"];

  /** 跑一条命令并要求成功；失败抛错（上层决定如何降级） */
  const run = async (args: string[], timeoutMs = 20000): Promise<unknown> => {
    const res = await runner(args, timeoutMs);
    if (res.code !== 0) {
      throw new Error(`ncm-cli ${args[0]} 失败：${res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`}`);
    }
    const parsed = parseJsonOutput(res.stdout);
    // CLI 对业务失败也返回 exit 0（如未登录时搜索），必须看 success 字段
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as { success?: unknown; message?: unknown; code?: unknown };
      if (o.success === false && typeof o.message === "string") {
        throw new Error(o.message);
      }
    }
    return parsed;
  };

  const client: NcmClient = {
    async version() {
      const res = await runner(["--version"], 10000);
      if (res.code !== 0) return null;
      return res.stdout.trim() || null;
    },

    async configStatus() {
      const res = await runner(["config", "list"], 10000);
      if (res.code !== 0) return { appIdSet: false, player: null };
      return parseConfigList(res.stdout);
    },

    async setCredentials(appId, privateKey) {
      for (const [key, value] of [
        ["appId", appId],
        ["privateKey", privateKey],
      ] as const) {
        const res = await runner(["config", "set", key, value], 15000);
        if (res.code !== 0) throw new Error(`写入 ncm-cli 配置失败（${key}）：${res.stderr.trim() || res.stdout.trim()}`);
      }
    },

    async loginCheck() {
      const out = await run(["login", "--check"], 20000);
      const o = (out ?? {}) as { success?: boolean; message?: string; loggedIn?: boolean };
      const loggedIn = o.success === true || o.loggedIn === true;
      return { loggedIn, message: o.message ?? (loggedIn ? "已登录" : "未登录，请在终端运行 ncm-cli login 扫码") };
    },

    async searchSong(keyword, limit = 10) {
      const out = await run(["search", "song", "--keyword", keyword], 30000);
      const arr = extractSongArray(out);
      return arr
        .map(parseNcmSong)
        .filter((s): s is NcmSong => s !== null)
        .slice(0, limit);
    },

    async playSong(song) {
      await run(["play", "--song", ...playerArgs, "--encrypted-id", song.encryptedId, "--original-id", song.originalId], 30000);
    },

    async queueAdd(song, opts) {
      const args = ["queue", "add", ...playerArgs, "--encrypted-id", song.encryptedId, "--original-id", song.originalId];
      if (opts?.next === true) args.push("--next");
      await run(args, 30000);
    },

    async queueClear() {
      await run(["queue", "clear"], 20000);
    },

    async control(action) {
      await run([action], 20000);
    },

    async state() {
      const out = await run(["state"], 15000);
      const o = (out ?? {}) as { state?: { status?: string } };
      const status = typeof o.state?.status === "string" ? o.state.status : "unknown";
      return { status, playing: status === "playing", raw: out };
    },
  };
  return client;
}
