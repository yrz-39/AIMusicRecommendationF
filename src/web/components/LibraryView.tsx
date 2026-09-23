import { useCallback, useEffect, useState } from "react";
import type { Track } from "../../core/types.js";
import { energyLabel, formatDuration } from "../App.js";

export function LibraryView({ onChanged }: { onChanged: () => void }): React.ReactElement {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [filter, setFilter] = useState("");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

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
      const parsed: unknown = JSON.parse(importText);
      const res = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: parsed }),
      });
      const data = (await res.json()) as { imported: number; rejected: Array<{ row: number; reason: string }>; error?: string };
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      setImportMsg(
        `导入 ${data.imported} 首` +
          (data.rejected.length > 0 ? `，失败 ${data.rejected.length} 行（首行: ${data.rejected[0]?.reason}）` : ""),
      );
      setImportText("");
      await load();
      onChanged();
    } catch (err) {
      setImportMsg(`导入失败：${(err as Error).message}`);
    }
  }, [importText, load, onChanged]);

  const q = filter.trim().toLowerCase();
  const filtered = (tracks ?? []).filter(
    (t) => q === "" || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
  );

  return (
    <>
      <section className="input-card">
        <label>导入音乐（JSON 数组，字段：title / artist / durationSec 或 "mm:ss" / genres / energy / moodTags / language / isInstrumental）</label>
        <textarea
          id="status-input"
          style={{ minHeight: 70 }}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'[{"title":"晴天","artist":"周杰伦","durationSec":269,"genres":["pop"],"energy":0.5,"vocalDensity":"high"}]'}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button className="primary-btn" style={{ marginTop: 0, width: "auto", padding: "9px 22px" }} disabled={importText.trim() === ""} onClick={() => void doImport()}>
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
        当前为内置示例库（{tracks?.length ?? 0} 首）。以后接入你自己的音乐库（本地文件 / CSV / 网易云）后，这里会显示你的全部歌曲；
        所有数据只保存在本机 data/ 目录，不会上传。
      </p>
    </>
  );
}
