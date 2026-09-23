import { describe, expect, it } from "vitest";
import { importCsv, parseCsv } from "../src/core/import/csv.js";

describe("parseCsv", () => {
  it("处理引号内逗号与换行", () => {
    const rows = parseCsv('a,"b,c"\n"d\ne",f');
    expect(rows).toEqual([["a", "b,c"], ["d\ne", "f"]]);
  });

  it("处理转义双引号与 CRLF", () => {
    const rows = parseCsv('x,"say ""hi"""\r\ny,z');
    expect(rows).toEqual([["x", 'say "hi"'], ["y", "z"]]);
  });

  it("去掉 BOM 和末尾空行", () => {
    const rows = parseCsv("\uFEFFa,b\r\n1,2\r\n");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("importCsv", () => {
  const CSV = [
    "歌名,歌手,专辑,时长,风格,能量,情绪,语言,纯音乐",
    "晴天,周杰伦,叶惠美,4:29,pop,0.5,温暖,中文,0",
    "Wrong Row",
    ",缺歌名,专辑,3:00",
    "Bad Duration,某人,专辑,abc",
  ].join("\n");

  it("中英表头映射 + mm:ss 时长 + 逐行错误报告", () => {
    const result = importCsv(CSV);
    expect(result.accepted.length).toBe(1);
    const t = result.accepted[0];
    expect(t?.title).toBe("晴天");
    expect(t?.artist).toBe("周杰伦");
    expect(t?.album).toBe("叶惠美");
    expect(t?.durationSec).toBe(269);
    expect(t?.genres).toEqual(["pop"]);
    expect(t?.energy).toBe(0.5);
    expect(t?.isInstrumental).toBe(false);
    expect(result.rejected.length).toBe(3);
  });

  it("纯音乐标记与多风格分隔", () => {
    const result = importCsv("title,artist,duration,genres,isInstrumental\nAmbient 1,Someone,3:30,\"ambient, classical\",1");
    expect(result.accepted[0]?.isInstrumental).toBe(true);
    expect(result.accepted[0]?.genres).toEqual(["ambient", "classical"]);
  });

  it("缺必要表头时明确报错", () => {
    const result = importCsv("foo,bar\n1,2");
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("表头");
  });

  it("去重：existingIds 中已存在的 id 被拒", () => {
    const first = importCsv("title,artist,duration\nSong A,Artist,3:00");
    const id = first.accepted[0]?.id;
    const again = importCsv("title,artist,duration\nSong A,Artist,3:00", {
      existingIds: new Set(id ? [id] : []),
    });
    expect(again.accepted.length).toBe(0);
    expect(again.rejected[0]?.reason).toContain("重复");
  });
});
