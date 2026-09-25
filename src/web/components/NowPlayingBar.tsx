import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../../core/types.js";

interface NowPlayingCurrent {
  playing: boolean;
  title?: string;
  artist?: string;
  source?: string;
  track: Track | null;
}

interface LearnResponse {
  track: Track;
  changes: string[];
  error?: string;
}

/**
 * 正在播放条：轮询桌面客户端的播放状态（网易云/QQ 音乐窗口标题），
 * 检测到播放且能在曲库中匹配到曲目时，提供两个动作：
 * 「教它」（自然语言特征学习）与「基于这首歌推荐」。
 * 没有检测到播放时整条隐藏，不打扰；轮询失败静默降级。
 */
export function NowPlayingBar({
  onSimilar,
}: {
  onSimilar: (trackId: string, track: Track) => void;
}): React.ReactElement | null {
  const [state, setState] = useState<NowPlayingCurrent | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnText, setLearnText] = useState("");
  const [learnMsg, setLearnMsg] = useState<string | null>(null);
  const [learnLoading, setLearnLoading] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const poll = useCallback(async (): Promise<void> => {
    try {
      if (typeof document === "undefined" || !document.hidden) {
        const res = await fetch("/api/now-playing/current");
        const data = (await res.json()) as NowPlayingCurrent;
        if (!disposedRef.current) setState(data);
      }
    } catch {
      if (!disposedRef.current) setState(null);
    } finally {
      if (!disposedRef.current) {
        timerRef.current = window.setTimeout(() => void poll(), 6000);
      }
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    void poll();
    return () => {
      disposedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [poll]);

  const submitLearn = useCallback(async (): Promise<void> => {
    if (state?.track === undefined || state.track === null) return;
    const text = learnText.trim();
    if (text === "") {
      setLearnMsg("先用一句话描述这首歌给你的感受");
      return;
    }
    setLearnLoading(true);
    setLearnMsg(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(state.track.id)}/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as LearnResponse;
      if (!res.ok) throw new Error(data.error ?? "学习失败");
      setLearnMsg(`已学习：${data.changes.join("；")}`);
      setLearnText("");
    } catch (err) {
      setLearnMsg((err as Error).message);
    } finally {
      setLearnLoading(false);
    }
  }, [state?.track, learnText]);

  const requestSimilar = useCallback(async (): Promise<void> => {
    if (state?.track === undefined || state.track === null) return;
    setSimilarLoading(true);
    try {
      onSimilar(state.track.id, state.track);
    } finally {
      setSimilarLoading(false);
    }
  }, [state?.track, onSimilar]);

  // 没检测到播放：整条隐藏
  if (state === null || !state.playing) return null;

  const track = state.track;
  return (
    <section className="np-bar">
      <div className="np-main">
        <span className="np-emoji">🎵</span>
        <span className="np-text">
          正在播放：<strong>《{state.title}》</strong>
          {state.artist !== undefined && <span className="np-artist"> - {state.artist}</span>}
          {track === null && (
            <span className="np-hint">（不在曲库中，去「音乐库」添加后才能教它）</span>
          )}
        </span>
        {track !== null && (
          <span className="np-actions">
            <button className="ghost-btn np-btn" disabled={similarLoading} onClick={() => void requestSimilar()}>
              {similarLoading ? "…" : "基于这首歌推荐"}
            </button>
            <button
              className="ghost-btn np-btn"
              onClick={() => {
                setLearnOpen(!learnOpen);
                setLearnMsg(null);
              }}
            >
              {learnOpen ? "收起" : "教它"}
            </button>
          </span>
        )}
      </div>
      {track !== null && learnOpen && (
        <div className="np-learn">
          <textarea
            value={learnText}
            onChange={(e) => setLearnText(e.target.value)}
            placeholder={`《${track.title}》给你什么感受？例如：给我力气，能提高精力 / 很安静，能静心 / 没有歌词`}
            rows={2}
          />
          <div className="np-learn-actions">
            <button className="primary-btn np-learn-btn" disabled={learnLoading} onClick={() => void submitLearn()}>
              {learnLoading ? "正在学习…" : "记住这个感受"}
            </button>
          </div>
          {learnMsg !== null && <div className="np-learn-msg">{learnMsg}</div>}
        </div>
      )}
    </section>
  );
}
