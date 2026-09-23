import type { StudyContext } from "../../core/types.js";

const LEVEL_ZH: Record<string, string> = { low: "低", medium: "中", high: "高" };

const CALMNESS_ZH: Record<string, string> = { calm: "安静", balanced: "适中", energetic: "提神" };

const VOCAL_ZH: Record<string, string> = { instrumental: "纯音乐", "few-lyrics": "歌词少", any: "不限" };

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

export function ContextPanel({ context }: { context: StudyContext }): React.ReactElement {
  const prefs = context.musicPrefs ?? {};
  const chips: React.ReactNode[] = [];

  if (context.task !== undefined) {
    chips.push(<span key="task" className="chip">任务 <b>{context.task}</b></span>);
  }
  if (context.durationMinutes !== undefined) {
    const h = context.durationMinutes >= 60 ? `${Math.floor(context.durationMinutes / 60)} 小时${context.durationMinutes % 60 ? ` ${context.durationMinutes % 60} 分` : ""}` : `${context.durationMinutes} 分钟`;
    chips.push(<span key="dur" className="chip">时长 <b>{h}</b></span>);
  }
  if (context.energy !== undefined) {
    chips.push(<span key="energy" className="chip">精力 <b>{LEVEL_ZH[context.energy]}</b></span>);
  }
  if (context.stress !== undefined) {
    chips.push(<span key="stress" className="chip">压力 <b>{LEVEL_ZH[context.stress]}</b></span>);
  }
  if (context.focusDifficulty !== undefined) {
    chips.push(
      <span key="focus" className="chip">
        专注难度 <b>{LEVEL_ZH[context.focusDifficulty]}</b>
      </span>,
    );
  }
  for (const mood of context.moods ?? []) {
    chips.push(
      <span key={`mood-${mood}`} className="chip">
        情绪 <b>{MOOD_ZH[mood] ?? mood}</b>
      </span>,
    );
  }
  if (prefs.calmness !== undefined) {
    chips.push(
      <span key="calm" className="chip">
        想听 <b>{CALMNESS_ZH[prefs.calmness]}</b>
      </span>,
    );
  }
  if (prefs.vocalPreference !== undefined) {
    chips.push(
      <span key="vocal" className="chip">
        人声 <b>{VOCAL_ZH[prefs.vocalPreference]}</b>
      </span>,
    );
  }
  for (const g of prefs.genres ?? []) {
    chips.push(
      <span key={`genre-${g}`} className="chip">
        风格 <b>{g}</b>
      </span>,
    );
  }
  for (const lang of prefs.languages ?? []) {
    chips.push(
      <span key={`lang-${lang}`} className="chip">
        语言 <b>{lang}</b>
      </span>,
    );
  }

  return (
    <section className="context-panel">
      <h3>
        我理解的状态
        <span className="conf">（置信度 {(context.parserMeta.confidence * 100).toFixed(0)}%）</span>
      </h3>
      <div className="chip-row">
        {chips.length > 0 ? chips : <span className="chip gap">没有识别到具体信息，将按通用偏好推荐</span>}
        {context.parserMeta.unknowns.map((u) => (
          <span key={u} className="chip gap">
            未提及: {u}
          </span>
        ))}
      </div>
    </section>
  );
}
