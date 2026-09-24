/** Electron 桌面壳注入的全局 API（见 electron/preload.ts） */
export interface ElectronAPI {
  isElectron: true;
  setMiniMode: (mini: boolean) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}
