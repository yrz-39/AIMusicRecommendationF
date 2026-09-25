interface HelpModalProps {
  version: string | null;
  dataDir: string | null;
  onClose: () => void;
}

/** 应用内帮助：使用说明 + 数据/隐私说明（M7 要求的「使用说明/隐私说明」落点） */
export function HelpModal({ version, dataDir, onClose }: HelpModalProps): React.ReactElement {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="帮助与隐私"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card help">
        <div className="help-header">
          <h2>帮助与隐私</h2>
          <button className="ghost-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <section className="help-section">
          <h3>🎧 怎么用</h3>
          <ol className="help-list">
            <li>「推荐」页描述现在的状态（任务、时长、累不累、想听什么感觉）→ 获得带理由的推荐；</li>
            <li>想要整段歌单就在同一段话里带上时长（如「复习 40 分钟」），点「🎵 生成歌单」；</li>
            <li>用 ❤️ / ✕ 反馈调整口味；「音乐库」页可导入自己的歌、用一句话教它每首歌的特点。</li>
          </ol>
        </section>

        <section className="help-section">
          <h3>🔒 你的数据与隐私</h3>
          <ul className="help-list">
            <li>曲库、反馈、推荐历史全部保存在本机，应用不联网获取或上传任何数据，无遥测；</li>
            <li>
              数据目录：
              {dataDir ? <code className="help-path">{dataDir}</code> : <em>（启动中…）</em>}
              <br />
              备份 = 复制该目录下的 JSON 文件；彻底删除 = 删除该目录（卸载应用不会自动删除数据）。
            </li>
            <li>如果某个数据文件损坏，应用会把它改名为 <code>*.corrupt-*</code> 保留原地并从空状态继续，不会静默覆盖。</li>
          </ul>
        </section>

        <section className="help-section">
          <h3>ℹ️ 关于</h3>
          <p>
            StudyMood DJ {version ? `v${version}` : ""} · 本地优先的学习音乐推荐 ·
            推荐结果由可解释的评分引擎生成，每首歌都附带真实计算出的理由。
          </p>
        </section>

        <div className="onboard-actions">
          <button className="primary-btn" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
