/**
 * 客户端暂停快捷键模拟。
 *
 * Windows 版网易云客户端不注册 SMTC、也不接受程序唤起，唯一可靠的外部控制入口
 * 是它自己的「全局快捷键」（RegisterHotKey，系统级拦截，与焦点无关）。
 * 交付会话开始时模拟一次用户配置的暂停快捷键，避免 mpv 与客户端两路声音叠放。
 *
 * 前提：用户在客户端 设置→快捷键 里开启同款全局快捷键（默认播放/暂停 Ctrl+P）。
 * 未开启时按键会落到前台应用（StudyMood 自己，无绑定，无害），只是不生效。
 */

export function toSendKeys(combo: string): string | null {
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length < 2) return null; // 必须带修饰键，裸键太危险
  let mods = "";
  const key = (parts[parts.length - 1] ?? "").toLowerCase();
  for (const p of parts.slice(0, -1)) {
    const m = p.toLowerCase();
    if (m === "ctrl") mods += "^";
    else if (m === "alt") mods += "%";
    else if (m === "shift") mods += "+";
    else return null;
  }
  if (/^[a-z0-9]$/.test(key)) return mods + key;
  const f = key.match(/^f([1-9]|1[0-2])$/);
  if (f !== null) return mods + `{F${f[1]}}`;
  return null;
}

async function runPowerShell(script: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeout: 8000, windowsHide: true },
      (err) => (err !== null ? reject(err) : resolve()),
    );
  });
}

/** 模拟一次全局暂停快捷键；combo 非法或按键失败静默失败（调用方不阻塞交付） */
export async function sendPauseHotkey(
  combo: string,
  execImpl: (script: string) => Promise<void> = runPowerShell,
): Promise<void> {
  const keys = toSendKeys(combo);
  if (keys === null) return;
  const script = [
    "try {",
    "  Add-Type -AssemblyName System.Windows.Forms",
    "  [System.Windows.Forms.SendKeys]::SendWait('" + keys + "')",
    "} catch {}",
  ].join("\n");
  try {
    await execImpl(script);
  } catch {
    /* 静默 */
  }
}
