import { contextBridge, ipcRenderer } from "electron";
import type { MagApi } from "../shared/api";

const api: MagApi = {
  init: () => ipcRenderer.invoke("mag-init"),
  capture: (box, auto) => ipcRenderer.invoke("mag-capture", box, auto),
  ignoreMouse: (ignore) => ipcRenderer.send("mag-ignore-mouse", ignore),
  resize: (w, h) => ipcRenderer.send("mag-resize", w, h),
  set: (patch) => ipcRenderer.send("mag-set", patch),
  close: () => ipcRenderer.send("mag-close"),
  openPrefs: () => ipcRenderer.send("mag-open-prefs"),
  copy: (text) => ipcRenderer.invoke("copy", text),
  onResult: (cb) => {
    ipcRenderer.on("mag-result", (_e, r) => cb(r));
  },
  onTrigger: (cb) => {
    ipcRenderer.on("mag-trigger", () => cb());
  },
};

contextBridge.exposeInMainWorld("magApi", api);
