import { promises as fs } from "node:fs";
import path from "node:path";
import type { FeedbackEvent, RecommendationSession, Track } from "../core/types.js";

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
    try {
      const raw = await fs.readFile(this.file(name), "utf8");
      return JSON.parse(raw) as T;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return fallback;
      // 文件损坏时不要静默覆盖：抛出，由上层决定（保护用户数据）
      throw new Error(`数据文件 ${name} 读取失败: ${(err as Error).message}`);
    }
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const target = this.file(name);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, target);
  }

  async loadTracks(): Promise<Track[]> {
    const data = await this.readJson<{ tracks: Track[] }>("library.json", { tracks: [] });
    return data.tracks;
  }

  async saveTracks(tracks: Track[]): Promise<void> {
    await this.writeJson("library.json", { tracks, savedAt: new Date().toISOString() });
  }

  async loadFeedback(): Promise<FeedbackEvent[]> {
    const data = await this.readJson<{ events: FeedbackEvent[] }>("feedback.json", { events: [] });
    return data.events;
  }

  async appendFeedback(event: FeedbackEvent): Promise<void> {
    const data = await this.readJson<{ events: FeedbackEvent[] }>("feedback.json", { events: [] });
    data.events.push(event);
    await this.writeJson("feedback.json", data);
  }

  async loadSessions(): Promise<RecommendationSession[]> {
    const data = await this.readJson<{ sessions: RecommendationSession[] }>("sessions.json", { sessions: [] });
    return data.sessions;
  }

  async appendSession(session: RecommendationSession): Promise<void> {
    const data = await this.readJson<{ sessions: RecommendationSession[] }>("sessions.json", { sessions: [] });
    data.sessions.push(session);
    // 只保留最近 200 个会话，防止无限增长
    const trimmed = data.sessions.slice(-200);
    await this.writeJson("sessions.json", { sessions: trimmed });
  }

  async upsertSession(session: RecommendationSession): Promise<void> {
    const data = await this.readJson<{ sessions: RecommendationSession[] }>("sessions.json", { sessions: [] });
    const index = data.sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) data.sessions[index] = session;
    else data.sessions.push(session);
    const trimmed = data.sessions.slice(-200);
    await this.writeJson("sessions.json", { sessions: trimmed });
  }

  async loadFlag(name: string): Promise<boolean> {
    return this.readJson<{ value: boolean }>(`flag-${name}.json`, { value: false }).then((d) => d.value === true);
  }

  async saveFlag(name: string): Promise<void> {
    await this.writeJson(`flag-${name}.json`, { value: true });
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
}
