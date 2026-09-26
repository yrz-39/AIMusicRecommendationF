import { useCallback, useEffect, useRef, useState } from "react";
import { parseBlob } from "music-metadata";
import type { Track } from "../../core/types.js";
import { assembleTrack, type AudioTags } from "../../core/import/audio.js";
import { normalizeGenres } from "../../core/import/genreMap.js";
import { energyLabel, formatDuration } from "../App.js";

type ImportFormat = "json" | "csv" | "audio" | "netease";

interface ParsedAudio {
  fileName: string;
  track?: Track;
  reason?: string;
}

const AUDIO_ACCEPT = ".mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,audio/*";

const CSV_TEMPLATE =
  "歌名,歌手,专辑,时长,风格,能量,情绪,语言,纯音乐\n" +
  "晴天,周杰伦,叶惠美,4:29,pop,0.5,温暖,中文,0\n" +
  "Aruarian Dance,Nujabes,4:23,lofi,0.3,平静专注,纯音乐,1";

export function LibraryView({ onChanged, llmAvailable }: { onChanged: () => void; llmAvailable: boolean }): React.ReactElement {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [filter, setFilter] = useState("");
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [audioParsed, setAudioParsed] = useState<ParsedAudio[] | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const q = filter.trim().toLowerCase();
  const filtered = (tracks ?? []).filter(
    (t) => q === "" || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
  );

  const [prelabel, setPrelabel] = useState<{ done: number; total: number } | null>(null);
  const [prelabelMsg, setPrelabelMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/library");
      const data = (await res.json()) as { tracks: Track[] };
      setTracks(data.tracks);
    } catch {
      setTracks([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 分批调 LLM 预标注，展示「正在联网预处理」进度；每批完成即刷新曲库 */
  const runPrelabel = useCallback(
    async (trackIds: string[]): Promise<void> => {
      if (trackIds.length === 0) return;
      setPrelabelMsg(null);
      setPrelabel({ done: 0, total: trackIds.length });
      let labeled = 0;
      for (let i = 0; i < trackIds.length; i += 12) {
        const batch = trackIds.slice(i, i + 12);
        try {
          const res = await fetch("/api/library/prelabel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackIds: batch }),
          });
          if (res.ok) {
            const d = (await res.json()) as { labeled: string[] };
            labeled += d.labeled.length;
          }
        } catch {
          /* 单批失败继续下一批 */
        }
        setPrelabel((prev) => (prev ? { done: Math.min(prev.done + batch.length, prev.total), total: prev.total } : null));
      }
      setPrelabel(null);
      setPrelabelMsg(labeled > 0 ? `🤖 AI 已为 ${labeled} 首歌填充了初始听感特征，听到不准的随时「教它」修正` : "🤖 这些歌 AI 也没有把握，听到哪首教哪首吧");
      await load();
      onChanged();
    },
    [load, onChanged],
  );

  // ---------- 网易云歌单导入 ----------
  const [neteaseInput, setNeteaseInput] = useState("");
  const [neteaseBusy, setNeteaseBusy] = useState(false);
  const [neteaseMsg, setNeteaseMsg] = useState<string | null>(null);

  const importNetease = useCallback(async (): Promise<void> => {
    if (neteaseInput.trim() === "") {
      setNeteaseMsg("先粘贴歌单链接或 id");
      return;
    }
    setNeteaseMsg(null);
    setNeteaseBusy(true);
    try {
      const res = await fetch("/api/library/import-netease", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: neteaseInput }),
      });
      const data = (await res.json()) as {
        playlistName: string;
        imported: number;
        duplicates: number;
        ids: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      setNeteaseInput("");
      await load();
      onChanged();
      setNeteaseMsg(`歌单「${data.playlistName}」导入 ${data.imported} 首` + (data.duplicates > 0 ? `，${data.duplicates} 首已在曲库` : ""));
      if (data.ids.length > 0) await runPrelabel(data.ids);
    } catch (err) {
      setNeteaseMsg(`导入失败：${(err as Error).message}`);
    } finally {
      setNeteaseBusy(false);
    }
  }, [neteaseInput, load, onChanged, runPrelabel]);

  /** 一键补全曲库中所有缺失特征的歌（按当前列表实时计算） */
  const prelabelMissing = useCallback((): void => {
    const missing = (tracks ?? []).filter((t) => t.energy === undefined).map((t) => t.id);
    void runPrelabel(missing);
  }, [tracks, runPrelabel]);

  // ---------- 手动添加单曲 ----------
  const [addOpen, setAddOpen] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ title: "", artist: "", album: "", duration: "", genres: "" });

  const addTrack = useCallback(async (): Promise<void> => {
    setAddMsg(null);
    const title = addForm.title.trim();
    const artist = addForm.artist.trim();
    const durText = addForm.duration.trim();
    if (title === "" || artist === "") {
      setAddMsg("歌名和歌手是必填的");
      return;
    }
    let durationSec: number | undefined;
    const m = durText.match(/^(\d{1,3}):([0-5]\d)$/);
    if (m !== null) durationSec = Number(m[1]) * 60 + Number(m[2]);
    else if (/^\d{1,5}$/.test(durText)) durationSec = Number(durText);
    if (durationSec === undefined || durationSec <= 0) {
      setAddMsg("时长格式：mm:ss（如 4:29）或秒数");
      return;
    }
    const track = {
      id: `manual-${title.trim().toLowerCase().replace(/\s+/g, "-")}-${artist.trim().toLowerCase().replace(/\s+/g, "-")}`,
      title: title.trim(),
      artist: artist.trim(),
      album: addForm.album.trim() || undefined,
      durationSec,
      genres: addForm.genres.trim() !== "" ? normalizeGenres(addForm.genres.split(/[,，、]/)) : undefined,
      source: { kind: "manual" as const },
    };
    try {
      const res = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: [track] }),
      });
      const data = (await res.json()) as { imported: number; rejected: Array<{ reason: string }>; error?: string };
      if (!res.ok) throw new Error(data.error ?? "添加失败");
      if (data.imported === 0) throw new Error(`添加失败：${data.rejected[0]?.reason ?? "可能与现有曲目重复"}`);
      setAddMsg(`已添加「${title}」`);
      setAddForm({ title: "", artist: "", album: "", duration: "", genres: "" });
      await load();
      onChanged();
      void runPrelabel([track.id]);
    } catch (err) {
      setAddMsg((err as Error).message);
    }
  }, [addForm, load, onChanged, runPrelabel]);

  const deleteTrack = useCallback(
    async (id: string, title: string): Promise<void> => {
      if (!window.confirm(`确定从曲库删除「${title}」吗？（相关的教它记录会保留）`)) return;
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "删除失败");
        }
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await load();
        onChanged();
      } catch (err) {
        setImportMsg(`删除失败：${(err as Error).message}`);
      }
    },
    [load, onChanged],
  );

  // ---------- 批量删除 ----------
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));

  const toggleSelectAll = useCallback((): void => {
    setSelected((prev) => {
      if (filtered.length > 0 && filtered.every((t) => prev.has(t.id))) {
        // 全不选当前筛选结果
        const next = new Set(prev);
        for (const t of filtered) next.delete(t.id);
        return next;
      }
      const next = new Set(prev);
      for (const t of filtered) next.add(t.id);
      return next;
    });
  }, [filtered]);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`确定删除所选的 ${ids.length} 首歌吗？（相关的教它记录会保留）`)) return;
    try {
      const res = await fetch("/api/library/delete-tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "批量删除失败");
      }
      setSelected(new Set());
      await load();
      onChanged();
    } catch (err) {
      setImportMsg(`批量删除失败：${(err as Error).message}`);
    }
  }, [selected, load, onChanged]);

  const doImport = useCallback(async (): Promise<void> => {
    setImportMsg(null);
    try {
      const endpoint = format === "csv" ? "/api/library/import-csv" : "/api/library/import";
      const payload =
        format === "csv"
          ? { csv: importText }
          : { tracks: JSON.parse(importText) as unknown };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        imported: number;
        rejected: Array<{ row: number; reason: string }>;
        ids?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      setImportMsg(
        `导入 ${data.imported} 首` +
          (data.rejected.length > 0
            ? `，失败 ${data.rejected.length} 行（首行: ${data.rejected[0]?.reason}）`
            : ""),
      );
      if (data.imported > 0) setImportText("");
      await load();
      onChanged();
      const newIds = (data.ids ?? []).filter((id) => id !== "");
      if (newIds.length > 0) await runPrelabel(newIds);
    } catch (err) {
      setImportMsg(`导入失败：${(err as Error).message}`);
    }
  }, [format, importText, load, onChanged, runPrelabel]);

  /** 浏览器本地解析音频标签（文件不离开本机），解析失败时用文件名兜底 */
  const parseAudioFiles = useCallback(async (files: File[]): Promise<void> => {
    setAudioBusy(true);
    setAudioParsed(null);
    const results: ParsedAudio[] = [];
    for (const file of files) {
      try {
        const meta = await parseBlob(file, { duration: true });
        const tags: AudioTags = {
          title: meta.common.title,
          artist: meta.common.artist,
          album: meta.common.album,
          durationSec: meta.format.duration,
          genres: meta.common.genre,
        };
        results.push(assembleTrack(file.name, tags));
      } catch (err) {
        const fallback = assembleTrack(file.name, {});
        const detail = (err as Error).message;
        results.push({
          fileName: file.name,
          track: fallback.track,
          reason: fallback.reason !== undefined ? `${fallback.reason}（解析器：${detail}）` : undefined,
        });
      }
    }
    setAudioBusy(false);
    setAudioParsed(results);
  }, []);

  const importAudio = useCallback(async (): Promise<void> => {
    const tracks = (audioParsed ?? []).map((p) => p.track).filter((t): t is Track => t !== undefined);
    if (tracks.length === 0) return;
    setImportMsg(null);
    setAudioBusy(true);
    try {
      const res = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks }),
      });
      const data = (await res.json()) as {
        imported: number;
        rejected: Array<{ row: number; reason: string }>;
        ids?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      setImportMsg(
        `导入 ${data.imported} 首` +
          (data.rejected.length > 0 ? `，${data.rejected.length} 首与现有曲目重复已跳过` : ""),
      );
      setAudioParsed(null);
      await load();
      onChanged();
      // 新导入的歌特征为空：自动触发 AI 预标注（冷启动）
      const newIds = (data.ids ?? []).filter((id) => id !== "");
      if (newIds.length > 0) await runPrelabel(newIds);
    } catch (err) {
      setImportMsg(`导入失败：${(err as Error).message}`);
    } finally {
      setAudioBusy(false);
    }
  }, [audioParsed, load, onChanged, runPrelabel]);

  const onPickFile = useCallback(async (file: File): Promise<void> => {
    const text = await file.text();
    setImportText(text);
    setFormat(file.name.toLowerCase().endsWith(".json") ? "json" : "csv");
    setImportMsg(`已读取 ${file.name}，检查后点「导入」`);
  }, []);

  const [learnTrackId, setLearnTrackId] = useState<string | null>(null);
  const [learnText, setLearnText] = useState("");
  const [learnMsg, setLearnMsg] = useState<string | null>(null);

  const submitLearn = useCallback(async (): Promise<void> => {
    if (learnTrackId === null || learnText.trim() === "") return;
    setLearnMsg(null);
    try {
      const res = await fetch(`/api/tracks/${learnTrackId}/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: learnText }),
      });
      const data = (await res.json()) as { changes?: string[]; matched?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "学习失败");
      setLearnMsg(`已学习：${(data.changes ?? []).join("；") || "无变化"}`);
      setLearnText("");
      await load();
    } catch (err) {
      setLearnMsg((err as Error).message);
    }
  }, [learnTrackId, learnText, load]);

  const learnTrack = tracks?.find((t) => t.id === learnTrackId);

  return (
    <>
      <section className="input-card">
        <label>导入你的音乐</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
          <button className={format === "audio" ? "tab active" : "tab"} onClick={() => setFormat("audio")}>
            音频文件
          </button>
          <button className={format === "csv" ? "tab active" : "tab"} onClick={() => setFormat("csv")}>
            CSV
          </button>
          <button className={format === "json" ? "tab active" : "tab"} onClick={() => setFormat("json")}>
            JSON
          </button>
          <button className={format === "netease" ? "tab active" : "tab"} onClick={() => setFormat("netease")}>
            网易云歌单
          </button>
          {format !== "audio" && format !== "netease" && (
            <>
              <button className="ghost-btn" style={{ padding: "5px 12px" }} onClick={() => fileInputRef.current?.click()}>
                选择文件…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickFile(file);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>

        {format === "netease" ? (
          <div className="audio-import">
            <p className="audio-hint">
              在网易云 App 里打开你想导入的歌单 → 点「分享」→「复制链接」，粘贴到这里。
              会读取歌单里每首歌的<b>歌名、歌手、专辑、时长</b>（仅公开歌单；私密歌单读不了）。
              能量/情绪等听感特征随后由 AI 自动推断填充。
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="text"
                style={{
                  flex: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  background: "var(--card)",
                  color: "var(--text)",
                }}
                value={neteaseInput}
                onChange={(e) => setNeteaseInput(e.target.value)}
                placeholder="https://music.163.com/playlist?id=3778678 或分享口令全文"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !neteaseBusy) void importNetease();
                }}
              />
              <button
                className="primary-btn"
                style={{ marginTop: 0, width: "auto", padding: "8px 20px" }}
                disabled={neteaseBusy}
                onClick={() => void importNetease()}
              >
                {neteaseBusy ? "正在获取歌单…" : "获取并导入"}
              </button>
            </div>
            {neteaseMsg !== null && <div style={{ marginTop: 10, fontSize: 13.5, color: "var(--text-dim)" }}>{neteaseMsg}</div>}
          </div>
        ) : format === "audio" ? (
          <div className="audio-import">
            <p className="audio-hint">
              选择你电脑里的音乐文件（支持多选，mp3 / flac / m4a / ogg…），歌名、歌手、时长会自动从文件标签读取；
              标签缺失时按「歌手 - 歌名」文件名推断。<strong>解析和导入都在本机完成，文件不会上传。</strong>
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                className="primary-btn"
                style={{ marginTop: 0, width: "auto", padding: "9px 22px" }}
                disabled={audioBusy}
                onClick={() => audioInputRef.current?.click()}
              >
                {audioBusy ? "正在解析…" : "选择音频文件…"}
              </button>
              {audioParsed !== null && !audioBusy && (
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  解析出 {audioParsed.filter((p) => p.track !== undefined).length} 首
                  {audioParsed.some((p) => p.reason !== undefined) &&
                    `，${audioParsed.filter((p) => p.reason !== undefined).length} 个失败`}
                </span>
              )}
              <input
                ref={audioInputRef}
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void parseAudioFiles(files);
                  e.target.value = "";
                }}
              />
            </div>
            {audioParsed !== null && !audioBusy && (
              <>
                <table className="lib-table" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th>识别结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audioParsed.map((p) => (
                      <tr key={p.fileName}>
                        <td className="title" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.fileName}
                        </td>
                        <td style={{ color: p.track === undefined ? "var(--red)" : "var(--text-dim)" }}>
                          {p.track !== undefined
                            ? `${p.track.title} · ${p.track.artist} · ${formatDuration(p.track.durationSec)}`
                            : `无法导入：${p.reason}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    className="primary-btn"
                    style={{ marginTop: 0, width: "auto", padding: "8px 20px" }}
                    disabled={audioBusy || audioParsed.every((p) => p.track === undefined)}
                    onClick={() => void importAudio()}
                  >
                    导入
                  </button>
                  <button className="ghost-btn" onClick={() => setAudioParsed(null)}>
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <textarea
          id="status-input"
          style={{ minHeight: 70 }}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={
            format === "csv"
              ? "粘贴 CSV（表头支持中英文：歌名,歌手,专辑,时长,风格,能量,情绪,语言,纯音乐）\n" + CSV_TEMPLATE
              : '[{"title":"晴天","artist":"周杰伦","durationSec":269,"genres":["pop"],"energy":0.5,"vocalDensity":"high"}]'
          }
        />
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button
            className="primary-btn"
            style={{ marginTop: 0, width: "auto", padding: "9px 22px" }}
            disabled={importText.trim() === ""}
            onClick={() => void doImport()}
          >
            导入
          </button>
          {importMsg !== null && <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{importMsg}</span>}
        </div>
          </>
        )}
        {prelabel !== null && (
          <div className="prelabel-bar">
            <span className="pulse">🤖 正在联网预处理…（{prelabel.done}/{prelabel.total} 首）</span>
            <span className="dim">AI 正在根据歌名、歌手与流派判断听感特征</span>
          </div>
        )}
        {prelabel === null && prelabelMsg !== null && <div className="prelabel-bar done">{prelabelMsg}</div>}
        {llmAvailable && prelabel === null && (tracks ?? []).some((t) => t.energy === undefined) && (
          <div style={{ marginTop: 10 }}>
            <button
              className="ghost-btn"
              style={{ padding: "5px 14px" }}
              disabled={audioBusy}
              onClick={prelabelMissing}
            >
              🤖 AI 补全缺失特征（{(tracks ?? []).filter((t) => t.energy === undefined).length} 首）
            </button>
          </div>
        )}
      </section>

      {learnTrackId !== null && learnTrack !== undefined && (
        <section className="input-card" style={{ borderColor: "rgba(240, 130, 150, 0.35)" }}>
          <label>
            教它 —— 「{learnTrack.title} · {learnTrack.artist}」给了你什么感受？
          </label>
          <textarea
            id="status-input"
            style={{ minHeight: 54 }}
            value={learnText}
            onChange={(e) => setLearnText(e.target.value)}
            placeholder="例如：有力气，能够提高精力，振奋精神 / 很安静、能静下心 / 没有歌词"
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <button
              className="primary-btn"
              style={{ marginTop: 0, width: "auto", padding: "8px 20px" }}
              disabled={learnText.trim() === ""}
              onClick={() => void submitLearn()}
            >
              学习
            </button>
            <button className="ghost-btn" onClick={() => { setLearnTrackId(null); setLearnMsg(null); }}>
              取消
            </button>
            {learnMsg !== null && <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{learnMsg}</span>}
          </div>
        </section>
      )}

      <div className="lib-toolbar">
        <input
          type="text"
          placeholder="搜索歌名或歌手…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="ghost-btn"
          style={{ padding: "5px 12px" }}
          onClick={() => {
            setAddOpen(!addOpen);
            setAddMsg(null);
          }}
        >
          {addOpen ? "收起" : "＋ 添加歌曲"}
        </button>
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>
          {tracks === null ? "加载中" : `共 ${tracks.length} 首，显示 ${filtered.length} 首`}
        </span>
      </div>

      {addOpen && (
        <section className="input-card" style={{ padding: "16px 18px" }}>
          <div className="add-grid">
            <label>
              歌名 *
              <input value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} placeholder="晴天" />
            </label>
            <label>
              歌手 *
              <input value={addForm.artist} onChange={(e) => setAddForm({ ...addForm, artist: e.target.value })} placeholder="周杰伦" />
            </label>
            <label>
              专辑
              <input value={addForm.album} onChange={(e) => setAddForm({ ...addForm, album: e.target.value })} placeholder="叶惠美" />
            </label>
            <label>
              时长 *
              <input value={addForm.duration} onChange={(e) => setAddForm({ ...addForm, duration: e.target.value })} placeholder="4:29" />
            </label>
            <label>
              风格（逗号分隔）
              <input value={addForm.genres} onChange={(e) => setAddForm({ ...addForm, genres: e.target.value })} placeholder="流行, 摇滚" />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <button
              className="primary-btn"
              style={{ marginTop: 0, width: "auto", padding: "8px 20px" }}
              onClick={() => void addTrack()}
            >
              添加到曲库
            </button>
            {addMsg !== null && <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{addMsg}</span>}
          </div>
        </section>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>已选 {selected.size} 首</span>
          <button className="danger-btn" onClick={() => void deleteSelected()}>
            🗑 删除所选
          </button>
          <button className="ghost-btn" onClick={() => setSelected(new Set())}>
            清空选择
          </button>
          <span className="dim">提示：配合上方搜索框可按歌手/关键词批量选中</span>
        </div>
      )}

      {tracks !== null && (
        <table className="lib-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  aria-label="全选当前列表"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>歌曲</th>
              <th>歌手</th>
              <th>风格</th>
              <th>能量</th>
              <th>时长</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${t.title}`}
                    checked={selected.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                  />
                </td>
                <td className="title">{t.title}</td>
                <td>{t.artist}</td>
                <td>{(t.genres ?? []).join(" / ") || "—"}</td>
                <td>
                  <div className="energy-cell">
                    <span>{energyLabel(t.energy)}</span>
                    <div className="bar">
                      <i style={{ width: `${(t.energy ?? 0.5) * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td>{formatDuration(t.durationSec)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="ghost-btn"
                      style={{ padding: "3px 10px", fontSize: 12 }}
                      onClick={() => { setLearnTrackId(t.id); setLearnMsg(null); setLearnText(""); }}
                    >
                      教它
                    </button>
                    <button
                      className="ghost-btn"
                      style={{ padding: "3px 10px", fontSize: 12, color: "var(--red)" }}
                      onClick={() => void deleteTrack(t.id, t.title)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="lib-note">
        CSV 表头：歌名/歌手/专辑/时长(如 4:29)/风格/能量(0-1)/情绪/语言/纯音乐(0或1)，列名顺序不限、缺列可省。
        数据只保存在本机 data/ 目录，不会上传。
      </p>
    </>
  );
}
