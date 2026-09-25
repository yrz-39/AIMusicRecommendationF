import { useState } from "react";

const STORAGE_KEY = "studymood.onboarded.v1";

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // localStorage 不可用时不再打扰用户
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

const STEPS: Array<{ emoji: string; title: string; body: React.ReactElement }> = [
  {
    emoji: "🌸",
    title: "欢迎来到 StudyMood DJ",
    body: (
      <>
        <p>
          描述你现在的学习状态，它会从<strong>你自己的音乐库</strong>里挑出现在最合适的歌，
          并且告诉你<strong>为什么</strong>选它。
        </p>
        <p className="privacy-note">
          🔒 本地优先：曲库、反馈和推荐历史只保存在这台电脑上，不联网、不上传、无遥测。
        </p>
      </>
    ),
  },
  {
    emoji: "🎧",
    title: "三步开始",
    body: (
      <ol className="help-list">
        <li>
          在「推荐」页用一句话描述状态，比如
          <em>「有点累，要写代码两小时，想听安静一点、歌词少的」</em>；
        </li>
        <li>它会理解任务、时长、精力、情绪，给出 10 首带理由的推荐，也能按时长生成整张歌单；</li>
        <li>
          觉得合适点 <span className="fb like">❤️</span>，不合适点 <span className="fb bad">✕</span>
          ，它会记住你的口味，越用越懂你。
        </li>
      </ol>
    ),
  },
  {
    emoji: "✨",
    title: "让它更懂你",
    body: (
      <ul className="help-list">
        <li>
          <strong>导入自己的曲库</strong>：「音乐库」页支持粘贴 CSV / JSON，或直接选文件；
        </li>
        <li>
          <strong>教它一首歌</strong>：在音乐库搜到歌后，用自然语言描述感受，比如
          「这首歌给我力气，能提高精力」；
        </li>
        <li>
          <strong>桌面小窗</strong>：右上角 ⊞ 可切到置顶小窗（仅桌面版），边学习边换歌不打断。
        </li>
      </ul>
    ),
  },
];

/** 新用户首次启动引导（localStorage 标记，只出现一次） */
export function Onboarding({ onDone }: { onDone: () => void }): React.ReactElement {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const current = STEPS[step];
  if (current === undefined) return <></>;

  const finish = (): void => {
    markOnboarded();
    onDone();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="modal-card onboarding">
        <div className="onboard-emoji">{current.emoji}</div>
        <h2>{current.title}</h2>
        <div className="onboard-body">{current.body}</div>
        <div className="onboard-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? "dot active" : "dot"} />
          ))}
        </div>
        <div className="onboard-actions">
          <button className="ghost-btn" onClick={finish}>
            跳过
          </button>
          <button
            className="primary-btn"
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? "开始使用 🌸" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
