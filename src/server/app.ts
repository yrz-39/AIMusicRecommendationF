import { Hono, type Context } from "hono";
import type { DataStore } from "../storage/jsonStore.js";
import { recommend } from "../core/recommend/engine.js";
import { contextFromTrack, matchPlayingTrack } from "../core/recommend/contextFromTrack.js";
import { parseContextAuto, parseSongFeedbackAuto } from "../core/llm/auto.js";
import { buildPlaylist, DEFAULT_PLAYLIST_BUDGET_MIN } from "../core/recommend/playlist.js";
import { applyFeatureDelta } from "../core/learn/featureLearner.js";
import { prelabelTracks } from "../core/llm/prelabel.js";
import { normalizeGenres } from "../core/import/genreMap.js";
import { fetchNeteasePlaylist, testNeteaseCookie } from "../core/import/netease.js";
import type { NcmClient, NcmSong } from "../core/netease/ncmCli.js";
import { evaluateFillCandidates, generateSearchQueries, type FillCandidate } from "../core/llm/playlistFill.js";
import { detectNowPlaying } from "../core/native/nowPlaying.js";
import { validateImportRows, songKey } from "../core/import/validate.js";
import { importCsv } from "../core/import/csv.js";
import { getSampleLibrary } from "../sample/sampleLibrary.js";
import type { FeedbackEvent, FeedbackType, Recommendation, RecommendationSession, StudyContext, Track } from "../core/types.js";
import { updateDotEnvFile, type LlmConfig } from "../config/env.js";
import { testLlmConnection } from "../core/llm/deepseek.js";
import { randomUUID } from "node:crypto";

/**
 * 本地 API。
 *
 * 设计要点：
 * - 只监听 127.0.0.1（local-first：不向局域网暴露用户数据）；
 * - 首次运行时由 seedSampleIfFirstRun 导入一次示例库，
 *   用户清空曲库不会被重新填充；导入真实库后整体替换；
 * - 同一会话（sessionId）再次推荐时：更新会话记录、排除本会话内被标
 *   "不适合" 的曲目，形成自然的"换一批"体验。
 */

export interface AppDeps {
  store: DataStore;
  /** 测试时注入固定时间，默认真实时钟 */
  now?: () => Date;
  /** 应用版本（帮助页展示；Web 版读 package.json，桌面版读 app.getVersion()） */
  appVersion?: string;
  /** 数据目录绝对路径（帮助页展示，方便用户备份/迁移） */
  dataDir?: string;
  /** LLM 配置（.env 注入）；null = 未配置，全部走规则解析。设置页保存后热更新 */
  llm?: LlmConfig | null;
  /** 网易云登录态（MUSIC_U cookie 值，.env 注入）；可选，提供后歌单导入不受匿名 10 首截断 */
  neteaseCookie?: string;
  /** 设置持久化文件（.env 格式）。缺省 = 不落盘（测试场景），设置只在本次进程内生效 */
  settingsPath?: string;
  /** 设置页连通性测试用 fetch（测试注入 mock）；生产走全局 fetch */
  fetchImpl?: typeof fetch;
  /** 网易云官方 ncm-cli 客户端（检测到安装时传入）；null = 不可用，「在网易云播放」等联动功能关闭 */
  ncm?: NcmClient | null;
}

/** 首次运行且曲库为空时导入示例库（通过持久化 flag 保证只执行一次） */
export async function seedSampleIfFirstRun(store: DataStore): Promise<boolean> {
  if (await store.loadFlag("seeded")) return false;
  const tracks = await store.loadTracks();
  if (tracks.length > 0) {
    // 用户已有真实数据：标记已初始化，不覆盖
    await store.saveFlag("seeded");
    return false;
  }
  await store.saveTracks(getSampleLibrary());
  await store.saveFlag("seeded");
  return true;
}

export function createApp({
  store,
  now = () => new Date(),
  appVersion,
  dataDir,
  llm = null,
  neteaseCookie,
  settingsPath,
  fetchImpl,
  ncm = null,
}: AppDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: err.message ?? "内部错误" }, 500);
  });

  /**
   * 运行时可变设置：llm / neteaseCookie 原为启动快照，设置页需要保存后立即生效，
   * 因此端点统一读 settings.*，PUT /api/settings 原地更新并落盘 settingsPath。
   */
  const settings = {
    llm: llm as LlmConfig | null,
    neteaseCookie: neteaseCookie as string | undefined,
  };

  /** 凭据只回显掩码（截图/录屏也不泄露），完整值不返回给渲染层 */
  const maskSecret = (v: string): string => {
    const t = v.trim();
    if (t === "") return "";
    if (t.length <= 8) return `••••（${t.length} 字符）`;
    return `${t.slice(0, 3)}••••${t.slice(-4)}`;
  };

  const settingsSnapshot = async () => {
    let ncmStatus: { appIdSet: boolean; player: string | null } | null = null;
    if (ncm !== null) {
      try {
        ncmStatus = await ncm.configStatus();
      } catch {
        ncmStatus = { appIdSet: false, player: null };
      }
    }
    return {
      llm: {
        configured: settings.llm !== null,
        baseUrl: settings.llm?.baseUrl ?? "https://api.deepseek.com",
        model: settings.llm?.model ?? "deepseek-chat",
        apiKeyMasked: settings.llm ? maskSecret(settings.llm.apiKey) : null,
      },
      netease: {
        configured: (settings.neteaseCookie ?? "").trim() !== "",
        cookieMasked: settings.neteaseCookie ? maskSecret(settings.neteaseCookie) : null,
      },
      settingsPath: settingsPath ?? null,
      ncm: { available: ncm !== null, appIdSet: ncmStatus?.appIdSet ?? false, player: ncmStatus?.player ?? null },
    };
  };

  /** 应用运行时设置 + 同步进程环境变量 + 落盘（settingsPath 存在时）。传 null 清除对应项 */
  const applySettings = (updates: {
    llm?: { apiKey?: string; baseUrl?: string; model?: string };
    neteaseCookie?: string | null;
  }): void => {
    if (updates.llm !== undefined) {
      const { apiKey, baseUrl, model } = updates.llm;
      if (apiKey !== undefined) {
        if (apiKey.trim() === "") {
          delete process.env.STUDYMOOD_LLM_API_KEY;
          settings.llm = null;
        } else {
          process.env.STUDYMOOD_LLM_API_KEY = apiKey.trim();
          settings.llm = {
            apiKey: apiKey.trim(),
            baseUrl: (baseUrl?.trim() || settings.llm?.baseUrl || "https://api.deepseek.com").replace(/\/+$/, ""),
            model: model?.trim() || settings.llm?.model || "deepseek-chat",
            ...(fetchImpl !== undefined ? { fetchImpl } : {}),
          };
        }
      }
      // 只改 baseUrl/model：在现有 key 基础上重建（key 未配置时改这两项没有意义，保留 null）
      if (settings.llm !== null && (baseUrl !== undefined || model !== undefined)) {
        settings.llm = {
          ...settings.llm,
          baseUrl: (baseUrl?.trim() || settings.llm.baseUrl).replace(/\/+$/, ""),
          model: model?.trim() || settings.llm.model,
          ...(fetchImpl !== undefined ? { fetchImpl } : {}),
        };
      }
    }
    if (updates.neteaseCookie !== undefined) {
      const cookie = updates.neteaseCookie?.trim() ?? "";
      if (cookie === "") {
        delete process.env.STUDYMOOD_NETEASE_COOKIE;
        settings.neteaseCookie = undefined;
      } else {
        process.env.STUDYMOOD_NETEASE_COOKIE = cookie;
        settings.neteaseCookie = cookie;
      }
    }
    if (settingsPath !== undefined) {
      const fileUpdates: Record<string, string | null> = {};
      if (updates.llm?.apiKey !== undefined)
        fileUpdates.STUDYMOOD_LLM_API_KEY = updates.llm.apiKey.trim() === "" ? null : updates.llm.apiKey.trim();
      if (updates.llm?.baseUrl !== undefined) fileUpdates.STUDYMOOD_LLM_BASE_URL = updates.llm.baseUrl.trim();
      if (updates.llm?.model !== undefined) fileUpdates.STUDYMOOD_LLM_MODEL = updates.llm.model.trim();
      if (updates.neteaseCookie !== undefined)
        fileUpdates.STUDYMOOD_NETEASE_COOKIE =
          updates.neteaseCookie === null || updates.neteaseCookie.trim() === "" ? null : updates.neteaseCookie.trim();
      if (Object.keys(fileUpdates).length > 0) updateDotEnvFile(settingsPath, fileUpdates);
    }
  };

  /** 设置页：当前配置状态（凭据只回掩码，完整值不出渲染层边界） */
  app.get("/api/settings", async (c) => c.json(await settingsSnapshot()));

  /** 保存设置：立即生效（热更新），同时写入 .env 以便重启后保留 */
  app.put("/api/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const b = (body ?? {}) as {
      llm?: { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
      neteaseCookie?: unknown;
      ncm?: { appId?: unknown; privateKey?: unknown };
    };
    const updates: Parameters<typeof applySettings>[0] = {};
    let ncmConfigured = false;
    if (b.llm !== undefined && b.llm !== null && typeof b.llm === "object") {
      const llmUpdate: { apiKey?: string; baseUrl?: string; model?: string } = {};
      if (b.llm.apiKey !== undefined) {
        if (typeof b.llm.apiKey !== "string") return c.json({ error: "apiKey 必须是字符串" }, 400);
        llmUpdate.apiKey = b.llm.apiKey;
      }
      if (b.llm.baseUrl !== undefined) {
        if (typeof b.llm.baseUrl !== "string") return c.json({ error: "baseUrl 必须是字符串" }, 400);
        llmUpdate.baseUrl = b.llm.baseUrl;
      }
      if (b.llm.model !== undefined) {
        if (typeof b.llm.model !== "string") return c.json({ error: "model 必须是字符串" }, 400);
        llmUpdate.model = b.llm.model;
      }
      if (Object.keys(llmUpdate).length > 0) updates.llm = llmUpdate;
    }
    if (b.neteaseCookie !== undefined) {
      if (b.neteaseCookie !== null && typeof b.neteaseCookie !== "string") {
        return c.json({ error: "neteaseCookie 必须是字符串或 null" }, 400);
      }
      updates.neteaseCookie = b.neteaseCookie as string | null;
    }
    if (b.ncm !== undefined && b.ncm !== null && typeof b.ncm === "object") {
      if (ncm === null) return c.json({ error: "未检测到 ncm-cli，请先安装（npm install -g @music163/ncm-cli）" }, 400);
      if (typeof b.ncm.appId !== "string" || b.ncm.appId.trim() === "" || typeof b.ncm.privateKey !== "string" || b.ncm.privateKey.trim() === "") {
        return c.json({ error: "appId 与 privateKey 都必须是非空字符串" }, 400);
      }
      try {
        await ncm.setCredentials(b.ncm.appId.trim(), b.ncm.privateKey.trim());
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502);
      }
      ncmConfigured = true;
    }
    if (updates.llm === undefined && updates.neteaseCookie === undefined && !ncmConfigured) {
      return c.json({ error: "没有要保存的设置" }, 400);
    }
    if (updates.llm !== undefined || updates.neteaseCookie !== undefined) applySettings(updates);
    return c.json(await settingsSnapshot());
  });

  /** 设置页「测试联动」：ncm-cli 版本/凭证/登录三查，给用户一个明确的就绪判断 */
  app.post("/api/settings/test-ncm", async (c) => {
    if (ncm === null) return c.json({ ok: false, error: "未检测到 ncm-cli，请先安装（npm install -g @music163/ncm-cli）" }, 400);
    const version = await ncm.version();
    if (version === null) return c.json({ ok: false, error: "ncm-cli 无法执行（检查安装/PATH，或到设置里指定路径）" }, 502);
    const cfg = await ncm.configStatus();
    if (!cfg.appIdSet) return c.json({ ok: false, version, appIdSet: false, error: "开放平台凭证未配置，请先在上方填写保存" });
    let login: { loggedIn: boolean; message: string };
    try {
      login = await ncm.loginCheck();
    } catch (err) {
      return c.json({ ok: false, version, appIdSet: true, error: `登录状态检查失败：${(err as Error).message}` });
    }
    return c.json({
      ok: login.loggedIn,
      version,
      appIdSet: true,
      player: cfg.player,
      loggedIn: login.loggedIn,
      error: login.loggedIn ? undefined : login.message,
    });
  });

  /** 设置页「测试连接」：默认测已保存配置，body 里可带未保存的候选值先测再存 */
  app.post("/api/settings/test-llm", async (c) => {
    let candidate: { apiKey?: string; baseUrl?: string; model?: string } = {};
    try {
      const body = (await c.req.json()) as { llm?: { apiKey?: unknown; baseUrl?: unknown; model?: unknown } } | null;
      const l = body?.llm;
      if (l !== undefined && l !== null && typeof l === "object") {
        candidate = {
          apiKey: typeof l.apiKey === "string" ? l.apiKey.trim() : undefined,
          baseUrl: typeof l.baseUrl === "string" ? l.baseUrl.trim() : undefined,
          model: typeof l.model === "string" ? l.model.trim() : undefined,
        };
      }
    } catch {
      /* 无 body：测已保存配置 */
    }
    const apiKey = candidate.apiKey || settings.llm?.apiKey;
    if (apiKey === undefined || apiKey === "") return c.json({ ok: false, error: "尚未配置 API key" }, 400);
    const baseUrl = (candidate.baseUrl || settings.llm?.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = candidate.model || settings.llm?.model || "deepseek-chat";
    return c.json(await testLlmConnection({ apiKey, baseUrl, model, ...(fetchImpl !== undefined ? { fetchImpl } : {}) }));
  });

  /** 设置页「测试 Cookie」：验证 MUSIC_U 是否有效，返回登录昵称 */
  app.post("/api/settings/test-netease", async (c) => {
    let candidate: string | undefined;
    try {
      const body = (await c.req.json()) as { cookie?: unknown } | null;
      if (typeof body?.cookie === "string" && body.cookie.trim() !== "") candidate = body.cookie.trim();
    } catch {
      /* 无 body：测已保存配置 */
    }
    const cookie = candidate ?? settings.neteaseCookie;
    if (cookie === undefined || cookie.trim() === "") return c.json({ ok: false, error: "尚未配置 Cookie" }, 400);
    return c.json(await testNeteaseCookie(cookie, fetchImpl));
  });

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      time: now().toISOString(),
      version: appVersion ?? null,
      dataDir: dataDir ?? null,
      llm: settings.llm !== null,
      ncm: ncm !== null,
    }),
  );

  /** 曲库推荐已填的时长（秒）——用于判断歌单缺口是否值得触发全库补位 */
  const playlistBudgetUsed = (recs: Recommendation[]): number => recs.reduce((sum, r) => sum + r.track.durationSec, 0);

  /** 把播放请求条目解析为 ncm-cli 歌曲对象：已有加密/原始 ID 直接用，否则按「歌名 歌手」搜索匹配 */
  const resolvePlaybackSong = async (item: { title: string; artist: string; netease?: { encryptedId?: unknown; originalId?: unknown } }): Promise<NcmSong> => {
    if (ncm === null) throw new Error("ncm-cli 不可用");
    const enc = typeof item.netease?.encryptedId === "string" ? item.netease.encryptedId : undefined;
    const orig = typeof item.netease?.originalId === "string" ? item.netease.originalId : undefined;
    if (enc !== undefined && enc !== "" && orig !== undefined && orig !== "") {
      return { encryptedId: enc, originalId: orig, title: item.title, artist: item.artist };
    }
    const songs = await ncm.searchSong(`${item.title} ${item.artist}`, 10);
    if (songs.length === 0) throw new Error(`网易云搜索无结果：《${item.title}》`);
    const norm = (s: string): string =>
      s.toLowerCase().replace(/\s+/g, "").replace(/[（(【\[].*?[)）】\]]/g, "").replace(/[·、，,。.\-—~！!？?：:'’"]/g, "");
    const wantTitle = norm(item.title);
    const wantArtist = norm(item.artist);
    // 匹配优先级：歌名+歌手全等 > 歌名全等 > 歌名包含（长度达标）。宁可不播不播错。
    const byKey = (t: string, a: string): boolean => norm(t) === wantTitle && norm(a) === wantArtist;
    const song =
      songs.find((s) => byKey(s.title, s.artist)) ??
      songs.find((s) => norm(s.title) === wantTitle) ??
      songs.find((s) => norm(s.title).includes(wantTitle) && wantTitle.length >= 2);
    if (song === undefined) throw new Error(`没找到可靠匹配：《${item.title}》${item.artist}（搜索结果都不像）`);
    return song;
  };

  /** 队列首曲：清空队列并立即播放（与 queue-add 搭配，由前端按歌单顺序逐条调用） */
  const queueEndpoint = (mode: "start" | "add") =>
    async (c: Context) => {
      if (ncm === null) return c.json({ error: "未检测到 ncm-cli，请到「设置」查看安装与配置指引" }, 400);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "请求体必须是 JSON" }, 400);
      }
      const item = (body ?? {}) as { title?: unknown; artist?: unknown; netease?: Record<string, unknown> };
      if (typeof item.title !== "string" || item.title.trim() === "" || typeof item.artist !== "string") {
        return c.json({ error: "缺少 title/artist" }, 400);
      }
      const playItem = { title: item.title.trim(), artist: item.artist.trim(), netease: item.netease };
      try {
        const song = await resolvePlaybackSong(playItem);
        if (mode === "start") {
          await ncm.queueClear();
          await ncm.playSong(song);
        } else {
          await ncm.queueAdd(song);
        }
        return c.json({ ok: true, status: mode === "start" ? "playing" : "queued", matchedTitle: song.title, matchedArtist: song.artist });
      } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 502);
      }
    };

  app.post("/api/netease/queue-start", queueEndpoint("start"));
  app.post("/api/netease/queue-add", queueEndpoint("add"));

  /** 小窗/正在播放条的播放遥控（ncm-cli 直接控制网易云客户端或 mpv） */
  app.post("/api/netease/control", async (c) => {
    if (ncm === null) return c.json({ error: "未检测到 ncm-cli" }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const action = (body as { action?: unknown } | null)?.action;
    const valid = ["pause", "resume", "stop", "next", "prev"] as const;
    if (typeof action !== "string" || !valid.includes(action as (typeof valid)[number])) {
      return c.json({ error: `action 必须是 ${valid.join("/")}` }, 400);
    }
    try {
      await ncm.control(action as (typeof valid)[number]);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  /** ncm-cli 播放状态（托盘场景下桌面检测失效时的兜底信号源） */
  app.get("/api/netease/state", async (c) => {
    if (ncm === null) return c.json({ available: false, status: "unknown", playing: false });
    try {
      const s = await ncm.state();
      return c.json({ available: true, ...s });
    } catch (err) {
      return c.json({ available: true, status: "unknown", playing: false, error: (err as Error).message });
    }
  });

  /** 曲库中特征缺失（energy 未标注）的曲目数，供 UI 提示「AI 补全」入口 */
  app.get("/api/library/unlabeled-count", async (c) => {
    const tracks = await store.loadTracks();
    return c.json({ count: tracks.filter((t) => t.energy === undefined).length });
  });

  /**
   * LLM 批量预标注：为特征缺失的曲目按歌名/歌手/流派推断初始特征。
   * 每次处理一批（上限 15 首），由前端分批调用以展示进度。
   * 每首的标注写入 learnEvents（parsedBy=llm），特征来源永远可追溯。
   */
  app.post("/api/library/prelabel", async (c) => {
    if (settings.llm === null) return c.json({ error: "未配置 LLM，无法自动标注" }, 400);
    const llmNow = settings.llm;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const ids = (body as { trackIds?: unknown } | null)?.trackIds;
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "缺少 trackIds" }, 400);

    const tracks = await store.loadTracks();
    const targets = ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => tracks.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined && t.energy === undefined)
      .slice(0, 15);
    if (targets.length === 0) return c.json({ labeled: [], changes: [], skipped: 0 });

    const result = await prelabelTracks(targets, llmNow);
    if (result === null) return c.json({ error: "LLM 标注失败，请稍后重试" }, 502);
    if (result.labeled.length > 0) {
      const applyMap = new Map(result.changes.map((ch) => [ch.trackId, ch.apply] as const));
      await store.saveTracks(
        tracks.map((t) => {
          const a = applyMap.get(t.id);
          if (a === undefined) return t;
          return {
            ...t,
            energy: a.energy ?? t.energy,
            moodTags: a.moodTags.length > 0 ? [...new Set([...(t.moodTags ?? []), ...a.moodTags])] : t.moodTags,
            vocalDensity: a.vocalDensity ?? t.vocalDensity,
            // 顺手把存量中文流派规范化，让能量先验兜底生效
            genres: normalizeGenres(t.genres) ?? t.genres,
          };
        }),
      );
    }
    for (const ch of result.changes) {
      await store.appendLearnEvent({
        id: randomUUID(),
        trackId: ch.trackId,
        text: "导入预标注（AI 依据歌曲名/歌手/流派推断）",
        delta: { moodTags: [], matched: ch.changes },
        parsedBy: "llm",
        changes: ch.changes,
        createdAt: now().toISOString(),
      });
    }
    return c.json(result);
  });

  /** 推荐/歌单共用的执行链：反馈排除 → 近期降权 → 引擎 → 会话记录 */
  const runRecommend = async (
    context: StudyContext,
    opts: { sessionId?: unknown; excludeTrackIds?: unknown; limit: number },
  ): Promise<{ sessionId: string; recommendations: Recommendation[] } | { error: string }> => {
    const tracks = await store.loadTracks();
    if (tracks.length === 0) {
      return { error: "音乐库为空，请先在「音乐库」导入数据" };
    }
    const sid = typeof opts.sessionId === "string" && opts.sessionId ? opts.sessionId : randomUUID();
    const feedback = await store.loadFeedback();
    const sessions = await store.loadSessions();

    // 本会话内被标"不适合"的曲目不再出现
    const excluded = new Set(
      feedback.filter((f) => f.sessionId === sid && f.type === "not_suitable").map((f) => f.trackId),
    );
    if (Array.isArray(opts.excludeTrackIds)) {
      for (const id of opts.excludeTrackIds) {
        if (typeof id === "string") excluded.add(id);
      }
    }
    const recentTrackIds = sessions
      .filter((s) => s.id !== sid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 2)
      .flatMap((s) => s.trackIds);

    const recommendations = recommend({
      tracks,
      context,
      feedbackEvents: feedback,
      recentTrackIds,
      excludeTrackIds: [...excluded],
      limit: opts.limit,
      now: now(),
    });

    const session: RecommendationSession = {
      id: sid,
      createdAt: now().toISOString(),
      context,
      trackIds: recommendations.map((r) => r.track.id),
    };
    await store.upsertSession(session);
    return { sessionId: sid, recommendations };
  };

  app.get("/api/history", async (c) => {
    const [sessions, feedback, tracks] = await Promise.all([
      store.loadSessions(),
      store.loadFeedback(),
      store.loadTracks(),
    ]);
    const trackById = new Map(tracks.map((t) => [t.id, t] as const));
    // 每个曲目在该会话内的最新反馈
    const feedbackBySessionTrack = new Map<string, Map<string, FeedbackType>>();
    for (const event of feedback) {
      if (event.sessionId === undefined) continue;
      const perTrack = feedbackBySessionTrack.get(event.sessionId) ?? new Map<string, FeedbackType>();
      perTrack.set(event.trackId, event.type);
      feedbackBySessionTrack.set(event.sessionId, perTrack);
    }
    const recent = [...sessions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((s) => {
        const perTrack = feedbackBySessionTrack.get(s.id);
        return {
          id: s.id,
          createdAt: s.createdAt,
          context: s.context,
          tracks: s.trackIds
            .map((id) => trackById.get(id))
            .filter((t): t is NonNullable<typeof t> => t !== undefined)
            .map((t) => ({ track: t, feedback: perTrack?.get(t.id) })),
        };
      });
    const stats = {
      likes: feedback.filter((f) => f.type === "like").length,
      skips: feedback.filter((f) => f.type === "skip").length,
      rejected: feedback.filter((f) => f.type === "not_suitable").length,
    };
    return c.json({ sessions: recent, stats });
  });

  app.get("/api/library", async (c) => {
    const tracks = await store.loadTracks();
    return c.json({ count: tracks.length, tracks });
  });

  /** 删除单曲：只从曲库移除条目；历史反馈/学习记录保留（引用自然失效，不参与计算） */
  app.delete("/api/tracks/:id", async (c) => {
    const id = c.req.param("id");
    const tracks = await store.loadTracks();
    const remaining = tracks.filter((t) => t.id !== id);
    if (remaining.length === tracks.length) return c.json({ error: "曲目不存在" }, 404);
    await store.saveTracks(remaining);
    return c.json({ ok: true, removed: tracks.length - remaining.length });
  });

  /** 批量删除：一次移除多首（存在的才删，不存在的忽略） */
  app.post("/api/library/delete-tracks", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "缺少 ids" }, 400);
    const wanted = new Set(ids.filter((x): x is string => typeof x === "string" && x !== ""));
    const tracks = await store.loadTracks();
    const remaining = tracks.filter((t) => !wanted.has(t.id));
    await store.saveTracks(remaining);
    return c.json({ ok: true, removed: tracks.length - remaining.length });
  });

  app.post("/api/library/import", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const rows = (body as { tracks?: unknown } | null)?.tracks ?? body;
    const existing = await store.loadTracks();
    const existingIds = new Set(existing.map((t) => t.id));
    const existingKeys = new Set(existing.map((t) => songKey(t.title, t.artist)));
    const result = validateImportRows(rows, { existingIds, existingSongKeys: existingKeys });
    if (result.accepted.length > 0) {
      await store.saveTracks([...existing, ...result.accepted]);
    }
    return c.json({ imported: result.accepted.length, rejected: result.rejected, ids: result.accepted.map((t) => t.id) });
  });

  app.post("/api/library/import-csv", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const csv = (body as { csv?: unknown } | null)?.csv;
    if (typeof csv !== "string" || csv.trim() === "") {
      return c.json({ error: "缺少 csv 文本" }, 400);
    }
    const existing = await store.loadTracks();
    const existingIds = new Set(existing.map((t) => t.id));
    const existingKeys = new Set(existing.map((t) => songKey(t.title, t.artist)));
    const result = importCsv(csv, { existingIds, existingSongKeys: existingKeys });
    if (result.accepted.length > 0) {
      await store.saveTracks([...existing, ...result.accepted]);
    }
    return c.json({ imported: result.accepted.length, rejected: result.rejected, ids: result.accepted.map((t) => t.id) });
  });

  app.get("/api/now-playing", async (c) => c.json(await detectNowPlaying()));

  /**
   * 网易云公开歌单一键导入：只读匿名接口获取歌名/歌手/专辑/时长，
   * 与现有曲库去重后入库。特征（能量/情绪）随后由前端触发 LLM 预标注。
   */
  app.post("/api/library/import-netease", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const input = (body as { input?: unknown } | null)?.input;
    if (typeof input !== "string" || input.trim() === "") {
      return c.json({ error: "请粘贴网易云歌单的分享链接或 id" }, 400);
    }

    let playlist;
    try {
      playlist = await fetchNeteasePlaylist(input, { cookie: settings.neteaseCookie });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }

    const existing = await store.loadTracks();
    const existingIds = new Set(existing.map((t) => t.id));
    //网易云条目 id 与本地库必然不同，需按「歌名|歌手」识别同一首歌，避免整单导入造成重复
    const keyOf = (t: { title: string; artist: string }) =>
      `${t.title.trim().toLowerCase()}|${t.artist.trim().toLowerCase()}`;
    const existingKeys = new Set(existing.map(keyOf));
    const accepted = playlist.tracks.filter((t) => !existingIds.has(t.id) && !existingKeys.has(keyOf(t)));
    if (accepted.length > 0) {
      await store.saveTracks([...existing, ...accepted]);
    }
    return c.json({
      playlistName: playlist.name,
      imported: accepted.length,
      duplicates: playlist.tracks.length - accepted.length,
      ids: accepted.map((t) => t.id),
    });
  });

  app.post("/api/playlist", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const { input, sessionId } = (body ?? {}) as { input?: unknown; sessionId?: unknown };
    if (typeof input !== "string" || input.trim().length === 0) {
      return c.json({ error: "请描述你现在的状态" }, 400);
    }

    const { context, parsedBy } = await parseContextAuto(input, settings.llm);
    const outcome = await runRecommend(context, { sessionId, limit: 60 });
    if ("error" in outcome) return c.json({ error: outcome.error }, 400);

    // 曲库填不满预算时（>2 分钟缺口），且有 ncm-cli + LLM：去网易云全库搜候选，
    // LLM 逐首评估是否符合当前情境，通过的以「网易云补充」身份参与预算填充。
    let ranked = outcome.recommendations;
    const supplements: { attempted: boolean; added: number; note: string | null } = {
      attempted: false,
      added: 0,
      note: null,
    };
    /** 补位曲目 id（前端据此显示「云补位」标记与「＋曲库」按钮） */
    const supplementIds: string[] = [];
    const needSec = (context.durationMinutes ?? DEFAULT_PLAYLIST_BUDGET_MIN) * 60 - playlistBudgetUsed(outcome.recommendations);
    if (needSec > 120 && settings.llm !== null && ncm !== null) {
      supplements.attempted = true;
      try {
        const queries = await generateSearchQueries(context, settings.llm);
        const library = await store.loadTracks();
        const libraryKeys = new Set(library.map((t) => songKey(t.title, t.artist)));
        const seenIds = new Set<string>();
        const rawSongs = new Map<string, NcmSong>();
        const candidates: FillCandidate[] = [];
        searchLoop: for (const q of queries.slice(0, 3)) {
          let songs: NcmSong[] = [];
          try {
            songs = await ncm.searchSong(q, 10);
          } catch {
            continue; // 单个关键词失败不影响整体
          }
          for (const s of songs) {
            if (seenIds.has(s.originalId)) continue;
            seenIds.add(s.originalId);
            if (libraryKeys.has(songKey(s.title, s.artist))) continue; // 曲库已有，不算补充
            rawSongs.set(s.originalId, s);
            candidates.push({
              key: s.originalId,
              title: s.title,
              artist: s.artist,
              album: s.album,
              durationSec: s.durationSec ?? 240,
            });
            if (candidates.length >= 12) break searchLoop;
          }
        }
        if (candidates.length === 0) {
          supplements.note = "网易云全库没有搜到可补充的新歌";
        } else {
          const decisions = await evaluateFillCandidates(context, candidates, settings.llm);
          if (decisions === null) {
            supplements.note = "LLM 评估没有完成，本次未补位";
          } else {
            const accepted: Recommendation[] = [];
            for (const cand of candidates) {
              const d = decisions.get(cand.key);
              const raw = rawSongs.get(cand.key);
              if (d === undefined || !d.accept || raw === undefined) continue;
              const track: Track = {
                id: `nes-${raw.originalId}`,
                title: raw.title,
                artist: raw.artist,
                album: raw.album,
                durationSec: raw.durationSec ?? 240,
                energy: d.energy,
                moodTags: d.moodTags.length > 0 ? d.moodTags : undefined,
                vocalDensity: d.vocalDensity,
                source: { kind: "netease" },
                netease: {
                  songId: /^\d+$/.test(raw.originalId) ? Number(raw.originalId) : undefined,
                  encryptedId: raw.encryptedId,
                  originalId: raw.originalId,
                },
              };
              accepted.push({
                track,
                // 补位曲目排在曲库命中之后，分数仅用于展示（TrackCard 对补位显示「云补位」而非分数）
                score: 50,
                components: [],
                reasons: [d.reason],
              });
            }
            if (accepted.length > 0) {
              ranked = [...outcome.recommendations, ...accepted];
              supplements.added = accepted.length;
              supplementIds.push(...accepted.map((r) => r.track.id));
            } else {
              supplements.note = "候选歌都被判定为不符合当前情境，未补位";
            }
          }
        }
      } catch (err) {
        supplements.note = `补位失败：${(err as Error).message}`;
      }
    }

    const playlist = buildPlaylist(ranked, context.durationMinutes);
    return c.json({ sessionId: outcome.sessionId, context, parsedBy, playlist, supplements, supplementIds });
  });

  app.post("/api/tracks/:id/learn", async (c) => {
    const trackId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.trim() === "") {
      return c.json({ error: "请描述这首歌给你的感受" }, 400);
    }

    const tracks = await store.loadTracks();
    const track = tracks.find((t) => t.id === trackId);
    if (track === undefined) return c.json({ error: "曲目不存在" }, 404);

    const { delta, parsedBy } = await parseSongFeedbackAuto(text, settings.llm);
    if (!delta.understood) {
      return c.json(
        { error: "没理解你的描述。可以试试：『有力气、提高精力』『很安静、能静心』『没有歌词』这类说法" },
        422,
      );
    }
    const { track: updated, changes } = applyFeatureDelta(track, delta);
    await store.saveTracks(tracks.map((t) => (t.id === trackId ? updated : t)));
    await store.appendLearnEvent({
      id: randomUUID(),
      trackId,
      text: text.trim(),
      delta: {
        energyHint: delta.energyHint,
        moodTags: delta.moodTags,
        vocalDensity: delta.vocalDensity,
        matched: delta.matched,
      },
      parsedBy,
      changes,
      createdAt: now().toISOString(),
    });
    return c.json({ track: updated, changes, matched: delta.matched, parsedBy });
  });

  app.post("/api/recommend", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const { input, sessionId, excludeTrackIds } = (body ?? {}) as {
      input?: unknown;
      sessionId?: unknown;
      excludeTrackIds?: unknown;
    };
    if (typeof input !== "string" || input.trim().length === 0) {
      return c.json({ error: "请描述你现在的状态" }, 400);
    }
    if (input.length > 2000) {
      return c.json({ error: "描述太长了（上限 2000 字）" }, 400);
    }

    const { context, parsedBy } = await parseContextAuto(input, settings.llm);
    const outcome = await runRecommend(context, { sessionId, excludeTrackIds, limit: 10 });
    if ("error" in outcome) return c.json({ error: outcome.error }, 400);

    return c.json({ sessionId: outcome.sessionId, context, parsedBy, recommendations: outcome.recommendations });
  });

  /** 正在播放 + 曲库匹配：检测到播放中的歌后，找到库内对应曲目（找不到则 track 为 null） */
  app.get("/api/now-playing/current", async (c) => {
    const playing = await detectNowPlaying();
    if (!playing.playing) return c.json({ playing: false });
    const tracks = await store.loadTracks();
    const track = matchPlayingTrack(tracks, playing);
    return c.json({ ...playing, track: track ?? null });
  });

  /** 基于正在播放/指定曲目的"找相似"推荐：曲目特征直接构造情境 */
  app.post("/api/recommend-similar", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const { trackId, sessionId, excludeTrackIds } = (body ?? {}) as {
      trackId?: unknown;
      sessionId?: unknown;
      excludeTrackIds?: unknown;
    };
    if (typeof trackId !== "string" || trackId === "") {
      return c.json({ error: "缺少 trackId" }, 400);
    }
    const tracks = await store.loadTracks();
    const track = tracks.find((t) => t.id === trackId);
    if (track === undefined) return c.json({ error: "曲目不存在" }, 404);

    const context = contextFromTrack(track);
    // 相似推荐不把基准曲目自己再排进来
    const extra = Array.isArray(excludeTrackIds) ? excludeTrackIds : [];
    const outcome = await runRecommend(context, {
      sessionId,
      excludeTrackIds: [trackId, ...extra],
      limit: 10,
    });
    if ("error" in outcome) return c.json({ error: outcome.error }, 400);

    return c.json({
      sessionId: outcome.sessionId,
      context,
      recommendations: outcome.recommendations,
      basedOn: track,
    });
  });

  app.post("/api/feedback", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const { trackId, sessionId, type } = (body ?? {}) as {
      trackId?: unknown;
      sessionId?: unknown;
      type?: unknown;
    };
    if (typeof trackId !== "string" || !trackId) return c.json({ error: "缺少 trackId" }, 400);
    const validTypes: FeedbackType[] = ["like", "skip", "not_suitable"];
    if (typeof type !== "string" || !validTypes.includes(type as FeedbackType)) {
      return c.json({ error: `type 必须是 ${validTypes.join("/")}` }, 400);
    }

    const tracks = await store.loadTracks();
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return c.json({ error: "曲目不存在" }, 404);

    const sessions = await store.loadSessions();
    const sid = typeof sessionId === "string" && sessionId ? sessionId : undefined;
    const session = sid ? sessions.find((s) => s.id === sid) : undefined;

    const event: FeedbackEvent = {
      id: randomUUID(),
      trackId,
      type: type as FeedbackType,
      sessionId: sid,
      contextSnapshot: session
        ? {
            task: session.context.task,
            energy: session.context.energy,
            stress: session.context.stress,
            focusDifficulty: session.context.focusDifficulty,
          }
        : undefined,
      createdAt: now().toISOString(),
    };
    await store.appendFeedback(event);
    return c.json({ ok: true, eventId: event.id });
  });

  return app;
}
