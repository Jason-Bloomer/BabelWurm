/**
 * BabelWurm — Electron main process.
 *
 * Owns settings, log watching and translation (Engine), the tray icon, the
 * single-instance socket, notifications, the "last alert" popup and the
 * update check. The UI (renderer) owns chat history and rendering.
 */
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, screen, shell, Tray } from "electron";
import type { Server } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILTIN_SOUNDS } from "../core/alerts";
import { CONFIG_FILE_NAME, ConfigStore, LEGACY_CONFIG_FILE_NAME, type Config } from "../core/config";
import { characterFromLogsPath, findAllLogsDirs, STEAM_LANG_MAP, steamLanguage } from "../core/discovery";
import { Engine } from "../core/engine";
import { Glossary } from "../core/glossary";
import { englishStrings, getMachineStrings, I18N, isHandTranslated, makeT, resolveUiLang, setMachineStrings, type TFunc } from "../core/i18n";
import { hashStrings, translateUiStrings } from "../core/uiTranslate";
import { allLanguages, canonicalLang, isKnownLanguage, parseGoogleLanguageList, setLanguages, type Language } from "../core/languages";
import { Lexicon, Pipeline } from "../core/pipeline";
import { GTX_LANG_LIST_URL, Translator, type HttpGet } from "../core/translate";
import type { AlertRecord, InitState, Jump, StartResult } from "../shared/api";
import { listen, sendToRunning, waitUntilGone } from "./instance";
import { Magnifier } from "./magnifier";
import { mockHttpGet } from "./mockNet";
import { OcrService } from "./ocr";
import { showNotification } from "./notify";

const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf-8")) as {
  version: string;
  updateRepo?: string;
};
const APP_VERSION = pkg.version;
const APP_ID = "com.wurmmaps.babelwurm";

// ---------------------------------------------------------------------------
// Data folder: portable when a config sits next to the executable,
// otherwise the OS's per-user app data folder.
// ---------------------------------------------------------------------------
function resolveDataDir(): string {
  if (process.env.WCT_DATA_DIR) {
    fs.mkdirSync(process.env.WCT_DATA_DIR, { recursive: true });
    return process.env.WCT_DATA_DIR;
  }
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable) return portable;
  const exeDir = path.dirname(process.execPath);
  const hasConfig = (dir: string) => [CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME].some((f) => fs.existsSync(path.join(dir, f)));
  if (app.isPackaged && hasConfig(exeDir)) {
    try {
      fs.accessSync(exeDir, fs.constants.W_OK);
      return exeDir;
    } catch {
      /* not writable */
    }
  }
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const DATA_DIR = resolveDataDir();
const DEBUG_FILE = path.join(DATA_DIR, "babelwurm_debug.log");

function logDebug(msg: string) {
  try {
    try {
      if (fs.statSync(DEBUG_FILE).size > 2 * 1024 * 1024) fs.renameSync(DEBUG_FILE, DEBUG_FILE + ".old");
    } catch {
      /* no file yet */
    }
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    fs.appendFileSync(DEBUG_FILE, `${ts} ${msg}\n`, "utf-8");
  } catch {
    /* ignore */
  }
}

process.on("uncaughtException", (e) => logDebug(`UNHANDLED EXCEPTION: ${e.stack || e}`));
process.on("unhandledRejection", (e) => logDebug(`UNHANDLED REJECTION: ${e instanceof Error ? e.stack : e}`));

/** babelwurm_glossary.json; an older wurm_glossary.json in the same folder is taken over once. */
function glossaryFile(): string {
  const file = path.join(DATA_DIR, "babelwurm_glossary.json");
  const legacy = path.join(DATA_DIR, "wurm_glossary.json");
  if (!fs.existsSync(file) && fs.existsSync(legacy)) {
    try {
      fs.copyFileSync(legacy, file);
      logDebug("glossary: imported wurm_glossary.json");
    } catch {
      /* start from the defaults */
    }
  }
  return file;
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
}

// ---------------------------------------------------------------------------
// Networking through Chromium's stack (net.fetch): Google sees an ordinary
// Chrome client, so it isn't turned away the way plain HTTP libraries
// sometimes are.
// ---------------------------------------------------------------------------
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const httpGet: HttpGet = async (url, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { "User-Agent": CHROME_UA }, bypassCustomProtocolHandlers: true });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

/** Global shortcuts (work while the game has focus). Returns the ones that couldn't be registered. */
function registerHotkeys(): Record<string, boolean> {
  return (
    magnifier?.registerHotkeys([[cfg().overlay?.hotkey || "", () => void setOverlay(!isOverlay())]]) || {}
  );
}

/** Download a binary file (OCR language data) through Chromium's network stack. */
async function downloadFile(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { "User-Agent": CHROME_UA } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let store: ConfigStore;
let translator: Translator;
let glossary: Glossary;
let pipeline: Pipeline;
let engine: Engine;
let targetLang = "en";
let mainWindow: BrowserWindow | null = null;
let alertWindow: BrowserWindow | null = null;
let alertTimer: NodeJS.Timeout | null = null;
let lastAlert: AlertRecord | null = null;
let tray: Tray | null = null;
let quitting = false;
let magnifier: Magnifier | null = null;
let instanceServer: Server | null = null;
let trayHintShown = false;
let ocr: OcrService | null = null;

const cfg = (): Config => store.cfg;
const uiLang = () => resolveUiLang(cfg().ui_lang, targetLang);
const t: TFunc = (key, vars) => makeT(uiLang())(key, vars);

function osLanguage(): string {
  const loc = app.getLocale() || "en";
  if (/^zh[-_](TW|HK|MO|Hant)/i.test(loc)) return "zh-TW";
  const c = canonicalLang(loc);
  if (isKnownLanguage(c)) return c;
  const base = loc.split(/[-_]/)[0];
  return isKnownLanguage(base) ? canonicalLang(base) : "en";
}

/** Target language from the setting: explicit code, or "auto" → Steam client language → OS language. */
async function resolveTargetLang(setting: string): Promise<string> {
  if (setting && setting !== "auto") return canonicalLang(setting);
  const steam = await steamLanguage();
  const mapped = steam ? STEAM_LANG_MAP[steam] : undefined;
  return mapped || osLanguage();
}

function messageOptions() {
  return {
    translate: cfg().translate,
    targetLang,
    translateLangChannels: cfg().translate_lang_channels,
    translateCurrency: cfg().translate_currency,
    noTranslate: cfg().no_translate_channels || [],
  };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function iconPath(size: number): string {
  return path.join(resourcesDir(), "icons", `icon-${size}.png`);
}

/** Window/taskbar icon: the multi-size .ico on Windows (sharp at every display scale), a large PNG elsewhere. */
function appIcon(): string {
  return process.platform === "win32" ? path.join(resourcesDir(), "icons", "icon.ico") : iconPath(256);
}

const isOverlay = () => !!cfg().overlay?.enabled;

/** A saved overlay position that is still on a connected screen, else a default spot (bottom-left of the primary screen). */
function overlayBounds(): Electron.Rectangle {
  const saved = cfg().overlay?.bounds;
  if (saved && saved.width >= 200 && saved.height >= 100) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width - 40 && saved.x + saved.width > a.x + 40 && saved.y < a.y + a.height - 30 && saved.y + 20 > a.y;
    });
    if (visible) return saved;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(560, area.width - 40);
  const height = 280;
  return { x: area.x + 20, y: area.y + area.height - height - 60, width, height };
}

/**
 * The main window — normal (framed) or overlay (frameless, see-through,
 * always on top of the game). Electron can't change a window's frame after
 * creation, so switching mode replaces the window (see setOverlay).
 */
function createMainWindow() {
  const overlay = isOverlay();
  const b = cfg().window;
  const common: Electron.BrowserWindowConstructorOptions = {
    title: `${t("app_title")} v${APP_VERSION}`,
    icon: appIcon(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  };
  const w = overlay
    ? new BrowserWindow({
        ...common,
        ...overlayBounds(),
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: true,
        minWidth: 240,
        minHeight: 110,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        // Clicking the overlay must not take keyboard focus away from the game (Windows/macOS)
        focusable: !(cfg().overlay.no_focus && process.platform !== "linux"),
      })
    : new BrowserWindow({
        ...common,
        width: b?.width || 800,
        height: b?.height || 600,
        x: b?.x,
        y: b?.y,
        minWidth: 560,
        minHeight: 380,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1f22" : "#f6f7f9",
        alwaysOnTop: !!cfg().on_top,
      });
  mainWindow = w;
  if (overlay) {
    w.setAlwaysOnTop(true, "screen-saver");
    if (process.platform === "darwin") w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  if (process.platform !== "darwin") w.setMenu(null);
  if (!overlay && b?.maximized) w.maximize();
  w.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  w.once("ready-to-show", () => {
    if (process.argv.includes("--hidden")) return;
    if (overlay) w.showInactive(); // appear over the game without stealing its focus
    else w.show();
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    // links (About page, etc.) open in the user's browser / mail program
    if (/^(https?:|mailto:)/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  // keep our title ("BabelWurm v2.0.0"); the page's <title> must not replace it
  w.on("page-title-updated", (e) => e.preventDefault());
  w.webContents.on("render-process-gone", (_e, d) => logDebug(`renderer gone: ${d.reason}`));

  let saveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (w.isDestroyed() || w.isMinimized() || replaced.has(w)) return;
      if (overlay) {
        store.update({ overlay: { ...cfg().overlay, bounds: w.getBounds() } });
        return;
      }
      const maximized = w.isMaximized();
      const nb = maximized ? cfg().window || w.getNormalBounds() : w.getBounds();
      store.update({ window: { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized } });
    }, 500);
  };
  w.on("resize", saveBounds);
  w.on("move", saveBounds);

  w.on("close", (e) => {
    if (quitting || replaced.has(w)) return;
    // Every close is handled here: quit for real, hide to the tray, or ask.
    e.preventDefault();
    const canTray = !!tray || process.platform === "darwin";
    const action = canTray ? cfg().close_action : "quit";
    if (action === "quit") quitApp();
    else if (action === "tray") hideToTray();
    else void askCloseAction();
  });
  // Windows log-off/shutdown: exit cleanly instead of being killed mid-write
  w.on("session-end", () => quitApp());
  w.on("closed", () => {
    if (mainWindow === w) mainWindow = null;
    if (replaced.has(w)) return; // swapped for the other mode — not a quit
    if (!quitting) quitApp();
  });
}

/** Windows being replaced by a mode switch (their close/closed events are not a quit). */
const replaced = new WeakSet<BrowserWindow>();
let swapping = false;
/** UI state handed from the old window to the new one on a mode switch. */
let pendingSnapshot: unknown = null;

/** Switch between the normal window and the overlay, keeping chat history, unread marks and the alert log. */
async function setOverlay(on: boolean) {
  if (swapping || (isOverlay() === on && mainWindow)) return;
  swapping = true;
  try {
    const old = mainWindow;
    rendererReady = false; // from now on messages wait in the outbox for the new window
    let snap: unknown = null;
    if (old && !old.isDestroyed()) {
      try {
        snap = await Promise.race([
          old.webContents.executeJavaScript("window.__babelwurmSnapshot ? window.__babelwurmSnapshot() : null", true),
          new Promise((r) => setTimeout(() => r(null), 2000)),
        ]);
      } catch (e) {
        logDebug(`overlay: snapshot failed: ${e}`);
      }
    }
    pendingSnapshot = snap;
    store.update({ overlay: { ...cfg().overlay, enabled: on } });
    logDebug(`overlay: ${on ? "on" : "off"} (history ${snap ? "kept" : "not available"})`);
    createMainWindow(); // the new window exists before the old one goes: the app never has zero windows
    if (old && !old.isDestroyed()) {
      replaced.add(old);
      old.destroy();
    }
    refreshTrayMenu();
  } finally {
    swapping = false;
  }
}

// Messages for the UI wait here while its window is being (re)created.
let rendererReady = false;
const outbox: Array<[string, unknown]> = [];
function toRenderer(channel: string, payload?: unknown) {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
    return;
  }
  outbox.push([channel, payload]);
  if (outbox.length > 5000) outbox.shift();
}

/** First close: keep running in the tray, or quit? (optionally remembered) */
let asking = false;
async function askCloseAction() {
  if (asking || !mainWindow) return;
  asking = true;
  logDebug("close: asking keep-in-tray or quit");
  try {
    const r = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: t("app_title"),
      message: t("close_ask_msg"),
      detail: t("close_ask_detail"),
      buttons: [t("close_ask_tray"), t("close_ask_quit"), t("btn_cancel")],
      defaultId: 1,
      cancelId: 2,
      checkboxLabel: t("close_ask_remember"),
      checkboxChecked: false,
      noLink: true,
    });
    if (r.response === 2) return;
    const action = r.response === 0 ? "tray" : "quit";
    if (r.checkboxChecked) store.update({ close_action: action });
    if (action === "tray") hideToTray();
    else quitApp();
  } finally {
    asking = false;
  }
}

/** Hide to the tray — and say so once per session, so nobody thinks the app has quit. */
function hideToTray() {
  logDebug("close: hidden to the tray");
  mainWindow?.hide();
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  if (process.platform === "win32") {
    tray.displayBalloon({ title: t("app_title"), content: t("tray_balloon"), iconType: "info" });
  } else if (process.platform === "linux") {
    showNotification(t("app_title"), t("tray_balloon"), () => showWindow(), logDebug);
  }
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (isOverlay()) {
    mainWindow.showInactive(); // the overlay never grabs focus from the game
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

function jumpTo(j: Jump) {
  showWindow();
  toRenderer("jump", j);
}

// ---------------------------------------------------------------------------
// "Last alert" popup: small always-on-top window in the bottom-right corner
// (time, client, channel, text). Closes after 15 s; a new alert refreshes it.
// Shown without taking focus away from the game.
// ---------------------------------------------------------------------------
function closeAlertWindow() {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = null;
  if (alertWindow && !alertWindow.isDestroyed()) alertWindow.close();
  alertWindow = null;
}

function showLastAlert(rec: AlertRecord, head: string) {
  lastAlert = rec;
  const data = {
    head,
    text: rec.text,
    jumpLabel: t("lastalert_jump"),
    closeLabel: t("btn_close"),
    title: t("lastalert_title"),
    dark: cfg().theme === "dark" || (cfg().theme !== "light" && nativeTheme.shouldUseDarkColors),
  };
  const W = 380;
  const H = 150;
  if (!alertWindow || alertWindow.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    alertWindow = new BrowserWindow({
      width: W,
      height: H,
      x: area.x + area.width - W - 24,
      y: area.y + area.height - H - 24,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: process.platform !== "linux" ? false : true,
      show: false,
      title: data.title,
      backgroundColor: data.dark ? "#2b2d31" : "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "alertPreload.js"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    alertWindow.setAlwaysOnTop(true, "screen-saver");
    alertWindow.loadFile(path.join(__dirname, "..", "renderer", "alert.html"));
    const w = alertWindow;
    w.webContents.once("did-finish-load", () => {
      w.webContents.send("alert-data", data);
      w.showInactive();
    });
    w.on("closed", () => {
      if (alertWindow === w) alertWindow = null;
    });
  } else {
    alertWindow.webContents.send("alert-data", data);
    alertWindow.showInactive();
  }
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = setTimeout(closeAlertWindow, 15000);
}

ipcMain.on("alert-jump", () => {
  if (lastAlert) jumpTo({ clientIdx: lastAlert.client, channel: lastAlert.channel });
  closeAlertWindow();
});
ipcMain.on("alert-close", () => closeAlertWindow());

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTray() {
  try {
    let img: Electron.NativeImage;
    if (process.platform === "win32") {
      img = nativeImage.createFromPath(path.join(resourcesDir(), "icons", "icon.ico"));
    } else {
      img = nativeImage.createFromPath(iconPath(process.platform === "darwin" ? 16 : 32));
      img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(iconPath(process.platform === "darwin" ? 32 : 64)) });
    }
    tray = new Tray(img);
    tray.setToolTip(t("app_title"));
    refreshTrayMenu();
    tray.on("click", () => {
      if (process.platform === "darwin") return;
      if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else showWindow();
    });
  } catch (e) {
    logDebug(`tray unavailable: ${e}`);
    tray = null;
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setToolTip(t("app_title"));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t("tray_show"), click: () => showWindow() },
      { label: t("mag_btn"), click: () => magnifier?.toggle() },
      { label: t("overlay_menu"), type: "checkbox", checked: isOverlay(), click: () => void setOverlay(!isOverlay()) },
      { label: t("about_title"), click: () => showAbout() },
      { type: "separator" },
      { label: t("tray_quit"), click: () => quitApp() },
    ]),
  );
}

function buildAppMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs an Edit menu for ⌘C / ⌘V to work in text fields
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { label: t("about_title"), click: () => showAbout() },
          { type: "separator" },
          { label: t("btn_settings"), accelerator: "Cmd+,", click: () => mainWindow?.webContents.send("app-menu", "settings") },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { type: "separator" },
          { label: t("tray_quit"), accelerator: "Cmd+Q", click: () => quitApp() },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------
function parseVersion(s: string | null | undefined): number[] | null {
  const m = /(\d+(?:\.\d+)+)/.exec(s || "");
  return m ? m[1].split(".").map(Number) : null;
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

async function checkUpdates() {
  const repo = pkg.updateRepo;
  if (!repo || !cfg().check_updates) return;
  try {
    const res = await httpGet(`https://api.github.com/repos/${repo}/releases/latest`, 8000);
    if (res.status !== 200) return;
    const data = JSON.parse(res.text);
    const latest = parseVersion(data.tag_name || data.name);
    const mine = parseVersion(APP_VERSION);
    if (!latest || !mine || !newer(latest, mine)) return;
    const r = await dialog.showMessageBox(mainWindow!, {
      type: "info",
      title: t("app_title"),
      message: t("update_msg2", { new: latest.join("."), cur: APP_VERSION }),
      buttons: [t("update_open"), t("update_later")],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) void shell.openExternal(`https://github.com/${repo}/releases/latest`);
  } catch (e) {
    logDebug(`update check failed: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Languages: refresh the list from Google (cached on disk)
// ---------------------------------------------------------------------------
const LANG_CACHE = path.join(DATA_DIR, "languages_cache.json");

function loadLanguageCache() {
  try {
    const list = JSON.parse(fs.readFileSync(LANG_CACHE, "utf-8")) as Language[];
    if (Array.isArray(list) && list.length > 50) setLanguages(list);
  } catch {
    /* none yet */
  }
}

async function refreshLanguages() {
  try {
    const res = await httpGet(GTX_LANG_LIST_URL, 8000);
    if (res.status !== 200) return;
    const list = parseGoogleLanguageList(JSON.parse(res.text));
    if (list.length < 50) return;
    setLanguages(list);
    fs.writeFileSync(LANG_CACHE, JSON.stringify(list), "utf-8");
    mainWindow?.webContents.send("languages", allLanguages());
    logDebug(`languages: ${list.length} from Google`);
  } catch (e) {
    logDebug(`languages refresh failed: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Interface in any language: English strings machine-translated once per
// language (same Google → MyMemory chain as chat), cached in ui-translations/.
// The cache files are plain JSON and can be corrected by hand.
// ---------------------------------------------------------------------------
const UI_CACHE_DIR = path.join(DATA_DIR, "ui-translations");
let uiBusy: string | null = null;

function uiCacheFile(lang: string) {
  return path.join(UI_CACHE_DIR, `${lang.replace(/[^A-Za-z0-9-]/g, "_")}.json`);
}

/** Load a cached interface translation. Returns true when it is complete and current. */
function loadUiCache(lang: string): boolean {
  if (isHandTranslated(lang)) return true;
  try {
    const c = JSON.parse(fs.readFileSync(uiCacheFile(lang), "utf-8"));
    if (c && c.strings && typeof c.strings === "object") {
      setMachineStrings(lang, c.strings);
      return c.hash === hashStrings(englishStrings()) && c.complete === true;
    }
  } catch {
    /* no cache yet */
  }
  return false;
}

function sendUiStrings(lang: string) {
  mainWindow?.webContents.send("ui-strings", { lang, busy: uiBusy === lang, strings: getMachineStrings(lang) });
}

async function ensureUiStrings(lang: string, force = false) {
  if (isHandTranslated(lang) || uiBusy === lang) return;
  if (!force && loadUiCache(lang)) {
    sendUiStrings(lang);
    return;
  }
  uiBusy = lang;
  sendUiStrings(lang);
  logDebug(`ui: machine-translating the interface into ${lang}`);
  try {
    const r = await translateUiStrings(
      englishStrings(),
      lang,
      async (text, dst, src) => (await translator.translate(text, dst, src)).text,
      () => new Promise((res) => setTimeout(res, 250)),
    );
    fs.mkdirSync(UI_CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      uiCacheFile(lang),
      JSON.stringify({ lang, hash: hashStrings(englishStrings()), complete: r.complete, translatedAt: new Date().toISOString(), strings: r.strings }, null, 1),
      "utf-8",
    );
    setMachineStrings(lang, r.strings);
    logDebug(`ui: ${lang} done (complete=${r.complete})`);
  } catch (e) {
    logDebug(`ui: translation into ${lang} failed: ${e}`);
  } finally {
    uiBusy = null;
    sendUiStrings(lang);
    if (lang === uiLang()) {
      refreshTrayMenu();
      buildAppMenu();
      mainWindow?.setTitle(`${t("app_title")} v${APP_VERSION}`);
    }
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function logoDataUrl(): string {
  try {
    return `data:image/png;base64,${fs.readFileSync(iconPath(256)).toString("base64")}`;
  } catch {
    return "";
  }
}

function osDescription(): string {
  if (process.platform === "win32") return `Windows ${os.release()}`;
  if (process.platform === "darwin") return `macOS ${process.getSystemVersion?.() || os.release()}`;
  return `${os.type()} ${os.release()}`;
}

/** Open the About page (from the tray or the macOS app menu). */
function showAbout() {
  showWindow();
  toRenderer("app-menu", "about");
}

function soundUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of BUILTIN_SOUNDS) out[id] = pathToFileURL(path.join(resourcesDir(), "sounds", `${id}.wav`)).href;
  return out;
}

function registerIpc() {
  ipcMain.handle("init", (): InitState => ({
    cfg: cfg(),
    version: APP_VERSION,
    platform: process.platform,
    targetLang,
    languages: allLanguages(),
    dataDir: DATA_DIR,
    soundUrls: soundUrls(),
    hasTray: !!tray || process.platform === "darwin",
    uiLang: uiLang(),
    uiStrings: getMachineStrings(uiLang()),
    uiBusy: uiBusy === uiLang(),
    logoUrl: logoDataUrl(),
    mode: isOverlay() ? "overlay" : "normal",
    snapshot: pendingSnapshot,
    engineRunning: engine.isRunning,
    clickThroughSupported: process.platform !== "linux",
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      os: osDescription(),
      arch: process.arch,
    },
  }));
  ipcMain.handle("retranslate-ui", () => void ensureUiStrings(uiLang(), true));

  ipcMain.handle("set-config", async (_e, patch: Partial<Config>) => {
    const prevTarget = cfg().target_lang;
    const prevUi = uiLang();
    store.update(patch);
    if ("on_top" in patch) mainWindow?.setAlwaysOnTop(!!cfg().on_top);
    if ("target_lang" in patch && patch.target_lang !== prevTarget) {
      targetLang = await resolveTargetLang(cfg().target_lang);
      pipeline.clearCache();
    }
    if (uiLang() !== prevUi) {
      loadUiCache(uiLang());
      void ensureUiStrings(uiLang());
      refreshTrayMenu();
      buildAppMenu();
      mainWindow?.setTitle(`${t("app_title")} v${APP_VERSION}`);
    }
    return { cfg: cfg(), targetLang };
  });

  ipcMain.handle("start", (): StartResult => {
    const err = engine.start(cfg().clients || []);
    if (!err) return { ok: true };
    return err.error === "bad_path" ? { ok: false, error: "bad_path", path: err.path } : { ok: false, error: "no_clients" };
  });
  ipcMain.handle("stop", () => engine.stop());
  ipcMain.handle("status", () => ({ running: engine.isRunning, count: engine.count, backend: translator.backend }));

  ipcMain.handle("find-all-clients", () => findAllLogsDirs(t("kind_steam"), t("kind_site")));

  ipcMain.handle("pick-folder", async (_e, title: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title, properties: ["openDirectory"] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  ipcMain.handle("pick-sound-file", async (_e, filterName: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      filters: [{ name: filterName, extensions: ["wav", "mp3", "ogg", "flac", "m4a"] }],
    });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  ipcMain.handle("file-url", (_e, p: string) => (p && fs.existsSync(p) ? pathToFileURL(p).href : ""));

  ipcMain.handle("translate-reply", async (_e, text: string, src: string, dst: string) => {
    try {
      return await pipeline.translateReply(text, src, dst);
    } catch (e) {
      logDebug(`reply translation failed: ${e}`);
      return null;
    }
  });
  ipcMain.handle("preview", async (_e, text: string, lang: string) => {
    try {
      return (await pipeline.preview(text, lang, cfg().translate_currency)).translated;
    } catch (e) {
      logDebug(`glossary preview failed: ${e}`);
      return null;
    }
  });

  ipcMain.handle("glossary-get", () => ({ items: glossary.rawItems(), path: glossary.path }));
  ipcMain.handle("glossary-save", (_e, items) => {
    try {
      glossary.saveItems(items);
      pipeline.clearCache();
      return { ok: true };
    } catch (e) {
      logDebug(`glossary save error: ${e}`);
      return { ok: false, error: String(e) };
    }
  });
  ipcMain.handle("open-glossary-file", () => {
    glossary.rawItems(); // make sure the file exists
    if (glossary.path) void shell.openPath(glossary.path);
  });
  ipcMain.handle("open-data-dir", () => void shell.openPath(DATA_DIR));
  ipcMain.handle("copy", (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle("notify", (_e, title: string, body: string, jump?: Jump) =>
    showNotification(title, body, jump ? () => jumpTo(jump) : () => showWindow(), logDebug),
  );
  ipcMain.handle("show-last-alert", (_e, rec: AlertRecord, head: string) => showLastAlert(rec, head));
  ipcMain.handle("log", (_e, msg: string) => logDebug(`ui: ${msg}`));
  ipcMain.handle("magnifier-toggle", () => magnifier?.toggle());
  ipcMain.handle("quit-app", () => quitApp());
  ipcMain.handle("renderer-ready", (e) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return;
    rendererReady = true;
    pendingSnapshot = null;
    for (const [ch, payload] of outbox.splice(0)) mainWindow.webContents.send(ch, payload);
  });
  ipcMain.handle("overlay-toggle", (_e, on?: boolean) => setOverlay(typeof on === "boolean" ? on : !isOverlay()));
  ipcMain.handle("overlay-set", (_e, patch: Partial<Config["overlay"]>) => {
    const ok: Partial<Config["overlay"]> = {};
    if (typeof patch.opacity === "number") ok.opacity = Math.min(1, Math.max(0.15, patch.opacity));
    if (typeof patch.click_through === "boolean") ok.click_through = patch.click_through;
    if (typeof patch.no_focus === "boolean") {
      ok.no_focus = patch.no_focus;
      if (isOverlay() && process.platform !== "linux") mainWindow?.setFocusable(!patch.no_focus);
    }
    store.update({ overlay: { ...cfg().overlay, ...ok } });
    return cfg().overlay;
  });
  ipcMain.on("overlay-ignore-mouse", (e, ignore: boolean) => {
    if (!mainWindow || e.sender !== mainWindow.webContents || !isOverlay()) return;
    mainWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on("overlay-resize", (e, width: number, height: number) => {
    if (!mainWindow || e.sender !== mainWindow.webContents || !isOverlay()) return;
    const bnd = mainWindow.getBounds();
    mainWindow.setBounds({ x: bnd.x, y: bnd.y, width: Math.max(240, Math.round(width)), height: Math.max(110, Math.round(height)) });
  });
  if (process.env.WCT_TEST_HOOKS === "1") {
    // automated tests only: behave exactly like clicking the window's close button
    ipcMain.handle("test-close-window", () => mainWindow?.close());
  }
  ipcMain.handle("set-hotkeys", (_e, keys: { mag_toggle: string; mag_translate: string; overlay: string }) => {
    store.update({
      magnifier: { ...cfg().magnifier, hotkey_toggle: keys.mag_toggle, hotkey_translate: keys.mag_translate },
      overlay: { ...cfg().overlay, hotkey: keys.overlay },
    });
    return registerHotkeys();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
/**
 * Quit for real. Everything is shut down explicitly and windows are destroyed
 * (not closed, so no handler can cancel it). A watchdog force-exits after 3 s
 * if anything still holds the process — the app must never linger in the
 * background keeping its files locked.
 */
function quitApp() {
  if (quitting) return;
  quitting = true;
  logDebug("quit requested");
  setTimeout(() => {
    logDebug("quit watchdog: forcing exit");
    app.exit(0);
  }, 3000);
  const step = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      logDebug(`quit: ${name} failed: ${e}`);
    }
  };
  step("engine", () => engine?.stop());
  step("magnifier", () => magnifier?.close());
  step("alert window", () => closeAlertWindow());
  step("shortcuts", () => globalShortcut.unregisterAll());
  step("instance server", () => instanceServer?.close());
  step("tray", () => {
    tray?.destroy();
    tray = null;
  });
  step("windows", () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
  });
  void ocr?.dispose().finally(() => {
    logDebug("=== exit ===");
    app.quit();
  });
  // app.quit() above runs once the OCR worker is gone (instant when it never started)
}

async function singleInstanceGate(): Promise<boolean> {
  if (!(await sendToRunning("ping"))) return true;
  logDebug("another instance is running");
  const lang = resolveUiLang(store.cfg.ui_lang, await resolveTargetLang(store.cfg.target_lang));
  const tt = makeT(lang);
  const r = await dialog.showMessageBox({
    type: "question",
    title: tt("app_title"),
    message: tt("instance_msg2"),
    buttons: [tt("btn_activate"), tt("btn_replace"), tt("btn_cancel")],
    defaultId: 0,
    cancelId: 2,
  });
  if (r.response === 0) {
    await sendToRunning("activate");
    return false;
  }
  if (r.response === 1) {
    await sendToRunning("quit");
    await waitUntilGone();
    return true;
  }
  return false;
}

async function main() {
  app.setAppUserModelId(APP_ID);
  await app.whenReady();
  logDebug(`=== start BabelWurm v${APP_VERSION} (${process.platform}) data=${DATA_DIR} ===`);

  // the default alert note in the user's language on first run
  const firstLang = resolveUiLang("auto", osLanguage());
  store = new ConfigStore(DATA_DIR, logDebug, I18N[firstLang]?.default_alert_note || I18N.en.default_alert_note);

  if (!(await singleInstanceGate())) {
    app.exit(0);
    return;
  }
  instanceServer = listen({ activate: () => showWindow(), quit: () => quitApp() }, logDebug);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => quitApp());

  loadLanguageCache();
  targetLang = await resolveTargetLang(cfg().target_lang);
  if (store.freshAlerts && cfg().alerts[0]) {
    // first run: the default alert's note in the interface language
    cfg().alerts[0].note = I18N[uiLang()]?.default_alert_note || cfg().alerts[0].note;
    store.save();
  }
  translator = new Translator(process.env.WCT_MOCK_NET === "1" ? mockHttpGet : httpGet);
  translator.onLog = logDebug;
  glossary = new Glossary(glossaryFile(), logDebug);
  pipeline = new Pipeline(translator, glossary, new Lexicon(path.join(DATA_DIR, "lexicon_cache.json"), translator));
  engine = new Engine(
    pipeline,
    messageOptions,
    (m) => toRenderer("message", m),
    (e) => toRenderer("engine-event", e),
    logDebug,
  );

  loadUiCache(uiLang()); // cached interface translation ready before the window opens
  ocr = new OcrService(DATA_DIR, path.join(resourcesDir(), "ocr"), downloadFile, logDebug);
  magnifier = new Magnifier({
    cfg,
    save: (patch) => store.update(patch),
    t: (k, v) => t(k, v),
    targetLang: () => targetLang,
    uiLang,
    pipeline: () => pipeline,
    ocr,
    log: logDebug,
  });
  registerIpc();
  buildAppMenu();
  buildTray();
  createMainWindow();

  app.on("activate", () => showWindow());
  // Cmd+Q, app menu, OS shutdown: go through the same orderly quit
  app.on("before-quit", (e) => {
    if (!quitting) {
      e.preventDefault();
      quitApp();
    }
  });
  powerMonitor.on("shutdown", () => quitApp());
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
  nativeTheme.on("updated", () => {
    if (mainWindow) mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#1e1f22" : "#f6f7f9");
  });

  registerHotkeys();
  setTimeout(() => void ensureUiStrings(uiLang()), 1500);
  setTimeout(() => void refreshLanguages(), 3000);
  setTimeout(() => void checkUpdates(), 5000);
  logDebug(`target=${targetLang} ui=${uiLang()} clients=${JSON.stringify(cfg().clients.map((c) => [c.name, characterFromLogsPath(c.path)]))}`);
}

void main();
