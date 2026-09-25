import { promises as fs } from "node:fs";
import path from "node:path";
import type { FeedbackEvent, RecommendationSession, Track } from "../core/types.js";

/** 一条自然语言歌曲特征学习记录（PRODUCT.md 支柱 3 的数据基础） */
export interface LearnEvent {
  id: string;
  trackId: string;
  text: string;
  /** 解析出的特征增量（可追溯"特征是怎么来的"） */
  delta: {
    energyHint?: string;
    moodTags: string[];
    vocalDensity?: string;
    matched: string[];
  };
  parsedBy: "rules" | "llm";
  changes: string[];
  createdAt: string;
}

/**
 * 本地 JSON 存储：local-first 的持久化层。
 *
 * - 库 / 反馈 / 会话 分文件存储，互不牵连；
 * - 原子写入（tmp + rename），进程崩溃不会留下半截文件；
 * - data/ 目录被 .gitignore 排除，用户数据永不入库。
 *
 * 未来若需 SQLite，替换该类即可，接口保持不变。
 */

export interface DataStore {
  loadTracks(): Promise<Track[]>;
  saveTracks(tracks: Track[]): Promise<void>;
  loadFeedback(): Promise<FeedbackEvent[]>;
  appendFeedback(event: FeedbackEvent): Promise<void>;
  loadSessions(): Promise<RecommendationSession[]>;
  appendSession(session: RecommendationSession): Promise<void>;
  /** 同一会话再次推荐时更新其曲目列表（按 id upsert） */
  upsertSession(session: RecommendationSession): Promise<void>;
  /** 持久化标记（首次运行导入示例库等一次性动作） */
  loadFlag(name: string): Promise<boolean>;
  saveFlag(name: string): Promise<void>;
  loadLearnEvents(): Promise<LearnEvent[]>;
  appendLearnEvent(event: LearnEvent): Promise<void>;
}

export class JsonFileStore implements DataStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = dataDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw new Error(`数据文件 ${name} 读取失败: ${(err as Error).message}`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 打包版的普通用户无法手动修数据文件，抛错会让应用永远起不来。
      // 折衷：把损坏文件改名保留（数据没有丢，可人工找回），应用从空状态继续。
      const quarantine = `${this.file(name)}.corrupt-${Date.now()}`;
      try {
        await fs.rename(this.file(name), quarantine);
        console.error(`[storage] ${name} 解析失败，已隔离为 ${path.basename(quarantine)}（原文件已保留）`);
      } catch (renameErr) {
        console.error(`[storage] ${name} 解析失败且隔离失败: ${(renameErr as Error).message}`);
      }
      return fallback;
    }
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const target = this.file(name);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, target);
  }

  async loadTracks(): Promise<Track[]> {
    const data = await this.readJson<{ tracks?: Track[] }>("library.json", {});
    return Array.isArray(data.tracks) ? data.tracks : [];
  }

  async saveTracks(tracks: Track[]): Promise<void> {
    await this.writeJson("library.json", { tracks, savedAt: new Date().toISOString() });
  }

  async loadFeedback(): Promise<FeedbackEvent[]> {
    const data = await this.readJson<{ events?: FeedbackEvent[] }>("feedback.json", {});
    return Array.isArray(data.events) ? data.events : [];
  }

  async appendFeedback(event: FeedbackEvent): Promise<void> {
    const events = await this.loadFeedback();
    events.push(event);
    await this.writeJson("feedback.json", { events });
  }

  async loadSessions(): Promise<RecommendationSession[]> {
    const data = await this.readJson<{ sessions?: RecommendationSession[] }>("sessions.json", {});
    return Array.isArray(data.sessions) ? data.sessions : [];
  }

  async appendSession(session: RecommendationSession): Promise<void> {
    const sessions = await this.loadSessions();
    sessions.push(session);
    // 只保留最近 200 个会话，防止无限增长
    await this.writeJson("sessions.json", { sessions: sessions.slice(-200) });
  }

  async upsertSession(session: RecommendationSession): Promise<void> {
    const sessions = await this.loadSessions();
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) sessions[index] = session;
    else sessions.push(session);
    await this.writeJson("sessions.json", { sessions: sessions.slice(-200) });
  }

  async loadFlag(name: string): Promise<boolean> {
    return this.readJson<{ value: boolean }>(`flag-${name}.json`, { value: false }).then((d) => d.value === true);
  }

  async saveFlag(name: string): Promise<void> {
    await this.writeJson(`flag-${name}.json`, { value: true });
  }

  async loadLearnEvents(): Promise<LearnEvent[]> {
    const data = await this.readJson<{ events?: LearnEvent[] }>("learnEvents.json", {});
    return Array.isArray(data.events) ? data.events : [];
  }

  async appendLearnEvent(event: LearnEvent): Promise<void> {
    const events = await this.loadLearnEvents();
    events.push(event);
    await this.writeJson("learnEvents.json", { events });
  }
}

/** 纯内存实现：测试与临时运行使用 */
export class MemoryStore implements DataStore {
  tracks: Track[] = [];
  events: FeedbackEvent[] = [];
  sessions: RecommendationSession[] = [];

  async loadTracks(): Promise<Track[]> {
    return this.tracks;
  }
  async saveTracks(tracks: Track[]): Promise<void> {
    this.tracks = [...tracks];
  }
  async loadFeedback(): Promise<FeedbackEvent[]> {
    return this.events;
  }
  async appendFeedback(event: FeedbackEvent): Promise<void> {
    this.events.push(event);
  }
  async loadSessions(): Promise<RecommendationSession[]> {
    return this.sessions;
  }
  async appendSession(session: RecommendationSession): Promise<void> {
    this.sessions.push(session);
  }
  async upsertSession(session: RecommendationSession): Promise<void> {
    const index = this.sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) this.sessions[index] = session;
    else this.sessions.push(session);
  }
  flags = new Set<string>();
  async loadFlag(name: string): Promise<boolean> {
    return this.flags.has(name);
  }
  async saveFlag(name: string): Promise<void> {
    this.flags.add(name);
  }
  learnEvents: LearnEvent[] = [];
  async loadLearnEvents(): Promise<LearnEvent[]> {
    return this.learnEvents;
  }
  async appendLearnEvent(event: LearnEvent): Promise<void> {
    this.learnEvents.push(event);
  }
}
