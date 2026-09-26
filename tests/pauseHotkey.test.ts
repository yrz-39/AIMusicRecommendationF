import { describe, expect, it } from "vitest";
import { toSendKeys } from "../src/core/netease/pauseHotkey.js";

describe("客户端暂停快捷键映射", () => {
  it("Ctrl+P → ^p；组合修饰键与 F 键", () => {
    expect(toSendKeys("Ctrl+P")).toBe("^p");
    expect(toSendKeys("Ctrl+Alt+Q")).toBe("^%q");
    expect(toSendKeys("Ctrl+Shift+F5")).toBe("^+{F5}");
    expect(toSendKeys("Alt+3")).toBe("%3");
  });

  it("裸键/不认识的修饰键拒绝（宁可不暂停不乱按）", () => {
    expect(toSendKeys("P")).toBeNull();
    expect(toSendKeys("Ctrl+PrintScreen")).toBeNull();
    expect(toSendKeys("")).toBeNull();
  });
});
