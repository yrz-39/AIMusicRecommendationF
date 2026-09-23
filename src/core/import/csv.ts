import { validateImportRows, type ImportOptions, type ImportResult } from "./validate.js";

/**
 * CSV 导入：把用户自己的 CSV 曲库文件转换为可导入行。
 *
 * - 支持带引号字段（含逗号/换行/转义双引号）、BOM、CRLF；
 * - 表头中英文别名均可识别（歌名/title、歌手/artist、时长/duration…）；
 * - 行级校验复用 validateImportRows，错误逐行报告。
 */

const HEADER_ALIASES: Record<string, string[]> = {
  title: ["title", "name", "song", "track", "歌名", "歌曲", "标题", "曲名"],
  artist: ["artist", "singer", "artists", "歌手", "艺术家", "演唱者", "作者"],
  album: ["album", "专辑", "唱片"],
  durationSec: ["durationsec", "duration", "length", "时长", "长度", "时间"],
  language: ["language", "lang", "语言"],
  isInstrumental: ["isinstrumental", "instrumental", "纯音乐", "无人声"],
  genres: ["genres", "genre", "tags", "tag", "风格", "流派", "标签"],
  energy: ["energy", "能量"],
  moodTags: ["moodtags", "moods", "mood", "情绪", "情绪标签"],
  vocalDensity: ["vocaldensity", "vocals", "人声密度", "人声"],
};

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    // 整行为空则跳过
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

function normalizeHeader(text: string): string | undefined {
  const key = text.trim().toLowerCase().replace(/\s+/g, "");
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === key)) return field;
  }
  return undefined;
}

/** CSV 文本 → 校验并映射为 Track（复用 JSON 导入的行校验与错误报告） */
export function importCsv(text: string, options: ImportOptions = {}): ImportResult {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { accepted: [], rejected: [{ row: -1, reason: "CSV 内容为空" }] };
  }
  const header = table[0] ?? [];
  const columns = header.map(normalizeHeader);
  if (!columns.includes("title") || !columns.includes("artist")) {
    return {
      accepted: [],
      rejected: [{ row: 0, reason: "表头需包含「歌名/title」和「歌手/artist」列" }],
    };
  }

  const rows = table.slice(1).map((cells) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      if (col === undefined) return;
      const value = cells[i] ?? "";
      if (["genres", "moodTags"].includes(col)) {
        obj[col] = value; // strArray 支持逗号/分号分隔字符串
      } else if (col === "isInstrumental") {
        obj[col] = /^(1|true|yes|y|是|纯音乐)$/i.test(value.trim());
      } else {
        obj[col] = value === "" ? undefined : value;
      }
    });
    return obj;
  });
  return validateImportRows(rows, options);
}
