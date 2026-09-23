/**
 * StudyMood DJ 核心领域模型。
 *
 * 该模块及其下游（parser / recommend / personalization）保持纯净：
 * 不做 I/O、不依赖运行环境，保证推荐核心可测试、可观察、可移植。
 */

/** 一首歌曲的规范化元数据。字段刻意保持来源无关：
 *  本地文件 / CSV / JSON / 网易云等来源通过 importer 映射到该结构。
 *  title/artist/album/duration 保证未来可通过网易云检索定位。 */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** 秒 */
  durationSec: number;
  /** 主要语言，如 zh / en / ja / ko；纯音乐用 "instrumental" */
  language?: string;
  /** 是否纯音乐（无人声） */
  isInstrumental?: boolean;
  /** 流派标签，如 lofi / classical / post-rock / city-pop */
  genres?: string[];
  /** 感知能量 0..1：0 极安静舒缓，1 高能提神。缺失时由流派先验推断 */
  energy?: number;
  /** 情绪/场景标签，如 calm / melancholic / uplifting / focus / dreamy */
  moodTags?: string[];
  /** 人声密度（歌词多少） */
  vocalDensity?: "none" | "low" | "medium" | "high";
  /** 来源信息 */
  source?: {
    kind: "sample" | "json" | "csv" | "manual" | "netease";
    importedAt?: string;
  };
  /** 预留：网易云检索定位信息（最终目标：自动搜索播放） */
  netease?: {
    songId?: number;
    /** 检索用的规范关键词，缺省由 title+artist 生成 */
    searchKeyword?: string;
  };
}

export type Level = "low" | "medium" | "high";

export interface MusicPrefs {
  /** 想听安静 / 适中 / 提神 */
  calmness?: "calm" | "balanced" | "energetic";
  /** 歌词偏好：纯音乐 / 歌词少 / 无所谓 */
  vocalPreference?: "instrumental" | "few-lyrics" | "any";
  genres?: string[];
  languages?: string[];
}

/** 结构化学习情境 —— 自然语言解析的目标产物，也是推荐引擎的输入。 */
export interface StudyContext {
  /** 学习/工作任务的自由文本描述，如 "写代码" */
  task?: string;
  /** 本次学习时长（分钟） */
  durationMinutes?: number;
  /** 当前精力 */
  energy?: Level;
  /** 当前压力 */
  stress?: Level;
  /** 专注难度（越 high 越容易走神） */
  focusDifficulty?: Level;
  /** 情绪标签，如 tired / anxious / bored / calm / motivated */
  moods?: string[];
  musicPrefs?: MusicPrefs;
  /** 原始输入，保留用于展示与调试 */
  rawInput: string;
  parserMeta: {
    parser: "rules" | "llm";
    /** 0..1，解析器的自评置信度 */
    confidence: number;
    /** 命中的关键词，供可解释展示 */
    matched: string[];
    /** 提到但无法确定的方面 */
    unknowns: string[];
  };
}

export type FeedbackType = "like" | "skip" | "not_suitable";

/** 单条反馈事件（持久化，随时间衰减影响推荐） */
export interface FeedbackEvent {
  id: string;
  trackId: string;
  type: FeedbackType;
  /** 反馈时的会话，用于串联一次推荐的连续反馈 */
  sessionId?: string;
  /** 反馈时的情境快照（脱敏后仅保留结构化字段） */
  contextSnapshot?: {
    task?: string;
    energy?: Level;
    stress?: Level;
    focusDifficulty?: Level;
  };
  createdAt: string;
}

/** 推荐结果的评分构成。每个分项都携带真实计算出的理由文本，禁止事后编造。 */
export interface ScoreComponent {
  key: "context" | "vocal" | "mood" | "preference" | "personal" | "freshness";
  /** 0..1，该分项的归一化得分 */
  score: number;
  weight: number;
  /** 由该分项真实计算逻辑生成的人话理由 */
  reason: string;
}

export interface Recommendation {
  track: Track;
  /** 0..100 综合分 */
  score: number;
  components: ScoreComponent[];
}

export interface RecommendationSession {
  id: string;
  createdAt: string;
  context: StudyContext;
  trackIds: string[];
}

/** 推荐引擎配置：权重集中在此，便于调整与实验。 */
export interface EngineConfig {
  weights: {
    context: number;
    vocal: number;
    mood: number;
    preference: number;
    personal: number;
    freshness: number;
  };
  /** 个性化正向偏差上限（百分制）：喜欢不应强行把曲目顶到最前 */
  personalCap: number;
  /** 个性化负向偏差上限：不适合/跳过必须可靠降权 */
  personalNegativeCap: number;
}
