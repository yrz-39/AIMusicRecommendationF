import { contextBridge, ipcRenderer } from "electron";

/**
 * 渲染层安全桥：只暴露两个能力，不泄露 Node 能力。
 * UI 通过 window.electronAPI 判断是否运行在桌面壳内并切换小窗模式。
 */
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  setMiniMode: (mini: boolean): Promise<boolean> => ipcRenderer.invoke("window:set-mini-mode", mini),
});
