import { describe, expect, it } from "vitest";
import { parseContext, parseDurationMinutes } from "../src/core/parser/rulesParser.js";

describe("规则解析器 parseContext", () => {
  it("解析 PRODUCT.md 的完整示例", () => {
    const { context } = parseContext("今晚准备写代码两个小时，有点累，而且容易走神。想听安静一点、歌词少一点的音乐。");
    expect(context.task).toBe("写代码");
    expect(context.durationMinutes).toBe(120);
    expect(context.energy).toBe("medium"); // "有点累" 属于中度
    expect(context.focusDifficulty).toBe("high");
    expect(context.musicPrefs?.calmness).toBe("calm");
    expect(context.musicPrefs?.vocalPreference).toBe("few-lyrics");
    expect(context.parserMeta.matched.length).toBeGreaterThan(3);
    expect(context.parserMeta.unknowns).not.toContain("学习任务");
    expect(context.parserMeta.confidence).toBeGreaterThan(0.5);
  });

  it("识别压力大、焦虑的情绪", () => {
    const { context } = parseContext("明天要考试，压力很大很焦虑，复习一小时");
    expect(context.task).toBe("复习备考");
    expect(context.stress).toBe("high");
    expect(context.moods).toContain("anxious");
    expect(context.durationMinutes).toBe(60);
  });

  it("识别纯音乐偏好", () => {
    const { context } = parseContext("看书的时候想听纯音乐，不要人声");
    expect(context.musicPrefs?.vocalPreference).toBe("instrumental");
    expect(context.task).toBe("阅读");
  });

  it("识别流派与语言偏好", () => {
    const { context } = parseContext("写论文，来点 lofi 和钢琴，最好日系的");
    expect(context.musicPrefs?.genres).toContain("lofi");
    expect(context.musicPrefs?.genres).toContain("piano");
    expect(context.musicPrefs?.languages).toContain("ja");
  });

  it("什么都没提时给出低置信度和完整 unknowns", () => {
    const { context } = parseContext("随便放点歌");
    expect(context.parserMeta.confidence).toBeLessThan(0.3);
    expect(context.parserMeta.unknowns).toContain("学习任务");
    expect(context.musicPrefs?.calmness).toBeUndefined();
  });

  it("精力充沛的场景", () => {
    const { context } = parseContext("今晚精力充沛，刷题三个小时，来点带感的");
    expect(context.energy).toBe("high");
    expect(context.durationMinutes).toBe(180);
    expect(context.musicPrefs?.calmness).toBe("energetic");
  });
});

describe("parseDurationMinutes", () => {
  it.each([
    ["两个小时", 120],
    ["2小时", 120],
    ["半小时", 30],
    ["一个半小时", 90],
    ["90分钟", 90],
    ["四十五分钟", 45],
    ["学一下午", 180],
  ])("%s → %i 分钟", (input, expected) => {
    expect(parseDurationMinutes(input)).toBe(expected);
  });

  it("没有时长信息时返回 undefined", () => {
    expect(parseDurationMinutes("有点累想听歌")).toBeUndefined();
  });
});
