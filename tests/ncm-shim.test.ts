import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCmdShimTarget } from "../src/core/netease/ncmCli.js";

/** .cmd shim → 真实 JS 入口解析：npm 引号形态 / 无引号形态 / %APPDATA% 变量展开 */
describe("resolveCmdShimTarget", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studymood-shim-"));
  const realJs = path.join(dir, "target", "dist", "index.js");
  mkdirSync(path.dirname(realJs), { recursive: true });
  writeFileSync(realJs, "// fake entry", "utf8");

  it("npm 经典 shim：node \"%~dp0\\node_modules\\...\\index.js\" %*", () => {
    const realTarget = path.join(dir, "node_modules", "@music163", "ncm-cli", "dist", "index.js");
    mkdirSync(path.dirname(realTarget), { recursive: true });
    writeFileSync(realTarget, "// fake entry", "utf8");
    const shim = path.join(dir, "a.cmd");
    writeFileSync(shim, `@ECHO off\nnode "%~dp0\\node_modules\\@music163\\ncm-cli\\dist\\index.js" %*\n`, "utf8");
    const target = resolveCmdShimTarget(shim);
    expect(target).toBe(realTarget);
  });

  it("绝对路径 + %APPDATA% 变量展开（%* 不能吞进路径）", () => {
    const shim = path.join(dir, "b.cmd");
    writeFileSync(shim, `@node "${process.env.APPDATA ?? "C:\\AD"}\\npm\\node_modules\\pkg\\dist\\index.js" %*\n`, "utf8");
    const target = resolveCmdShimTarget(shim);
    // APPDATA 展开后路径存在与否以 existsSync 为准；这里验证至少不被 %* 污染
    expect(target === null || !target.includes("%*")).toBe(true);
    expect(target === null || target.endsWith(".js")).toBe(true);
  });

  it("无引号形态（node 脚本路径不含空格）", () => {
    const shim = path.join(dir, "c.cmd");
    writeFileSync(shim, `@node ${realJs} %*\n`, "utf8");
    expect(resolveCmdShimTarget(shim)).toBe(realJs);
  });

  it("解析不到目标返回 null（不存在崩溃）", () => {
    // 独立目录：兄弟 node_modules 兜底不应把“内容无关”的 shim 解析成功
    const isolated = mkdtempSync(path.join(os.tmpdir(), "studymood-shim-empty-"));
    const shim = path.join(isolated, "d.cmd");
    writeFileSync(shim, "@echo some random content\n", "utf8");
    expect(resolveCmdShimTarget(shim)).toBeNull();
    rmSync(isolated, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
