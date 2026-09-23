# StudyMood DJ

StudyMood DJ 是一个本地优先的学习场景音乐推荐工具。

用户用自然语言描述自己当前的学习状态，系统理解当前情境，并从用户自己的音乐库中选择、排序和解释适合现在播放的音乐。

## 核心流程

```text
自然语言 → 学习情境 → 个人音乐库 → 推荐 → 推荐理由 → 用户反馈 → 个性化
```

## 项目原则

* Local First
* 推荐可解释
* 用户数据默认保存在本地
* AI 主要负责理解自然语言
* 核心推荐能力应可测试、可观察
* 外部服务失败不应让整个产品不可用
* 优先完成真实用户体验，而不是堆功能

## 项目文档

* `PRODUCT.md`：产品目标和边界
* `ROADMAP.md`：产品里程碑与当前进度
* `AGENTS.md`：自主 Agent 工程规则
* `DECISIONS.md`：重要技术和产品决策

## 技术栈

* **语言**：TypeScript（strict 模式）
* **核心**（`src/core`）：纯函数推荐引擎 —— 规则式中文情境解析、六维评分、反馈亲和度，零 I/O，完全可单测
* **存储**（`src/storage`）：本地 JSON 文件（原子写入，`data/` 目录，不入 Git）
* **服务**（`src/server`）：Hono API，只监听 `127.0.0.1`
* **前端**（`src/web`）：React + Vite，深色主题单页
* **测试**：Vitest（解析器 / 引擎 / 存储 / API 集成）

## 开发与运行

要求：Node.js ≥ 20。

```bash
npm install        # 安装依赖

npm run dev        # 开发模式（API :8787 热重载 + Vite :5173 代理）
npm start          # 生产模式（构建后单进程，托管 API + 前端）

npm test           # 运行全部测试
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建前端到 dist/web
```

生产模式启动：`npm run build && npm start`，然后打开 http://127.0.0.1:8787/。

## 首次运行

曲库为空时自动导入内置示例库（82 首真实可检索曲目）。在「音乐库」页可粘贴 JSON 导入自己的曲目，导入后与示例库合并；也可以直接编辑 `data/library.json`。

## 数据与隐私

所有用户数据（曲库 / 反馈 / 会话）保存在本地 `data/` 目录，已被 `.gitignore` 排除，不会进入版本库。当前版本不向任何外部服务发送数据。

## 当前状态

M0/M1/M2 已完成（详见 ROADMAP）：规则解析 → 推荐引擎 → 本地 API + Web UI 的完整流程已可用，含反馈闭环与 JSON 导入。
