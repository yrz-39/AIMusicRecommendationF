import { describe, expect, it } from "vitest";
import { songKey, validateImportRows } from "../src/core/import/validate.js";


describe("跨来源重复识别（songKey）", () => {
  it("与现有库同名同歌手的行被拒绝（无论 id 是否不同）", () => {
    const existing = new Set(["some-other-id"]);
    const existingKeys = new Set([songKey("晴天", "周杰伦")]);
    const result = validateImportRows(
      [{ id: "brand-new-id", title: "晴天", artist: "周杰伦", durationSec: 269 }],
      { existingIds: existing, existingSongKeys: existingKeys },
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("与曲库已有曲目重复");
  });

  it("行内同名同歌手（大小写/空格差异）也会去重", () => {
    const result = validateImportRows([
      { title: "晴天", artist: "周杰伦", durationSec: 269 },
      { title: "晴天 ", artist: "周 杰 伦", durationSec: 269 },
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain("重复");
  });

  it("同歌名不同歌手正常接受", () => {
    const existingKeys = new Set([songKey("晴天", "周杰伦")]);
    const result = validateImportRows(
      [{ title: "晴天", artist: "翻唱歌手", durationSec: 250 }],
      { existingSongKeys: existingKeys },
    );
    expect(result.accepted).toHaveLength(1);
  });
});
