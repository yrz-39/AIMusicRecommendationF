import { Hono } from "hono";
import type { DataStore } from "../storage/jsonStore.js";
import { recommend } from "../core/recommend/engine.js";
import { contextFromTrack, matchPlayingTrack } from "../core/recommend/contextFromTrack.js";
import { parseContextAuto, parseSongFeedbackAuto } from "../core/llm/auto.js";
import { buildPlaylist } from "../core/recommend/playlist.js";
import { applyFeatureDelta } from "../core/learn/featureLearner.js";
import { prelabelTracks } from "../core/llm/prelabel.js";
import { normalizeGenres } from "../core/import/genreMap.js";
import { fetchNeteasePlaylist } from "../core/import/netease.js";
import { detectNowPlaying } from "../core/native/nowPlaying.js";
import { validateImportRows, songKey } from "../core/import/validate.js";
import { importCsv } from "../core/import/csv.js";
import { getSampleLibrary } from "../sample/sampleLibrary.js";
import type { FeedbackEvent, FeedbackType, Recommendation, RecommendationSession, StudyContext } from "../core/types.js";
import type { LlmConfig } from "../config/env.js";
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
  /** LLM 配置（.env 注入）；null = 未配置，全部走规则解析 */
  llm?: LlmConfig | null;
  /** 网易云登录态（MUSIC_U cookie 值，.env 注入）；可选，提供后歌单导入不受匿名 10 首截断 */
  neteaseCookie?: string;
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
}: AppDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: err.message ?? "内部错误" }, 500);
  });

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      time: now().toISOString(),
      version: appVersion ?? null,
      dataDir: dataDir ?? null,
      llm: llm !== null,
    }),
  );

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
    if (llm === null) return c.json({ error: "未配置 LLM，无法自动标注" }, 400);
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

    const result = await prelabelTracks(targets, llm);
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
      playlist = await fetchNeteasePlaylist(input, { cookie: neteaseCookie });
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

    const { context, parsedBy } = await parseContextAuto(input, llm);
    const outcome = await runRecommend(context, { sessionId, limit: 60 });
    if ("error" in outcome) return c.json({ error: outcome.error }, 400);
    const playlist = buildPlaylist(outcome.recommendations, context.durationMinutes);

    return c.json({ sessionId: outcome.sessionId, context, parsedBy, playlist });
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

    const { delta, parsedBy } = await parseSongFeedbackAuto(text, llm);
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

    const { context, parsedBy } = await parseContextAuto(input, llm);
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
