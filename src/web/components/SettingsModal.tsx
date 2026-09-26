import { useCallback, useEffect, useState } from "react";

/**
 * M6 设置页（应用内弹窗）：配置 LLM key 与网易云登录 Cookie。
 *
 * 此前两凭据只能手动编辑本机 .env；现在保存后立即生效（服务热更新），
 * 并落回本机 .env 以便重启保留。凭据在界面上永远只显示掩码。
 */

interface SettingsSnapshot {
  llm: { configured: boolean; baseUrl: string; model: string; apiKeyMasked: string | null };
  netease: { configured: boolean; cookieMasked: string | null };
  settingsPath: string | null;
}

interface Msg {
  ok: boolean;
  text: string;
}

interface SettingsModalProps {
  onClose: () => void;
  /** 保存成功后通知父级刷新（如帮助页/预标注按钮依赖的 llm 状态） */
  onSaved?: () => void;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `请求失败（${res.status}）`;
  } catch {
    return `请求失败（${res.status}）`;
  }
}

export function SettingsModal({ onClose, onSaved }: SettingsModalProps): React.ReactElement {
  const [info, setInfo] = useState<SettingsSnapshot | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [llmMsg, setLlmMsg] = useState<Msg | null>(null);
  const [netMsg, setNetMsg] = useState<Msg | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) setInfo((await res.json()) as SettingsSnapshot);
    } catch {
      /* 拉不到时显示占位文案 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveLlm = useCallback(async (): Promise<void> => {
    const llm: Record<string, string> = {};
    if (apiKey.trim() !== "") llm.apiKey = apiKey.trim();
    if (baseUrl.trim() !== "") llm.baseUrl = baseUrl.trim();
    if (model.trim() !== "") llm.model = model.trim();
    if (Object.keys(llm).length === 0) {
      setLlmMsg({ ok: false, text: "没有修改。留空表示保持现状。" });
      return;
    }
    setBusy("llm-save");
    setLlmMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setInfo((await res.json()) as SettingsSnapshot);
      setApiKey("");
      setBaseUrl("");
      setModel("");
      setLlmMsg({ ok: true, text: "已保存，立即生效" });
      onSaved?.();
    } catch (err) {
      setLlmMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }, [apiKey, baseUrl, model, onSaved]);

  const testLlm = useCallback(async (): Promise<void> => {
    setBusy("llm-test");
    setLlmMsg(null);
    try {
      const llm: Record<string, string> = {};
      if (apiKey.trim() !== "") llm.apiKey = apiKey.trim();
      if (baseUrl.trim() !== "") llm.baseUrl = baseUrl.trim();
      if (model.trim() !== "") llm.model = model.trim();
      const res = await fetch("/api/settings/test-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.keys(llm).length > 0 ? { llm } : {}),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? "连接失败");
      setLlmMsg({ ok: true, text: `连接成功（${model.trim() || info?.llm.model || "deepseek-chat"}）` });
    } catch (err) {
      setLlmMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }, [apiKey, baseUrl, model, info?.llm.model]);

  const saveCookie = useCallback(async (): Promise<void> => {
    const value = cookie.trim();
    if (value === "") {
      setNetMsg({ ok: false, text: "先粘贴 MUSIC_U 的值" });
      return;
    }
    setBusy("net-save");
    setNetMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ neteaseCookie: value }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setInfo((await res.json()) as SettingsSnapshot);
      setCookie("");
      setNetMsg({ ok: true, text: "已保存，立即生效" });
      onSaved?.();
    } catch (err) {
      setNetMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }, [cookie, onSaved]);

  const testCookie = useCallback(async (): Promise<void> => {
    setBusy("net-test");
    setNetMsg(null);
    try {
      const body = cookie.trim() !== "" ? { cookie: cookie.trim() } : {};
      const res = await fetch("/api/settings/test-netease", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; nickname?: string; error?: string };
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? "验证失败");
      setNetMsg({ ok: true, text: `Cookie 有效，登录账号：${data.nickname ?? "未知"}` });
    } catch (err) {
      setNetMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }, [cookie]);

  const clearCookie = useCallback(async (): Promise<void> => {
    if (!window.confirm("确定清除已保存的网易云 Cookie 吗？（公开歌单仍可导入）")) return;
    setBusy("clear");
    setNetMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ neteaseCookie: "" }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setInfo((await res.json()) as SettingsSnapshot);
      setCookie("");
      setNetMsg({ ok: true, text: "已清除" });
      onSaved?.();
    } catch (err) {
      setNetMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }, [onSaved]);

  const llmStatus = info === null ? "…" : info.llm.configured ? `已启用 · ${info.llm.model}` : "未配置 · 状态理解走本地规则版";

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card help">
        <div className="help-header">
          <h2>设置</h2>
          <button className="ghost-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <section className="help-section">
          <h3>
            🤖 LLM 智能理解{" "}
            <span className={info?.llm.configured ? "settings-badge on" : "settings-badge"}>{llmStatus}</span>
          </h3>
          <p className="settings-hint">
            配置后，状态描述和歌曲反馈交给大模型理解（更准），失败自动回退规则版。默认 DeepSeek，
            兼容任何 OpenAI 格式接口。
          </p>
          <div className="settings-grid">
            <label>
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={info?.llm.apiKeyMasked ?? "sk-…"}
                autoComplete="off"
              />
            </label>
            <label>
              接口地址（可选）
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={info?.llm.baseUrl ?? "https://api.deepseek.com"}
                autoComplete="off"
              />
            </label>
            <label>
              模型名（可选）
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={info?.llm.model ?? "deepseek-chat"}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="settings-actions">
            <button className="primary-btn" disabled={busy !== null} onClick={() => void saveLlm()}>
              {busy === "llm-save" ? "保存中…" : "保存"}
            </button>
            <button className="ghost-btn" disabled={busy !== null} onClick={() => void testLlm()}>
              {busy === "llm-test" ? "测试中…" : "测试连接"}
            </button>
          </div>
          {llmMsg !== null && <p className={llmMsg.ok ? "settings-msg ok" : "settings-msg bad"}>{llmMsg.text}</p>}
        </section>

        <section className="help-section">
          <h3>
            ☁️ 网易云登录 Cookie{" "}
            <span className={info?.netease.configured ? "settings-badge on" : "settings-badge"}>
              {info === null ? "…" : info.netease.configured ? `已配置 · ${info.netease.cookieMasked}` : "未配置"}
            </span>
          </h3>
          <p className="settings-hint">
            公开歌单不配也能导入。配置 MUSIC_U 后：私密歌单、只对自己可见的歌单也能整单导入。
            获取方式：电脑浏览器登录 music.163.com → F12 → 应用/Application → Cookie → 复制 MUSIC_U 的值。
          </p>
          <div className="settings-grid">
            <label>
              MUSIC_U
              <input
                type="password"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder={info?.netease.cookieMasked ?? "粘贴 Cookie 值"}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="settings-actions">
            <button className="primary-btn" disabled={busy !== null} onClick={() => void saveCookie()}>
              {busy === "net-save" ? "保存中…" : "保存"}
            </button>
            <button className="ghost-btn" disabled={busy !== null} onClick={() => void testCookie()}>
              {busy === "net-test" ? "验证中…" : "测试 Cookie"}
            </button>
            {info?.netease.configured === true && (
              <button className="ghost-btn" disabled={busy !== null} onClick={() => void clearCookie()}>
                清除
              </button>
            )}
          </div>
          {netMsg !== null && <p className={netMsg.ok ? "settings-msg ok" : "settings-msg bad"}>{netMsg.text}</p>}
        </section>

        <section className="help-section">
          <div className="privacy-note">
            凭据只保存在本机
            {info?.settingsPath ? <code className="help-path">{info.settingsPath}</code> : null}
            ，不会上传；界面上只显示掩码。
          </div>
        </section>

        <div className="onboard-actions">
          <button className="primary-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
