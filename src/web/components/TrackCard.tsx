import { useState } from "react";
import type { FeedbackType } from "../App.js";
import { energyLabel, formatDuration } from "../App.js";
import type { Recommendation } from "../../core/types.js";

function neteaseSearchUrl(track: Recommendation["track"]): string {
  const keyword = track.netease?.searchKeyword ?? `${track.title} ${track.artist}`;
  return `https://music.163.com/#/search/m/?s=${encodeURIComponent(keyword)}`;
}

export function TrackCard(props: {
  rec: Recommendation;
  rank: number;
  feedback?: FeedbackType;
  onFeedback: (trackId: string, type: FeedbackType) => void;
  /** 网易云全库补位的歌曲：显示「云补位」标记并提供「+ 曲库」 */
  supplement?: boolean;
  onAddToLibrary?: (rec: Recommendation) => Promise<void>;
}): React.ReactElement {
  const { rec, rank, feedback, onFeedback, supplement = false, onAddToLibrary } = props;
  const { track, score, reasons } = rec;
  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);

  const copySong = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${track.title} ${track.artist}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  const addToLibrary = async (): Promise<void> => {
    if (onAddToLibrary === undefined || adding || added) return;
    setAdding(true);
    try {
      await onAddToLibrary(rec);
      setAdded(true);
    } finally {
      setAdding(false);
    }
  };

  return (
    <article className={supplement ? "track-card supplement" : "track-card"}>
      <div className="track-top">
        <div className={rank <= 3 ? "rank top" : "rank"}>{rank}</div>
        <div className="track-meta">
          <div className="track-title">
            {track.title}
            {supplement && <span className="supplement-badge">网易云补充</span>}
          </div>
          <div className="track-sub">
            {track.artist}
            {track.album !== undefined && ` · 《${track.album}》`} · {formatDuration(track.durationSec)}
          </div>
          <div className="genre-tags">
            {(track.genres ?? []).slice(0, 3).map((g) => (
              <span key={g} className="genre-tag">
                {g}
              </span>
            ))}
            <span className="genre-tag energy">能量 {energyLabel(track.energy)}</span>
          </div>
        </div>
        <div className="score-box">
          {supplement ? (
            <>
              <div className="score-value supplement-mark">云补位</div>
              <div className="score-label">来自全库搜索</div>
            </>
          ) : (
            <>
              <div className="score-value">{score.toFixed(1)}</div>
              <div className="score-bar">
                <i style={{ width: `${score}%` }} />
              </div>
              <div className="score-label">匹配度</div>
            </>
          )}
        </div>
      </div>

      {reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="feedback-row">
        <button
          className={feedback === "like" ? "fb-btn liked" : "fb-btn"}
          disabled={feedback !== undefined}
          onClick={() => onFeedback(track.id, "like")}
        >
          ❤ 喜欢
        </button>
        <button
          className={feedback === "skip" ? "fb-btn skipped" : "fb-btn"}
          disabled={feedback !== undefined}
          onClick={() => onFeedback(track.id, "skip")}
        >
          ⏭ 跳过
        </button>
        <button
          className={feedback === "not_suitable" ? "fb-btn rejected" : "fb-btn"}
          disabled={feedback !== undefined}
          onClick={() => onFeedback(track.id, "not_suitable")}
        >
          ✕ 不适合
        </button>
        {feedback !== undefined && <span className="fb-hint">已记录，下次推荐会参考</span>}
        <span style={{ flex: 1 }} />
        {supplement && onAddToLibrary !== undefined && (
          <button className="fb-btn" disabled={adding || added} onClick={() => void addToLibrary()}>
            {added ? "✓ 已入库" : adding ? "入库中…" : "＋ 曲库"}
          </button>
        )}
        <button className="fb-btn" onClick={() => void copySong()}>
          {copied ? "✓ 已复制" : "⧉ 复制"}
        </button>
        <a className="fb-btn netease-link" href={neteaseSearchUrl(track)} target="_blank" rel="noreferrer">
          ▶ 网易云
        </a>
      </div>
    </article>
  );
}
