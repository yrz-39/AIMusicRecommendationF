import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../../core/types.js";

/** 桌面检测来源（/api/now-playing/current） */
interface DesktopNowPlaying {
  playing: boolean;
  title?: string;
  artist?: string;
  source?: "netease" | "qq" | "unknown";
  track: Track | null;
}

/** ncm 播放器状态（/api/netease/state） */
interface NcmState {
  available: boolean;
  status: string;
  playing: boolean;
  title?: string;
  artist?: string;
  queueLength: number;
  track: Track | null;
  error?: string;
}

interface LearnResponse {
  track: Track;
  changes: string[];
  error?: string;
}

/**
 * 双播放条：
 * - ncm 播放器条（交付会话）：mpv 正在放的歌 + 完整遥控 ⏮⏯⏭⏹；点击后乐观翻转图标并立即
 *   刷新状态，不等下一个轮询周期（否则要等 CLI 调用 + 最长 6s 轮询，体感迟钝）。
 * - 客户端条（网易云/QQ 桌面检测）：客户端在放的歌 + 教它/基于这首歌推荐（客户端不可程序遥控）。
 * 两个来源独立显示、可同时可见；都没有播放时整块隐藏，不打扰。
 */
export function NowPlayingBar({
  onSimilar,
  ncmControls = false,
}: {
  onSimilar: (trackId: string, track: Track) => void;
  /** ncm-cli 可用时显示 ncm 播放器条 */
  ncmControls?: boolean;
}): React.ReactElement | null {
  const [desktop, setDesktop] = useState<DesktopNowPlaying | null>(null);
  const [ncm, setNcm] = useState<NcmState | null>(null);
  /** 遥控后的乐观播放态（点击立即反馈，轮询确认后清除） */
  const [ncmPlayingOverride, setNcmPlayingOverride] = useState<boolean | null>(null);
  const [learnOpen, setLearnOpen] = useState<"desktop" | "ncm" | null>(null);
  const [learnText, setLearnText] = useState("");
  const [learnMsg, setLearnMsg] = useState<string | null>(null);
  const [learnLoading, setLearnLoading] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [ctlBusy, setCtlBusy] = useState(false);
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const ncmActiveRef = useRef(false);

  const poll = useCallback(async (): Promise<void> => {
    try {
      if (typeof document === "undefined" || !document.hidden) {
        const [dRes, nRes] = await Promise.all([
          fetch("/api/now-playing/current")
            .then((r) => r.json() as Promise<DesktopNowPlaying>)
            .catch(() => null),
          ncmControls
            ? fetch("/api/netease/state")
                .then((r) => r.json() as Promise<NcmState>)
                .catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!disposedRef.current) {
          if (dRes !== null) setDesktop(dRes);
          if (nRes !== null) {
            setNcm(nRes);
            // 轮询确认与乐观值一致后清除，避免覆盖真实状态
            setNcmPlayingOverride((prev) => (prev !== null && nRes.playing === prev ? null : prev));
          }
        }
      }
    } finally {
      if (!disposedRef.current) {
        // 交付会话活跃时轮询加密到 3s，空闲 6s
        const interval = ncmActiveRef.current ? 3000 : 6000;
        timerRef.current = window.setTimeout(() => void poll(), interval);
      }
    }
  }, [ncmControls]);

  useEffect(() => {
    disposedRef.current = false;
    void poll();
    return () => {
      disposedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [poll]);

  const submitLearn = useCallback(
    async (track: Track | null): Promise<void> => {
      if (track === null) return;
      const text = learnText.trim();
      if (text === "") {
        setLearnMsg("先用一句话描述这首歌给你的感受");
        return;
      }
      setLearnLoading(true);
      setLearnMsg(null);
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/learn`, {
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
    },
    [learnText],
  );

  const requestSimilar = useCallback(
    async (track: Track | null): Promise<void> => {
      if (track === null) return;
      setSimilarLoading(true);
      try {
        onSimilar(track.id, track);
      } finally {
        setSimilarLoading(false);
      }
    },
    [onSimilar],
  );

  const sendControl = useCallback(
    async (action: "pause" | "resume" | "stop" | "next" | "prev"): Promise<void> => {
      // 乐观更新：点击立即翻转图标，CLI 调用完成后立即刷新确认
      if (action === "pause" || action === "stop") setNcmPlayingOverride(false);
      else if (action === "resume") setNcmPlayingOverride(true);
      setCtlBusy(true);
      try {
        await fetch("/api/netease/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      } catch {
        /* 遥控失败静默，下一次轮询自会纠正 */
      } finally {
        setCtlBusy(false);
        void poll();
      }
    },
    [poll],
  );

  const ncmQueueActive =
    ncmControls && ncm !== null && ncm.available && (ncm.playing || ncmPlayingOverride === true || ncm.queueLength > 0);
  ncmActiveRef.current = ncmQueueActive;
  const ncmEffectivePlaying = ncmPlayingOverride ?? ncm?.playing === true;
  const desktopPlaying = desktop?.playing === true;

  if (!ncmQueueActive && !desktopPlaying) return null;

  const renderBar = (
    key: "ncm" | "desktop",
    emoji: string,
    prefix: string,
    title: string | undefined,
    artist: string | undefined,
    sourceHint: string | null,
    track: Track | null,
    controls: React.ReactElement | null,
    barClass: string,
  ): React.ReactElement => (
    <section key={key} className={`np-bar ${barClass}`}>
      <div className="np-main">
        <span className="np-emoji">{emoji}</span>
        <span className="np-text">
          {prefix}：<strong>《{title}》</strong>
          {artist !== undefined && artist !== "" && <span className="np-artist"> - {artist}</span>}
          {sourceHint !== null && <span className="np-hint">（{sourceHint}）</span>}
          {key === "desktop" && track === null && (
            <span className="np-hint">（不在曲库中，去「音乐库」添加后才能教它）</span>
          )}
        </span>
        {controls}
        {track !== null && (
          <span className="np-actions">
            <button className="ghost-btn np-btn" disabled={similarLoading} onClick={() => void requestSimilar(track)}>
              {similarLoading ? "…" : "基于这首歌推荐"}
            </button>
            <button
              className="ghost-btn np-btn"
              onClick={() => {
                setLearnOpen(learnOpen === key ? null : key);
                setLearnMsg(null);
              }}
            >
              {learnOpen === key ? "收起" : "教它"}
            </button>
          </span>
        )}
      </div>
      {track !== null && learnOpen === key && (
        <div className="np-learn">
          <textarea
            value={learnText}
            onChange={(e) => setLearnText(e.target.value)}
            placeholder={`《${track.title}》给你什么感受？例如：给我力气，能提高精力 / 很安静，能静心 / 没有歌词`}
            rows={2}
          />
          <div className="np-learn-actions">
            <button className="primary-btn np-learn-btn" disabled={learnLoading} onClick={() => void submitLearn(track)}>
              {learnLoading ? "正在学习…" : "记住这个感受"}
            </button>
          </div>
          {learnMsg !== null && <div className="np-learn-msg">{learnMsg}</div>}
        </div>
      )}
    </section>
  );

  const ncmBar =
    ncmQueueActive && ncm !== null
      ? renderBar(
          "ncm",
          ncmEffectivePlaying ? "🎵" : "⏸",
          ncmEffectivePlaying ? "正在播放" : "已暂停",
          ncm.title,
          ncm.artist,
          "ncm 播放器",
          ncm.track,
          <span className="np-actions np-ctl">
            <button className="ghost-btn np-btn" title="上一首" disabled={ctlBusy} onClick={() => void sendControl("prev")}>
              ⏮
            </button>
            <button
              className="ghost-btn np-btn"
              title={ncmEffectivePlaying ? "暂停" : "继续播放"}
              disabled={ctlBusy}
              onClick={() => void sendControl(ncmEffectivePlaying ? "pause" : "resume")}
            >
              {ncmEffectivePlaying ? "⏸" : "▶"}
            </button>
            <button className="ghost-btn np-btn" title="下一首" disabled={ctlBusy} onClick={() => void sendControl("next")}>
              ⏭
            </button>
            <button className="ghost-btn np-btn" title="停止并清空队列" disabled={ctlBusy} onClick={() => void sendControl("stop")}>
              ⏹
            </button>
          </span>,
          "ncm",
        )
      : null;

  const desktopBar = desktopPlaying
    ? renderBar(
        "desktop",
        "🎵",
        "正在播放",
        desktop?.title,
        desktop?.artist,
        desktop?.source === "qq" ? "QQ音乐" : desktop?.source === "netease" ? "网易云客户端" : null,
        desktop?.track ?? null,
        null,
        "",
      )
    : null;

  return (
    <>
      {ncmBar}
      {desktopBar}
    </>
  );
}
