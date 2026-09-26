import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../../core/types.js";

interface NowPlayingCurrent {
  playing: boolean;
  title?: string;
  artist?: string;
  /** ncm = 应用内 ncm-cli 播放器（Windows 上歌单交付的实际后端） */
  source?: "netease" | "qq" | "unknown" | "ncm";
  track: Track | null;
  /** ncm 队列信息：暂停时队列仍在，正在播放条要保持可见才能恢复 */
  ncmQueue?: { queueLength: number };
}

interface LearnResponse {
  track: Track;
  changes: string[];
  error?: string;
}

/**
 * 正在播放条：轮询桌面客户端的播放状态（SMTC/窗口标题 + ncm-cli 播放器兜底）。
 * - 桌面网易云/QQ 在放：显示来源并给「教它」「基于这首歌推荐」（此时 ncm 遥控不显示——它控制的是自己的队列）；
 * - ncm 播放器在放（歌单交付）：显示曲目并给 ⏮⏯⏭ 遥控；暂停后队列还在，条保持可见可恢复。
 * 没有任何播放时整条隐藏，不打扰；轮询失败静默降级。
 */
export function NowPlayingBar({
  onSimilar,
  ncmControls = false,
}: {
  onSimilar: (trackId: string, track: Track) => void;
  /** ncm-cli 可用时，ncm 播放器来源的条目显示播放遥控 */
  ncmControls?: boolean;
}): React.ReactElement | null {
  const [state, setState] = useState<NowPlayingCurrent | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnText, setLearnText] = useState("");
  const [learnMsg, setLearnMsg] = useState<string | null>(null);
  const [learnLoading, setLearnLoading] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [ctlBusy, setCtlBusy] = useState(false);
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

  const sendControl = useCallback(async (action: "pause" | "resume" | "next" | "prev"): Promise<void> => {
    setCtlBusy(true);
    try {
      await fetch("/api/netease/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      /* 遥控失败静默，状态条下次轮询自会纠正 */
    } finally {
      setCtlBusy(false);
    }
  }, []);

  // ncm 队列暂停中（playing=false 但队列还在）：条保持可见，可恢复
  const ncmPaused = state !== null && !state.playing && state.source === "ncm" && (state.ncmQueue?.queueLength ?? 0) > 0;
  // 没有任何播放：整条隐藏
  if (state === null || (!state.playing && !ncmPaused)) return null;

  const track = state.track;
  const isNcmSource = state.source === "ncm";
  const showControls = ncmControls && isNcmSource;
  return (
    <section className={isNcmSource ? "np-bar ncm" : "np-bar"}>
      <div className="np-main">
        <span className="np-emoji">{state.playing ? "🎵" : "⏸"}</span>
        <span className="np-text">
          {state.playing ? "正在播放：" : "已暂停："}
          <strong>《{state.title}》</strong>
          {state.artist !== undefined && state.artist !== "" && <span className="np-artist"> - {state.artist}</span>}
          {isNcmSource && <span className="np-hint">（ncm 播放器）</span>}
          {!isNcmSource && track === null && (
            <span className="np-hint">（不在曲库中，去「音乐库」添加后才能教它）</span>
          )}
        </span>
        {showControls && (
          <span className="np-actions np-ctl">
            <button className="ghost-btn np-btn" title="上一首" disabled={ctlBusy} onClick={() => void sendControl("prev")}>
              ⏮
            </button>
            <button
              className="ghost-btn np-btn"
              title={state.playing ? "暂停" : "继续播放"}
              disabled={ctlBusy}
              onClick={() => void sendControl(state.playing ? "pause" : "resume")}
            >
              {state.playing ? "⏸" : "▶"}
            </button>
            <button className="ghost-btn np-btn" title="下一首" disabled={ctlBusy} onClick={() => void sendControl("next")}>
              ⏭
            </button>
          </span>
        )}
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
