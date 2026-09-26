import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, seedSampleIfFirstRun } from "../src/server/app.js";
import { MemoryStore } from "../src/storage/jsonStore.js";
import { loadDotEnv, updateDotEnvFile } from "../src/config/env.js";
import { fetchNeteasePlaylist } from "../src/core/import/netease.js";

/**
 * M6 设置页回归：凭据热更新生效、掩码不泄露、.env 落盘/清除、连通性测试端点。
 * PUT 会改进程环境变量，每个用例后统一清理，避免影响其他测试文件。
 */

const ENV_KEYS = ["STUDYMOOD_LLM_API_KEY", "STUDYMOOD_LLM_BASE_URL", "STUDYMOOD_LLM_MODEL", "STUDYMOOD_NETEASE_COOKIE"] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

async function makeApp(opts: { settingsPath?: string; fetchImpl?: typeof fetch } = {}) {
  const store = new MemoryStore();
  await seedSampleIfFirstRun(store);
  const app = createApp({ store, ...opts });
  return { store, app };
}

interface SettingsBody {
  llm: { configured: boolean; baseUrl: string; model: string; apiKeyMasked: string | null };
  netease: { configured: boolean; cookieMasked: string | null };
  settingsPath: string | null;
}

describe("设置 API：读取与热更新", () => {
  it("未配置时 GET 返回默认值与未配置状态", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const data = (await res.json()) as SettingsBody;
    expect(data.llm.configured).toBe(false);
    expect(data.llm.apiKeyMasked).toBeNull();
    expect(data.llm.baseUrl).toBe("https://api.deepseek.com");
    expect(data.llm.model).toBe("deepseek-chat");
    expect(data.netease.configured).toBe(false);
  });

  it("PUT 保存 key 后立即生效（health/预标注可见），完整 key 不回显", async () => {
    const { app } = await makeApp();
    const key = "sk-test-1234567890abcdef";
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: key } }),
    });
    expect(put.status).toBe(200);
    const raw = await put.text();
    expect(raw).not.toContain(key); // 只回掩码
    const data = JSON.parse(raw) as SettingsBody;
    expect(data.llm.configured).toBe(true);
    expect(data.llm.apiKeyMasked).toContain("••••");

    const health = await app.request("/api/health");
    expect(((await health.json()) as { llm: boolean }).llm).toBe(true);

    const get = await app.request("/api/settings");
    expect(((await get.json()) as SettingsBody).llm.configured).toBe(true);
  });

  it("PUT 更新 baseUrl/model 并去掉末尾斜杠", async () => {
    const { app } = await makeApp();
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: "sk-a-long-key", baseUrl: "https://api.example.com/", model: "my-model" } }),
    });
    const data = (await (await app.request("/api/settings")).json()) as SettingsBody;
    expect(data.llm.baseUrl).toBe("https://api.example.com");
    expect(data.llm.model).toBe("my-model");
  });

  it("PUT 清除 key（空串）后回到未配置", async () => {
    const { app } = await makeApp();
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: "sk-temp-key" } }),
    });
    const clear = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: "" } }),
    });
    expect(clear.status).toBe(200);
    const health = await app.request("/api/health");
    expect(((await health.json()) as { llm: boolean }).llm).toBe(false);
  });

  it("PUT 网易云 Cookie：保存/清除与状态同步", async () => {
    const { app } = await makeApp();
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ neteaseCookie: "cookie-value-xyz" }),
    });
    let data = (await (await app.request("/api/settings")).json()) as SettingsBody;
    expect(data.netease.configured).toBe(true);
    expect(data.netease.cookieMasked).toContain("••••");

    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ neteaseCookie: "" }),
    });
    data = (await (await app.request("/api/settings")).json()) as SettingsBody;
    expect(data.netease.configured).toBe(false);
  });

  it("非法请求体返回 400；空 PUT 返回 400", async () => {
    const { app } = await makeApp();
    const bad = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: 123 } }),
    });
    expect(bad.status).toBe(400);
    const empty = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });
});

describe("设置持久化（.env 落盘）", () => {
  it("配置 settingsPath 后 PUT 写入 .env，重启加载（loadDotEnv）可恢复", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "studymood-settings-"));
    const envPath = path.join(dir, ".env");
    writeFileSync(envPath, "# 用户手写注释\nOTHER_SETTING=keep\n", "utf8");

    const { app } = await makeApp({ settingsPath: envPath });
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: "sk-persist-key" }, neteaseCookie: "ck-persist" }),
    });
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain("# 用户手写注释"); // 注释保留
    expect(content).toContain("OTHER_SETTING=keep"); // 未知行保留
    expect(content).toContain("STUDYMOOD_LLM_API_KEY=sk-persist-key");
    expect(content).toContain("STUDYMOOD_NETEASE_COOKIE=ck-persist");

    // 模拟重启：清掉进程 env 后从 .env 恢复
    for (const key of ENV_KEYS) delete process.env[key];
    loadDotEnv([envPath]);
    expect(process.env.STUDYMOOD_LLM_API_KEY).toBe("sk-persist-key");
    expect(process.env.STUDYMOOD_NETEASE_COOKIE).toBe("ck-persist");

    // 清除 = 从文件中删行
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ neteaseCookie: "" }),
    });
    const after = readFileSync(envPath, "utf8");
    expect(after).not.toContain("STUDYMOOD_NETEASE_COOKIE");
    expect(after).toContain("STUDYMOOD_LLM_API_KEY=sk-persist-key");
    rmSync(dir, { recursive: true, force: true });
  });

  it("updateDotEnvFile：替换已有行、删除传 null 的行、文件不存在时创建", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "studymood-settings-"));
    const envPath = path.join(dir, "sub", ".env");
    updateDotEnvFile(envPath, { A: "1", B: null });
    expect(readFileSync(envPath, "utf8")).toBe("A=1");

    updateDotEnvFile(envPath, { A: "2", B: "3" });
    const lines = readFileSync(envPath, "utf8").split("\n");
    expect(lines).toContain("A=2");
    expect(lines).toContain("B=3");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("设置 API：连通性测试", () => {
  it("test-llm：200 视为成功，401 给出 key 无效提示", async () => {
    const ok = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const { app: okApp } = await makeApp({ fetchImpl: ok });
    await okApp.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: "sk-whatever" } }),
    });
    const good = await okApp.request("/api/settings/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(((await good.json()) as { ok: boolean }).ok).toBe(true);

    const reject = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as typeof fetch;
    const { app: badApp } = await makeApp({ fetchImpl: reject });
    const res = await badApp.request("/api/settings/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { apiKey: "sk-wrong" } }),
    });
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toContain("API key 无效");
  });

  it("test-llm：未配置返回 400", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/settings/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("test-netease：有效返回昵称，无效给出失效提示", async () => {
    const valid = (async () => new Response(JSON.stringify({ profile: { nickname: "小明" } }), { status: 200 })) as typeof fetch;
    const { app: okApp } = await makeApp({ fetchImpl: valid });
    const good = await okApp.request("/api/settings/test-netease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie: "ck" }),
    });
    const okData = (await good.json()) as { ok: boolean; nickname?: string };
    expect(okData.ok).toBe(true);
    expect(okData.nickname).toBe("小明");

    const invalid = (async () => new Response(JSON.stringify({ profile: null }), { status: 200 })) as typeof fetch;
    const { app: badApp } = await makeApp({ fetchImpl: invalid });
    const bad = await badApp.request("/api/settings/test-netease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie: "expired-ck" }),
    });
    const badData = (await bad.json()) as { ok: boolean; error: string };
    expect(badData.ok).toBe(false);
    expect(badData.error).toContain("失效");
  });

  it("test-netease：未配置返回 400", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/settings/test-netease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("导入时的 Cookie 失效提示", () => {
  it("配置了 Cookie 但歌单仍读不到 → 提示 Cookie 可能失效", async () => {
    const denied = (async () => new Response(JSON.stringify({ code: 301 }), { status: 200 })) as typeof fetch;
    await expect(
      fetchNeteasePlaylist("3778678", { cookie: "expired", fetchImpl: denied }),
    ).rejects.toThrow(/Cookie 可能已失效/);
  });

  it("未配置 Cookie 时保持原提示", async () => {
    const denied = (async () => new Response(JSON.stringify({ code: 301 }), { status: 200 })) as typeof fetch;
    await expect(fetchNeteasePlaylist("3778678", { fetchImpl: denied })).rejects.toThrow(/需要配置登录 Cookie/);
  });
});
