import type { FeedbackType } from "../App.js";
import { energyLabel, formatDuration } from "../App.js";
import type { Recommendation } from "../../core/types.js";

export function TrackCard(props: {
  rec: Recommendation;
  rank: number;
  feedback?: FeedbackType;
  onFeedback: (trackId: string, type: FeedbackType) => void;
}): React.ReactElement {
  const { rec, rank, feedback, onFeedback } = props;
  const { track, score, reasons } = rec;

  return (
    <article className="track-card">
      <div className="track-top">
        <div className={rank <= 3 ? "rank top" : "rank"}>{rank}</div>
        <div className="track-meta">
          <div className="track-title">{track.title}</div>
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
          <div className="score-value">{score.toFixed(1)}</div>
          <div className="score-bar">
            <i style={{ width: `${score}%` }} />
          </div>
          <div className="score-label">匹配度</div>
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
      </div>
    </article>
  );
}
