import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "node:path";
import { appendFileSync, existsSync } from "node:fs";
import os from "node:os";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp, seedSampleIfFirstRun } from "../src/server/app.js";
import { JsonFileStore } from "../src/storage/jsonStore.js";
import { loadDotEnv, readLlmConfig } from "../src/config/env.js";

/**
 * 主进程崩溃/生命周期日志：写入系统日志目录（本地优先，无遥测，日志留在本机）。
 * 打包版主进程 stdout 不可见，这是排障的唯一线索来源。
 */
function logFile(): string {
  try {
    return path.join(app.getPath("logs"), "main.log");
  } catch {
    // app ready 之前 getPath("logs") 可能不可用
    return path.join(os.tmpdir(), "studymood-main.log");
  }
}

function log(msg: string): void {
  try {
    const file = logFile();
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

log("--- main.cjs loading ---");
process.on("uncaughtException", (err) => log(`uncaught: ${err.stack ?? err.message}`));
process.on("unhandledRejection", (err) => log(`unhandled: ${String(err)}`));

/**
 * StudyMood DJ 桌面壳。
 *
 * 架构：Electron 主进程内启动与 Web 版完全相同的 Hono API（复用 createApp），
 * BrowserWindow 直接加载 http://127.0.0.1:<port>/，渲染层零改动、主题一致。
 * 数据目录：开发期沿用项目 data/；打包后用系统 userData 目录。
 * 小窗模式：单窗口在 主页面(1000x800) ↔ 桌面小窗(380x640, 置顶) 间切换。
 */

const MAIN_SIZE = { width: 1000, height: 800 };
const MINI_SIZE = { width: 380, height: 640 };

let mainWindow: BrowserWindow | null = null;

function pickPort(preferred: number): Promise<number> {
  const { createServer } = require("node:net") as typeof import("node:net");
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => {
      // 首选端口被占（例如用户开着 npm start），顺延尝试
      if (preferred < 8795) resolve(pickPort(preferred + 1));
      else reject(new Error("no free port"));
    });
    probe.once("listening", () => {
      probe.close(() => resolve(preferred));
    });
    probe.listen(preferred, "127.0.0.1");
  });
}

async function startApi(): Promise<number> {
  log("startApi begin");
  // 打包模式下把工作目录切到 resources/，serveStatic 的相对路径才能落在 web/ 上
  if (app.isPackaged) process.chdir(process.resourcesPath);
  const dataDir = app.isPackaged
    ? path.join(app.getPath("userData"), "data")
    : path.resolve("data");
  log(`dataDir=${dataDir}`);
  // LLM key：安装版读 userData/.env（用户可编辑），开发版读项目 .env；环境变量优先
  loadDotEnv([path.join(app.getPath("userData"), ".env"), path.resolve(".env")]);
  const llm = readLlmConfig();
  log(`llm=${llm === null ? "disabled" : llm.model}`);
  const neteaseCookie = process.env.STUDYMOOD_NETEASE_COOKIE?.trim();
  const store = new JsonFileStore(dataDir);
  await store.init();
  if (await seedSampleIfFirstRun(store)) {
    log("首次运行：已导入示例音乐库");
  }
  const appHono = createApp({ store, appVersion: app.getVersion(), dataDir, llm, neteaseCookie });

  // 与 server/main.ts 相同的静态托管（生产构建产物）
  const webDist = app.isPackaged
    ? path.join(process.resourcesPath ?? "", "web")
    : path.resolve("dist/web");
  if (existsSync(webDist)) {
    const root = path.relative(process.cwd(), webDist);
    appHono.use("*", serveStatic({ root }));
    appHono.get("*", serveStatic({ root, path: "/index.html" }));
  }

  const port = await pickPort(8787);
  log(`picked port ${port}`);
  await new Promise<void>((resolve, reject) => {
    const server = serve({ fetch: appHono.fetch, port, hostname: "127.0.0.1" }, () => {
      log(`API listening on ${port}`);
      resolve();
    });
    server.on("error", (err) => {
      log(`serve error: ${String(err)}`);
      reject(err);
    });
  });
  return port;
}

function applyMode(win: BrowserWindow, mini: boolean): void {
  if (mini) {
    win.setMinimumSize(340, 520);
    win.setBounds(MINI_SIZE);
    win.setAlwaysOnTop(true, "screen-saver");
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(720, 560);
    win.setBounds(MAIN_SIZE);
  }
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    ...MAIN_SIZE,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#fdf3f4",
    autoHideMenuBar: true,
    title: "StudyMood DJ",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // 无菜单栏；保留 F12 开发者工具
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
log(`singleInstanceLock=${gotLock} isPackaged=${app.isPackaged} userData=${app.getPath("userData")}`);
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  Menu.setApplicationMenu(null);

  void app.whenReady().then(async () => {
    ipcMain.handle("window:set-mini-mode", (_event, mini: boolean) => {
      if (mainWindow !== null) applyMode(mainWindow, mini === true);
      return true;
    });

    try {
      const port = await startApi();
      createWindow(port);
    } catch (err) {
      console.error("[studymood] 启动失败:", err);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
