import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/api";

const on = (channel: string) => (cb: (arg: never) => void) => {
  ipcRenderer.on(channel, (_e, arg) => cb(arg as never));
};

const api: Api = {
  init: () => ipcRenderer.invoke("init"),
  setConfig: (patch) => ipcRenderer.invoke("set-config", patch),
  start: () => ipcRenderer.invoke("start"),
  stop: () => ipcRenderer.invoke("stop"),
  status: () => ipcRenderer.invoke("status"),
  findAllClients: () => ipcRenderer.invoke("find-all-clients"),
  pickFolder: (title) => ipcRenderer.invoke("pick-folder", title),
  pickSoundFile: (filterName) => ipcRenderer.invoke("pick-sound-file", filterName),
  fileUrl: (p) => ipcRenderer.invoke("file-url", p),
  translateReply: (text, src, dst) => ipcRenderer.invoke("translate-reply", text, src, dst),
  preview: (text, lang) => ipcRenderer.invoke("preview", text, lang),
  glossaryGet: () => ipcRenderer.invoke("glossary-get"),
  glossarySave: (items) => ipcRenderer.invoke("glossary-save", items),
  openGlossaryFile: () => ipcRenderer.invoke("open-glossary-file"),
  openDataDir: () => ipcRenderer.invoke("open-data-dir"),
  copy: (text) => ipcRenderer.invoke("copy", text),
  notify: (title, body, jump) => ipcRenderer.invoke("notify", title, body, jump),
  showLastAlert: (rec, head) => ipcRenderer.invoke("show-last-alert", rec, head),
  log: (msg) => ipcRenderer.invoke("log", msg),
  retranslateUi: () => ipcRenderer.invoke("retranslate-ui"),
  toggleMagnifier: () => ipcRenderer.invoke("magnifier-toggle"),
  quit: () => ipcRenderer.invoke("quit-app"),
  setHotkeys: (keys) => ipcRenderer.invoke("set-hotkeys", keys),
  ready: () => ipcRenderer.invoke("renderer-ready"),
  toggleOverlay: (on) => ipcRenderer.invoke("overlay-toggle", on),
  overlaySet: (patch) => ipcRenderer.invoke("overlay-set", patch),
  overlayIgnoreMouse: (ignore) => ipcRenderer.send("overlay-ignore-mouse", ignore),
  overlayResize: (w, h) => ipcRenderer.send("overlay-resize", w, h),
  onUiStrings: on("ui-strings"),
  onMessage: on("message"),
  onEngineEvent: on("engine-event"),
  onJump: on("jump"),
  onLanguages: on("languages"),
  onAppMenu: on("app-menu"),
};

contextBridge.exposeInMainWorld("api", api);
// automated tests only (the handler exists only when WCT_TEST_HOOKS=1)
contextBridge.exposeInMainWorld("testHooks", { closeWindow: () => ipcRenderer.invoke("test-close-window") });
