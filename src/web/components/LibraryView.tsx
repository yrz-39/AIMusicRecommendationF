import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../../core/types.js";
import { energyLabel, formatDuration } from "../App.js";

type ImportFormat = "json" | "csv";

const CSV_TEMPLATE =
  "歌名,歌手,专辑,时长,风格,能量,情绪,语言,纯音乐\n" +
  "晴天,周杰伦,叶惠美,4:29,pop,0.5,温暖,中文,0\n" +
  "Aruarian Dance,Nujabes,4:23,lofi,0.3,平静专注,纯音乐,1";

export function LibraryView({ onChanged }: { onChanged: () => void }): React.ReactElement {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [filter, setFilter] = useState("");
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    } catch (err) {
      setImportMsg(`导入失败：${(err as Error).message}`);
    }
  }, [format, importText, load, onChanged]);

  const onPickFile = useCallback(async (file: File): Promise<void> => {
    const text = await file.text();
    setImportText(text);
    setFormat(file.name.toLowerCase().endsWith(".json") ? "json" : "csv");
    setImportMsg(`已读取 ${file.name}，检查后点「导入」`);
  }, []);

  const q = filter.trim().toLowerCase();
  const filtered = (tracks ?? []).filter(
    (t) => q === "" || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
  );

  return (
    <>
      <section className="input-card">
        <label>导入你的音乐</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
          <button className={format === "csv" ? "tab active" : "tab"} onClick={() => setFormat("csv")}>
            CSV
          </button>
          <button className={format === "json" ? "tab active" : "tab"} onClick={() => setFormat("json")}>
            JSON
          </button>
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
        </div>
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
      </section>

      <div className="lib-toolbar">
        <input
          type="text"
          placeholder="搜索歌名或歌手…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>
          {tracks === null ? "加载中" : `共 ${tracks.length} 首，显示 ${filtered.length} 首`}
        </span>
      </div>

      {tracks !== null && (
        <table className="lib-table">
          <thead>
            <tr>
              <th>歌曲</th>
              <th>歌手</th>
              <th>风格</th>
              <th>能量</th>
              <th>时长</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
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
