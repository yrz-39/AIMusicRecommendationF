import { Hono } from "hono";
import type { DataStore } from "../storage/jsonStore.js";
import { parseContext } from "../core/parser/rulesParser.js";
import { recommend } from "../core/recommend/engine.js";
import { validateImportRows } from "../core/import/validate.js";
import { importCsv } from "../core/import/csv.js";
import { getSampleLibrary } from "../sample/sampleLibrary.js";
import type { FeedbackEvent, FeedbackType, RecommendationSession } from "../core/types.js";
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

export function createApp({ store, now = () => new Date() }: AppDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: err.message ?? "内部错误" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, time: now().toISOString() }));

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

  app.post("/api/library/import", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体必须是 JSON" }, 400);
    }
    const rows = (body as { tracks?: unknown } | null)?.tracks ?? body;
    const existing = new Set((await store.loadTracks()).map((t) => t.id));
    const result = validateImportRows(rows, { existingIds: existing });
    if (result.accepted.length > 0) {
      await store.saveTracks([...(await store.loadTracks()), ...result.accepted]);
    }
    return c.json({ imported: result.accepted.length, rejected: result.rejected });
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
    const existing = new Set((await store.loadTracks()).map((t) => t.id));
    const result = importCsv(csv, { existingIds: existing });
    if (result.accepted.length > 0) {
      await store.saveTracks([...(await store.loadTracks()), ...result.accepted]);
    }
    return c.json({ imported: result.accepted.length, rejected: result.rejected });
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

    const context = parseContext(input).context;
    const tracks = await store.loadTracks();
    if (tracks.length === 0) {
      return c.json({ error: "音乐库为空，请先在「音乐库」导入数据" }, 400);
    }

    const sid = typeof sessionId === "string" && sessionId ? sessionId : randomUUID();
    const feedback = await store.loadFeedback();
    const sessions = await store.loadSessions();

    // 本会话内被标"不适合"的曲目不再出现
    const sessionRejected = new Set(
      feedback.filter((f) => f.sessionId === sid && f.type === "not_suitable").map((f) => f.trackId),
    );
    if (Array.isArray(excludeTrackIds)) {
      for (const id of excludeTrackIds) {
        if (typeof id === "string") sessionRejected.add(id);
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
      excludeTrackIds: [...sessionRejected],
      limit: 10,
      now: now(),
    });

    const session: RecommendationSession = {
      id: sid,
      createdAt: now().toISOString(),
      context,
      trackIds: recommendations.map((r) => r.track.id),
    };
    await store.upsertSession(session);

    return c.json({ sessionId: sid, context, recommendations });
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
