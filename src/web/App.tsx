import { useCallback, useEffect, useState } from "react";
import type { Recommendation, StudyContext } from "../core/types.js";
import { ContextPanel } from "./components/ContextPanel.js";
import { TrackCard } from "./components/TrackCard.js";
import { LibraryView } from "./components/LibraryView.js";
import { HistoryView } from "./components/HistoryView.js";
import { Onboarding, hasOnboarded, markOnboarded } from "./components/Onboarding.js";
import { HelpModal } from "./components/HelpModal.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { NowPlayingBar } from "./components/NowPlayingBar.js";
import { isDesktopApp } from "./electronBridge.js";

export type FeedbackType = "like" | "skip" | "not_suitable";

interface RecommendResponse {
  sessionId: string;
  context: StudyContext;
  recommendations: Recommendation[];
  parsedBy?: "llm" | "rules";
}

interface SimilarResponse {
  sessionId: string;
  context: StudyContext;
  recommendations: Recommendation[];
  parsedBy?: "llm" | "rules";
  basedOn: Recommendation["track"];
}

interface PlaylistResponse {
  sessionId: string;
  context: StudyContext;
  playlist: {
    tracks: Recommendation[];
    totalSec: number;
    budgetMin: number;
    shortfallSec: number;
  };
}

const EXAMPLES = [
  "今晚准备写代码两个小时，有点累，而且容易走神。想听安静一点、歌词少一点的音乐。",
  "明天要考试，压力很大很焦虑，复习一小时，来点能静下心的",
  "晚上精力充沛，刷题三个小时，来点带感的",
  "看书的时候想听纯音乐，不要人声，最好 lofi 和钢琴",
  "无聊想打发时间，随便放点歌就好",
];

const ENERGY_ZH: Record<string, string> = { low: "低", medium: "中", high: "高" };

export default function App(): React.ReactElement {
  const [tab, setTab] = useState<"recommend" | "library" | "history">("recommend");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const [feedbackByTrack, setFeedbackByTrack] = useState<Record<string, FeedbackType>>({});
  const [miniMode, setMiniMode] = useState(false);
  const [appInfo, setAppInfo] = useState<{ version: string | null; dataDir: string | null; llmAvailable: boolean } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !hasOnboarded());
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [basedOn, setBasedOn] = useState<Recommendation["track"] | null>(null);
  const desktop = isDesktopApp();

  const finishOnboarding = useCallback((): void => {
    markOnboarded();
    setShowOnboarding(false);
  }, []);

  const toggleMiniMode = useCallback((): void => {
    if (!desktop) return;
    const next = !miniMode;
    setMiniMode(next);
    document.body.classList.toggle("mini-mode", next);
    void window.electronAPI?.setMiniMode(next);
    // 小窗空间有限，引导中出现小窗切换时直接完成引导
    if (next && showOnboarding) finishOnboarding();
  }, [desktop, miniMode, showOnboarding, finishOnboarding]);

  const refreshLibraryCount = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/library");
      const data = (await res.json()) as { count: number };
      setLibraryCount(data.count);
    } catch {
      setLibraryCount(null);
    }
  }, []);

  useEffect(() => {
    void refreshLibraryCount();
  }, [refreshLibraryCount]);

  const refreshHealth = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as { version: string | null; dataDir: string | null; llm?: boolean };
      setAppInfo({ version: data.version ?? null, dataDir: data.dataDir ?? null, llmAvailable: data.llm === true });
    } catch {
      /* health 拉不到时帮助页显示占位文案 */
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const requestRecommend = useCallback(
    async (overrides?: { excludeTrackIds?: string[]; sessionId?: string }): Promise<void> => {
      const text = input.trim();
      if (!text) {
        setError("先描述一下你现在的状态吧");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: text,
            sessionId: overrides?.sessionId ?? result?.sessionId,
            excludeTrackIds: overrides?.excludeTrackIds,
          }),
        });
        const data = (await res.json()) as RecommendResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "推荐失败");
        setResult(data);
        setPlaylist(null);
        setBasedOn(null);
        setFeedbackByTrack({});
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [input, result?.sessionId],
  );

  const requestSimilar = useCallback(
    async (trackId: string, track: Recommendation["track"]): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/recommend-similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId, sessionId: result?.sessionId }),
        });
        const data = (await res.json()) as SimilarResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "推荐失败");
        setResult({ sessionId: data.sessionId, context: data.context, recommendations: data.recommendations });
        setPlaylist(null);
        setBasedOn(track);
        setFeedbackByTrack({});
        setTab("recommend");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [result?.sessionId],
  );

  const requestPlaylist = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!text) {
      setError("先描述一下你现在的状态吧");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text, sessionId: result?.sessionId }),
      });
      const data = (await res.json()) as PlaylistResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "歌单生成失败");
        setPlaylist(data);
        setResult(null);
        setBasedOn(null);
        setFeedbackByTrack({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [input, result?.sessionId]);

  const sendFeedback = useCallback(
    async (trackId: string, type: FeedbackType): Promise<void> => {
      setFeedbackByTrack((prev) => ({ ...prev, [trackId]: type }));
      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId, type, sessionId: result?.sessionId }),
        });
      } catch {
        // 网络失败时保持 UI 状态，不打断用户
      }
    },
    [result?.sessionId],
  );

  const nextBatch = useCallback((): void => {
    if (!result) return;
    const exclude = result.recommendations.map((r) => r.track.id);
    void requestRecommend({ excludeTrackIds: exclude, sessionId: result.sessionId });
  }, [result, requestRecommend]);

  return (
    <>
      <header className="header">
        <div className="brand">
          <h1>StudyMood DJ</h1>
          <span className="tagline">描述你的学习状态，从自己的音乐库里找到现在最合适的歌</span>
        </div>
        <div className="lib-count">
          {desktop && (
            <a onClick={toggleMiniMode} title={miniMode ? "切回主页面" : "切换到桌面小窗"}>
              {miniMode ? "⧉ 主页面" : "⊞ 小窗"}
            </a>
          )}
          {"  "}
          <a
            onClick={() => {
              setTab(tab === "library" ? "recommend" : "library");
            }}
          >
            音乐库 {libraryCount === null ? "…" : `${libraryCount} 首`}
          </a>
          {"  "}
          <a onClick={() => setShowSettings(true)} title="LLM / 网易云 Cookie 配置">
            ⚙ 设置
          </a>
          {"  "}
          <a onClick={() => setShowHelp(true)} title="帮助与隐私">
            ？帮助
          </a>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "recommend" ? "tab active" : "tab"} onClick={() => setTab("recommend")}>
          推荐
        </button>
        <button className={tab === "library" ? "tab active" : "tab"} onClick={() => setTab("library")}>
          音乐库
        </button>
        <button className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>
          历史
        </button>
      </nav>

      {tab === "recommend" ? (
        <>
          <NowPlayingBar onSimilar={(id, track) => void requestSimilar(id, track)} />

          <section className="input-card">
            <label htmlFor="status-input">你现在是什么状态？</label>
            <textarea
              id="status-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如：今晚准备写代码两个小时，有点累，容易走神。想听安静一点、歌词少一点的音乐。"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void requestRecommend();
              }}
            />
            <div className="examples">
              {EXAMPLES.map((ex, i) => (
                <button key={i} className="example-chip" onClick={() => setInput(ex)}>
                  {ex.length > 22 ? `${ex.slice(0, 22)}…` : ex}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="primary-btn" style={{ flex: 1 }} disabled={loading} onClick={() => void requestRecommend()}>
                {loading ? "正在理解你的状态…" : "获取推荐（Ctrl+Enter）"}
              </button>
              <button className="ghost-btn" style={{ marginTop: 14, padding: "0 18px" }} disabled={loading} onClick={() => void requestPlaylist()}>
                🎵 生成歌单
              </button>
            </div>
          </section>

          {error !== null && <div className="error-box">{error}</div>}

          {playlist !== null && (
            <>
              <ContextPanel context={playlist.context} />
              <div className="result-header">
                <h2>
                  学习歌单 · {playlist.playlist.tracks.length} 首 · 约 {Math.round(playlist.playlist.totalSec / 60)} 分钟
                  <span style={{ color: "var(--text-faint)", fontSize: 12, fontWeight: 400 }}>（目标 {playlist.playlist.budgetMin} 分钟）</span>
                </h2>
              </div>
              {playlist.playlist.tracks.map((rec, i) => (
                <TrackCard
                  key={rec.track.id}
                  rec={rec}
                  rank={i + 1}
                  feedback={feedbackByTrack[rec.track.id]}
                  onFeedback={sendFeedback}
                />
              ))}
              {playlist.playlist.shortfallSec > 60 && (
                <div className="empty">曲库里符合条件的歌不够填满 {playlist.playlist.budgetMin} 分钟，先去多导入一些吧。</div>
              )}
            </>
          )}

          {result !== null && (
            <ContextPanel context={result.context} />
          )}

          {result !== null && (
            <>
              <div className="result-header">
                <h2>
                  {basedOn !== null
                    ? `基于《${basedOn.title}》为你选了 ${result.recommendations.length} 首`
                    : `为你选了 ${result.recommendations.length} 首`}
                </h2>
                <button className="ghost-btn" disabled={loading} onClick={nextBatch}>
                  换一批
                </button>
              </div>
              {result.recommendations.map((rec, i) => (
                <TrackCard
                  key={rec.track.id}
                  rec={rec}
                  rank={i + 1}
                  feedback={feedbackByTrack[rec.track.id]}
                  onFeedback={sendFeedback}
                />
              ))}
            </>
          )}

          {result === null && !loading && error === null && (
            <div className="empty">
              <div className="big">🎧</div>
              告诉我你现在的状态，我来从你的音乐库里挑几首合适的。
            </div>
          )}
        </>
      ) : tab === "library" ? (
        <LibraryView onChanged={refreshLibraryCount} llmAvailable={appInfo?.llmAvailable === true} />
      ) : (
        <HistoryView />
      )}

      {showOnboarding && !miniMode && <Onboarding onDone={finishOnboarding} />}
      {showHelp && (
        <HelpModal
          version={appInfo?.version ?? null}
          dataDir={appInfo?.dataDir ?? null}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onSaved={() => void refreshHealth()} />
      )}

      <footer className="footer">
        StudyMood DJ · 本地优先 · 音乐库与反馈数据只保存在你的电脑上
        {result !== null && (
          <span>
            {" "}
            · 解析置信度 {(result.context.parserMeta.confidence * 100).toFixed(0)}%
            {result.parsedBy === "llm" && " · 🤖 LLM 理解"}
            {result.context.parserMeta.unknowns.length > 0 &&
              ` · 未提及: ${result.context.parserMeta.unknowns.join("、")}`}
          </span>
        )}
      </footer>
    </>
  );
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function energyLabel(e: number | undefined): string {
  if (e === undefined) return "未知";
  if (e < 0.33) return "安静";
  if (e < 0.66) return "适中";
  return "带感";
}

export function levelLabel(l: string | undefined): string {
  return l === undefined ? "未提及" : (ENERGY_ZH[l] ?? l);
}
