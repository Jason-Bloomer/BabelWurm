import { contextBridge, ipcRenderer } from "electron";
import type { AlertWindowApi } from "../shared/api";

const api: AlertWindowApi = {
  onData: (cb) => {
    ipcRenderer.on("alert-data", (_e, d) => cb(d));
  },
  jump: () => ipcRenderer.send("alert-jump"),
  close: () => ipcRenderer.send("alert-close"),
};

contextBridge.exposeInMainWorld("alertApi", api);
