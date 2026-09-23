import { useCallback, useEffect, useState } from "react";
import type { StudyContext, Track } from "../../core/types.js";

type FeedbackType = "like" | "skip" | "not_suitable";

interface HistorySession {
  id: string;
  createdAt: string;
  context: StudyContext;
  tracks: Array<{ track: Track; feedback?: FeedbackType }>;
}

interface HistoryData {
  sessions: HistorySession[];
  stats: { likes: number; skips: number; rejected: number };
}

const FB_ZH: Record<FeedbackType, string> = { like: "❤", skip: "⏭", not_suitable: "✕" };

const MOOD_ZH: Record<string, string> = {
  tired: "疲惫",
  anxious: "焦虑",
  irritable: "烦躁",
  down: "低落",
  bored: "无聊",
  happy: "开心",
  lonely: "孤独",
  calm: "平静",
};

const CALMNESS_ZH: Record<string, string> = { calm: "安静", balanced: "适中", energetic: "提神" };

function contextSummary(context: StudyContext): string {
  const parts: string[] = [];
  if (context.task !== undefined) parts.push(context.task);
  if (context.durationMinutes !== undefined) parts.push(`${Math.floor(context.durationMinutes / 60) || ""}${context.durationMinutes % 60 ? `${context.durationMinutes % 60}分` : "小时"}`.trim());
  const moodZh = (context.moods ?? []).map((m) => MOOD_ZH[m] ?? m);
  if (moodZh.length > 0) parts.push(moodZh.join("/"));
  const prefs = context.musicPrefs ?? {};
  if (prefs.calmness !== undefined) parts.push(CALMNESS_ZH[prefs.calmness] ?? prefs.calmness);
  return parts.join(" · ") || "通用推荐";
}

export function HistoryView(): React.ReactElement {
  const [data, setData] = useState<HistoryData | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/history");
      setData((await res.json()) as HistoryData);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (data === null) {
    return <div className="empty">加载中…</div>;
  }

  const { stats, sessions } = data;
  if (sessions.length === 0) {
    return (
      <div className="empty">
        <div className="big">📻</div>
        还没有推荐记录。去「推荐」页描述你的状态吧。
      </div>
    );
  }

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        <span className="chip">❤ 喜欢 <b>{stats.likes}</b></span>
        <span className="chip">⏭ 跳过 <b>{stats.skips}</b></span>
        <span className="chip">✕ 不适合 <b>{stats.rejected}</b></span>
        <span className="chip gap">反馈会持续影响之后的推荐</span>
      </div>
      {sessions.map((s) => (
        <section key={s.id} className="context-panel">
          <h3>
            {new Date(s.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            <span className="conf">{contextSummary(s.context)}</span>
          </h3>
          <div className="history-tracks">
            {s.tracks.map(({ track, feedback }) => (
              <span key={track.id} className="chip">
                {feedback !== undefined && <span style={{ marginRight: 4 }}>{FB_ZH[feedback]}</span>}
                {track.title} · {track.artist}
              </span>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
