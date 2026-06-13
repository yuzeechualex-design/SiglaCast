const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("purxuDesktop", {
  isDesktop: true,
  windowControl(action) {
    return ipcRenderer.invoke("purxu-window-control", action);
  },
  isMaximized() {
    return ipcRenderer.invoke("purxu-window-is-maximized");
  }
});
