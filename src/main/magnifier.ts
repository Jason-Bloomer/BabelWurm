/**
 * The magnifier: a detached, transparent, always-on-top box the user drags over
 * any text on screen. On request (button, hotkey or auto mode) the screen
 * under the box is captured, prepared for OCR, recognized with Tesseract and
 * translated with the same pipeline as chat.
 *
 * Window layout (fixed heights so the capture area is known):
 *   header (drag handle + controls) | transparent capture box | result panel
 * The capture box interior is click-through on Windows and macOS (mouse
 * events are forwarded so the box knows when the pointer leaves it).
 */
import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeTheme, screen, shell, systemPreferences } from "electron";
import * as path from "node:path";
import { defaultMagnifierCfg, type Config, type MagnifierCfg } from "../core/config";
import { languageName } from "../core/languages";
import { cleanOcrText, OCR_LANGS, ocrCodeFor, ocrLangString } from "../core/ocrLangs";
import { encodePngGray, fingerprint, prepareForOcr } from "../core/ocrPrep";
import type { Pipeline } from "../core/pipeline";
import type { TFunc } from "../core/i18n";
import type { MagResult } from "../shared/api";
import type { OcrService } from "./ocr";

export const MAG_HEADER = 34;
export const MAG_PANEL = 140;
export const MAG_BORDER = 2;

export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Deps {
  cfg: () => Config;
  save: (patch: Partial<Config>) => void;
  t: TFunc;
  targetLang: () => string;
  uiLang: () => string;
  pipeline: () => Pipeline;
  ocr: OcrService;
  log: (m: string) => void;
}

export class Magnifier {
  private win: BrowserWindow | null = null;
  private lastPrint = "";
  private lastText = "";
  private lastResult: MagResult = { state: "idle" };
  private busy = false;
  private hotkeyErrors: Record<string, boolean> = {};
  /**
   * Linux without a compositor can't draw transparent windows: the box shows
   * up opaque and the capture would see the box itself. Detected on the first
   * blank capture; from then on the box is hidden for the instant of capture.
   */
  private hideForCapture = false;

  constructor(private readonly d: Deps) {
    this.registerIpc();
  }

  private mcfg(): MagnifierCfg {
    return { ...defaultMagnifierCfg(), ...(this.d.cfg().magnifier || {}) };
  }

  private saveMcfg(patch: Partial<MagnifierCfg>) {
    this.d.save({ magnifier: { ...this.mcfg(), ...patch } });
  }

  get isOpen() {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.showInactive();
      return;
    }
    const m = this.mcfg();
    const area = screen.getPrimaryDisplay().workArea;
    const width = m.width + MAG_BORDER * 2;
    const height = MAG_HEADER + m.height + MAG_BORDER * 2 + MAG_PANEL;
    const x = m.x ?? Math.round(area.x + (area.width - width) / 2);
    const y = m.y ?? Math.round(area.y + area.height / 3);
    this.win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false, // resized with our own grip (transparent windows can't use system edges everywhere)
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: this.d.t("mag_title"),
      webPreferences: {
        preload: path.join(__dirname, "magPreload.js"),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.loadFile(path.join(__dirname, "..", "renderer", "magnifier.html"));
    const w = this.win;
    w.once("ready-to-show", () => w.show());
    let saveTimer: NodeJS.Timeout | null = null;
    w.on("move", () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (w.isDestroyed()) return;
        const b = w.getBounds();
        this.saveMcfg({ x: b.x, y: b.y });
      }, 400);
    });
    w.on("closed", () => {
      if (this.win === w) this.win = null;
    });
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = null;
  }

  /** Hotkey "translate": open if needed and read the box. */
  trigger() {
    if (!this.isOpen) {
      this.open();
      return;
    }
    this.win?.webContents.send("mag-trigger");
  }

  // ---------------- hotkeys ----------------
  /** Register the magnifier shortcuts plus `extra` ones (e.g. the overlay toggle). */
  registerHotkeys(extra: Array<[string, () => void]> = []): Record<string, boolean> {
    globalShortcut.unregisterAll();
    const m = this.mcfg();
    this.hotkeyErrors = {};
    const reg = (accel: string, fn: () => void) => {
      if (!accel) return;
      try {
        if (!globalShortcut.register(accel, fn)) this.hotkeyErrors[accel] = true;
      } catch {
        this.hotkeyErrors[accel] = true;
      }
    };
    reg(m.hotkey_toggle, () => this.toggle());
    reg(m.hotkey_translate, () => this.trigger());
    for (const [accel, fn] of extra) reg(accel, fn);
    if (Object.keys(this.hotkeyErrors).length) this.d.log(`hotkeys not registered: ${Object.keys(this.hotkeyErrors).join(", ")}`);
    return this.hotkeyErrors;
  }

  // ---------------- capture → OCR → translate ----------------
  private send(r: MagResult) {
    this.lastResult = r;
    this.win?.webContents.send("mag-result", r);
  }

  /** Screen rectangle (DIP) of the capture box from its position inside the window. */
  private screenRect(box: BoxRect): BoxRect | null {
    if (!this.win || this.win.isDestroyed()) return null;
    const cb = this.win.getContentBounds();
    return {
      x: Math.round(cb.x + box.x + MAG_BORDER + 1),
      y: Math.round(cb.y + box.y + MAG_BORDER + 1),
      width: Math.max(1, Math.round(box.width - MAG_BORDER * 2 - 2)),
      height: Math.max(1, Math.round(box.height - MAG_BORDER * 2 - 2)),
    };
  }

  async capture(box: BoxRect, auto: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
        // asking once triggers the system prompt; capture still runs (it may return only the wallpaper)
        if (!auto) this.d.log(`screen recording permission: ${systemPreferences.getMediaAccessStatus("screen")}`);
      }
      const rect = this.screenRect(box);
      if (!rect) return;
      const display = screen.getDisplayMatching(rect);
      let { crop, thumb, sf } = await this.grab(rect, display, this.hideForCapture);
      if (!crop) {
        this.send({ state: process.platform === "darwin" ? "permission" : "error", message: "capture" });
        return;
      }
      if (process.platform === "linux" && !this.hideForCapture && looksOpaqueBox(crop)) {
        this.hideForCapture = true;
        this.d.log("magnifier: transparent windows not supported here (no compositor?) — hiding the box while capturing");
        ({ crop, thumb, sf } = await this.grab(rect, display, true));
        if (!crop) return;
      }
      const size = crop.getSize();
      const prepared = prepareForOcr({ width: size.width, height: size.height, data: crop.toBitmap(), order: "bgra" });
      if (process.env.WCT_DEBUG_CAPTURE) {
        // development aid: what exactly was captured and what OCR sees
        const fs = await import("node:fs");
        fs.writeFileSync(path.join(process.env.WCT_DEBUG_CAPTURE, "capture.png"), crop.toPNG());
        fs.writeFileSync(path.join(process.env.WCT_DEBUG_CAPTURE, "screen.png"), thumb!.toPNG());
        fs.writeFileSync(path.join(process.env.WCT_DEBUG_CAPTURE, "prepared.png"), encodePngGray(prepared.image));
        this.d.log(`magnifier: rect=${JSON.stringify(rect)} display=${JSON.stringify(display.bounds)} sf=${sf} thumb=${JSON.stringify(thumb!.getSize())} crop=${JSON.stringify(size)}`);
      }
      const print = fingerprint(prepared.image);
      if (auto && print === this.lastPrint) return; // nothing changed under the box
      this.lastPrint = print;

      const langs = ocrLangString(this.mcfg().ocr_lang);
      if (!auto) this.send({ state: "reading" });
      try {
        await this.d.ocr.ensure(langs, (code) => this.send({ state: "downloading", message: code }));
      } catch (e) {
        this.d.log(`magnifier: language data download failed: ${e}`);
        const code = langs.split("+")[0];
        const name = languageName(OCR_LANGS.find((l) => l.code === code)?.lang || "en", this.d.uiLang());
        this.send({ state: "error", message: this.d.t("mag_download_failed", { lang: name }) });
        return;
      }
      const singleLine = rect.height < 40 && rect.width > rect.height * 4;
      const r = await this.d.ocr.recognize(encodePngGray(prepared.image), langs, singleLine);
      const text = cleanOcrText(r.text);
      if (!text) {
        this.lastText = "";
        this.send({ state: "empty", confidence: r.confidence });
        return;
      }
      if (auto && text === this.lastText) return;
      this.lastText = text;
      this.send({ state: "reading", text, confidence: r.confidence });
      const cfg = this.d.cfg();
      const tr = await this.d.pipeline().preview(text, this.d.targetLang(), cfg.translate_currency);
      this.send({ state: "done", text, translated: tr.translated, srcLang: tr.srcLang, confidence: r.confidence });
    } catch (e) {
      this.d.log(`magnifier: ${e instanceof Error ? e.stack : e}`);
      this.send({ state: "error", message: `${this.d.t("mag_error")}: ${String(e instanceof Error ? e.message : e)}` });
    } finally {
      this.busy = false;
    }
  }

  /** Capture the screen and crop the box area (physical pixels). */
  private async grab(rect: BoxRect, display: Electron.Display, hide: boolean): Promise<{ crop: Electron.NativeImage | null; thumb: Electron.NativeImage | null; sf: number }> {
    const sf = display.scaleFactor || 1;
    const w = this.win;
    const wasVisible = !!w && !w.isDestroyed() && w.isVisible();
    if (hide && wasVisible) {
      w!.hide();
      await new Promise((r) => setTimeout(r, 150)); // let the screen repaint without the box
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
      });
      const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      if (!src || src.thumbnail.isEmpty()) return { crop: null, thumb: null, sf };
      const thumb = src.thumbnail;
      const k = thumb.getSize().width / display.bounds.width;
      const crop = thumb.crop({
        x: Math.max(0, Math.round((rect.x - display.bounds.x) * k)),
        y: Math.max(0, Math.round((rect.y - display.bounds.y) * k)),
        width: Math.max(1, Math.round(rect.width * k)),
        height: Math.max(1, Math.round(rect.height * k)),
      });
      return { crop, thumb, sf };
    } finally {
      if (hide && wasVisible && w && !w.isDestroyed()) w.showInactive();
    }
  }

  // ---------------- IPC ----------------
  private registerIpc() {
    const fromMag = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.handle("mag-init", () => {
      const m = this.mcfg();
      const t = this.d.t;
      const ui = this.d.uiLang();
      const keys = [
        "mag_title", "mag_translate", "mag_auto", "mag_hint", "mag_reading", "mag_downloading", "mag_no_text", "mag_error",
        "mag_mac_permission", "mag_open_prefs", "mag_copy", "mag_close", "mag_conf", "mag_ocr_lang", "mag_same_lang", "status_translate_fail",
      ];
      const labels: Record<string, string> = {};
      for (const k of keys) labels[k] = t(k, { key: m.hotkey_translate.replace("CommandOrControl", process.platform === "darwin" ? "⌘" : "Ctrl") });
      return {
        labels,
        auto: m.auto,
        ocrLang: m.ocr_lang,
        ocrLangs: OCR_LANGS.map((l) => ({ code: l.code, name: languageName(l.lang, ui) })),
        suggested: ocrCodeFor(this.d.targetLang()),
        targetLang: this.d.targetLang(),
        header: MAG_HEADER,
        panel: MAG_PANEL,
        border: MAG_BORDER,
        dark: this.d.cfg().theme === "dark" || (this.d.cfg().theme !== "light" && nativeTheme.shouldUseDarkColors),
        clickThrough: process.platform !== "linux",
        last: this.lastResult,
      };
    });
    ipcMain.handle("mag-capture", (e, box: BoxRect, auto: boolean) => (fromMag(e) ? this.capture(box, auto) : undefined));
    ipcMain.on("mag-ignore-mouse", (e, ignore: boolean) => {
      if (fromMag(e)) this.win?.setIgnoreMouseEvents(ignore, { forward: true });
    });
    ipcMain.on("mag-resize", (e, w: number, h: number) => {
      if (!fromMag(e) || !this.win) return;
      const bw = Math.max(80, Math.min(2400, Math.round(w)));
      const bh = Math.max(24, Math.min(1400, Math.round(h)));
      const b = this.win.getBounds();
      this.win.setBounds({ x: b.x, y: b.y, width: bw + MAG_BORDER * 2, height: MAG_HEADER + bh + MAG_BORDER * 2 + MAG_PANEL });
      this.saveMcfg({ width: bw, height: bh });
    });
    ipcMain.on("mag-set", (e, patch: Partial<MagnifierCfg>) => {
      if (!fromMag(e)) return;
      const ok: Partial<MagnifierCfg> = {};
      if (typeof patch.auto === "boolean") ok.auto = patch.auto;
      if (typeof patch.ocr_lang === "string") {
        ok.ocr_lang = patch.ocr_lang;
        this.lastPrint = "";
        this.lastText = "";
      }
      this.saveMcfg(ok);
    });
    ipcMain.on("mag-close", (e) => fromMag(e) && this.close());
    ipcMain.on("mag-open-prefs", () => void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"));
  }
}

/** A capture of our own opaque box: (nearly) uniform black. */
function looksOpaqueBox(img: Electron.NativeImage): boolean {
  const b = img.toBitmap();
  const { width, height } = img.getSize();
  let sum = 0;
  let sq = 0;
  let n = 0;
  // sample the middle only (edges may hold anti-aliasing of the frame)
  for (let y = Math.floor(height * 0.15); y < height * 0.85; y += 2) {
    for (let x = Math.floor(width * 0.1); x < width * 0.9; x += 2) {
      const i = (y * width + x) * 4;
      const v = (b[i] + b[i + 1] + b[i + 2]) / 3;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (!n) return false;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  return mean < 6 && sd < 3;
}
