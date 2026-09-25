import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createApp, seedSampleIfFirstRun } from "./app.js";
import { JsonFileStore } from "../storage/jsonStore.js";
import { loadDotEnv, readLlmConfig } from "../config/env.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.STUDYMOOD_DATA_DIR ?? path.resolve("data");
const WEB_DIST = path.resolve("dist/web");
const APP_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }).version;

loadDotEnv([path.resolve(".env")]);
const LLM = readLlmConfig();
if (LLM !== null) console.log(`LLM 解析已启用: ${LLM.baseUrl} / ${LLM.model}`);
const NETEASE_COOKIE = process.env.STUDYMOOD_NETEASE_COOKIE?.trim();
if (NETEASE_COOKIE !== undefined && NETEASE_COOKIE !== "") console.log("网易云登录态已配置（歌单全量导入可用）");

async function main(): Promise<void> {
  const store = new JsonFileStore(DATA_DIR);
  await store.init();
  if (await seedSampleIfFirstRun(store)) {
    console.log("首次运行：已导入示例音乐库（导入真实库后会整体替换）");
  }

  const app = createApp({ store, appVersion: APP_VERSION, dataDir: DATA_DIR, llm: LLM, neteaseCookie: NETEASE_COOKIE });

  // 生产模式：存在构建产物时由 API 进程直接托管前端
  if (existsSync(WEB_DIST)) {
    app.use("*", serveStatic({ root: path.relative(process.cwd(), WEB_DIST) }));
    app.get("*", serveStatic({ root: path.relative(process.cwd(), WEB_DIST), path: "/index.html" }));
  }

  const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
    console.log(`StudyMood DJ API 已启动: http://127.0.0.1:${info.port}`);
    console.log(`数据目录: ${DATA_DIR}`);
    if (existsSync(WEB_DIST)) console.log(`Web UI: ${WEB_DIST} (已托管)`);
  });

  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
