/**
 * 流派标签中英映射与规范化。
 *
 * 国内音频文件的流派常是中文（"流行"、"民谣"），而引擎的能量先验表
 * （GENRE_ENERGY_PRIOR）与展示层使用英文 key。导入与 LLM 预标注产出
 * 统一经 normalizeGenre 规范化，保证先验兜底能吃上。
 */

const ZH_TO_KEY: Array<[RegExp, string]> = [
  [/^(流行|通俗|国语流行|华语流行|欧美流行|c-?pop|mandopop|k-?pop|j-?pop)$/i, "pop"],
  [/^(民谣|校园民谣|城市民谣|folk|indie.?folk)$/i, "folk"],
  [/^(摇滚|独立摇滚| alternative.?rock|punk|朋克)$/i, "rock"],
  [/^(后摇|后摇滚|post.?rock)$/i, "post-rock"],
  [/^(嘻哈|说唱|hip.?hop|rap|说唱音乐)$/i, "hiphop"],
  [/^(电子|电音|electronic|edm|house|techno|trance)$/i, "electronic"],
  [/^(古典|古典音乐|classical)$/i, "classical"],
  [/^(钢琴|piano)$/i, "piano"],
  [/^(氛围|氛围音乐|ambient)$/i, "ambient"],
  [/^(爵士|jazz)$/i, "jazz"],
  [/^(r&b|rnb|节奏布鲁斯|蓝调|blues)$/i, "rnb"],
  [/^(金属|重金属|metal)$/i, "metal"],
  [/^(原声|影视原声|配乐|soundtrack|ost)$/i, "soundtrack"],
  [/^(民谣流行|原声吉他|原声音乐|acoustic|不插电)$/i, "acoustic"],
  [/^(lofi|lo-?fi|轻音乐)$/i, "lofi"],
  [/^(city.?pop|城市流行|昭和歌谣)$/i, "city-pop"],
  [/^(动漫|动画|acg|二次元|动漫音乐)$/i, "acg"],
  [/^(纯音乐|instrumental|无人声)$/i, "instrumental"],
];

/** 规范化单个流派标签：trim/小写/中文→英文 key；无法映射时返回小写原文 */
export function normalizeGenre(genre: string): string {
  const g = genre.trim().toLowerCase().replace(/\s+/g, " ");
  if (g === "") return "";
  for (const [pattern, key] of ZH_TO_KEY) {
    if (pattern.test(g)) return key;
  }
  return g;
}

/** 批量规范化：去空、去重、最多 max 个 */
export function normalizeGenres(genres: string[] | undefined, max = 4): string[] | undefined {
  if (genres === undefined) return undefined;
  const out: string[] = [];
  for (const g of genres) {
    const key = normalizeGenre(g);
    if (key !== "" && !out.includes(key)) out.push(key);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : undefined;
}
