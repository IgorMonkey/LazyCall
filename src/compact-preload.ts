import { contextBridge, ipcRenderer } from "electron";
import type { CompactApi } from "./shared";

const api: CompactApi = {
  snapshot: () => ipcRenderer.invoke("compact:snapshot"),
  onSnapshot: fn => {
    const listener = (_: unknown, value: Parameters<typeof fn>[0]) => fn(value);
    ipcRenderer.on("compact:snapshot", listener);
    return () => ipcRenderer.removeListener("compact:snapshot", listener);
  },
  ask: () => ipcRenderer.invoke("compact:ask"),
  cancel: () => ipcRenderer.invoke("compact:cancel"),
  showMain: () => ipcRenderer.invoke("compact:main"),
  hide: () => ipcRenderer.invoke("compact:hide"),
  copyAnswer: () => ipcRenderer.invoke("compact:copy"),
  openLink: url => ipcRenderer.invoke("compact:link", url)
};
contextBridge.exposeInMainWorld("callmeCompact", api);
