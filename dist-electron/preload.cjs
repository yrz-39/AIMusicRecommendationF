"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  setMiniMode: (mini) => import_electron.ipcRenderer.invoke("window:set-mini-mode", mini)
});
