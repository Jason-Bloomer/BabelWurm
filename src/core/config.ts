/**
 * Settings (babelwurm_config.json). An older-format config file in the same
 * folder (LEGACY_CONFIG_FILE_NAME) is imported once on first start.
 * Every toggle is saved immediately (the app may be killed rather than closed).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureRuleIds, type AlertRule } from "./alerts";
import { DEFAULT_NO_TRANSLATE } from "./channels";

export interface ClientCfg {
  name: string;
  path: string;
}

export interface Config {
  /** One entry per game copy (multi-boxing): {name, path to …/players/<Char>/logs}. */
  clients: ClientCfg[];
  translate: boolean;
  on_top: boolean;
  show_original: boolean;
  /** Own sound file (wav/mp3/ogg); when set it wins over the built-in sounds. */
  sound_file: string;
  /** Built-in sound id (BUILTIN_SOUNDS). */
  sound: string;
  /** Per-channel sound: {"Trade": "bell"}; missing = global sound. */
  channel_sounds: Record<string, string>;
  /** "auto" → Steam client language → OS language. */
  target_lang: string;
  /** Interface language: "auto" = same as target language when a translation exists, else English. */
  ui_lang: string;
  /** Reply panel source; "" → same as the target language. */
  reply_src: string;
  reply_dst: string;
  translate_lang_channels: boolean;
  translate_currency: boolean;
  auto_copy_reply: boolean;
  /** Channels with a sound on new messages (♪ on the tab). */
  sound_channels: string[];
  /** Channels with a popup notification on new messages (✉ on the tab). */
  notify_channels: string[];
  alerts: AlertRule[];
  /** Channels shown as written, never translated (busy English system logs by default). */
  no_translate_channels: string[];
  /** Tabs the user hid (messages are still received; alerts still fire). */
  hidden_channels: string[];
  /** Highlight messages that mention the client's character name. */
  highlight_mentions: boolean;
  /** "system" | "light" | "dark". */
  theme: string;
  font_size: number;
  /** Close button: "ask" (first time), "tray" (keep running in the tray) or "quit". */
  close_action: "ask" | "tray" | "quit";
  check_updates: boolean;
  magnifier: MagnifierCfg;
  overlay: OverlayCfg;
  window?: { x?: number; y?: number; width: number; height: number; maximized?: boolean };
}

/** Magnifier (screen OCR) settings. */
export interface MagnifierCfg {
  x?: number;
  y?: number;
  /** Size of the capture box (not the whole window). */
  width: number;
  height: number;
  auto: boolean;
  ocr_lang: string;
  hotkey_toggle: string;
  hotkey_translate: string;
}

export function defaultMagnifierCfg(): MagnifierCfg {
  return { width: 360, height: 110, auto: false, ocr_lang: "eng", hotkey_toggle: "CommandOrControl+Shift+M", hotkey_translate: "CommandOrControl+Shift+T" };
}

/** Overlay mode: the main window as a see-through chat panel on top of the game. */
export interface OverlayCfg {
  enabled: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  /** Background opacity 0.15–1 (text stays fully opaque). */
  opacity: number;
  /** Clicks on the chat text go through to the game (Windows/macOS). */
  click_through: boolean;
  /** Clicking the overlay doesn't take keyboard focus from the game (Windows/macOS). */
  no_focus: boolean;
  hotkey: string;
}

export function defaultOverlayCfg(): OverlayCfg {
  return { enabled: false, opacity: 0.7, click_through: false, no_focus: true, hotkey: "CommandOrControl+Shift+O" };
}

export const DEFAULT_ALERT_NOTE_RU = "обнаружен центр поселения с сундучком, иди ищи и копай";

export function defaultConfig(): Config {
  return {
    clients: [],
    translate: true,
    on_top: false,
    show_original: false,
    sound_file: "",
    sound: "beep",
    channel_sounds: {},
    target_lang: "auto",
    ui_lang: "auto",
    reply_src: "",
    reply_dst: "en",
    translate_lang_channels: false,
    translate_currency: true,
    auto_copy_reply: true,
    sound_channels: [],
    notify_channels: [],
    // Default alert: the archaeology message "complete the location details"
    // arrives in the Event channel — react in every way. Added once; after
    // "alerts" is in the file the user owns the list.
    alerts: [
      {
        channels: ["Event"],
        pattern: "complete the location details",
        note: "",
        enabled: true,
        sound: true,
        notify: true,
      },
    ],
    no_translate_channels: [...DEFAULT_NO_TRANSLATE],
    hidden_channels: [],
    highlight_mentions: true,
    theme: "system",
    font_size: 13,
    close_action: "ask",
    check_updates: true,
    magnifier: defaultMagnifierCfg(),
    overlay: defaultOverlayCfg(),
  };
}

export const CONFIG_FILE_NAME = "babelwurm_config.json";
/** Older config file name, still imported automatically. */
export const LEGACY_CONFIG_FILE_NAME = "wurm_chat_gui_config.json";

export class ConfigStore {
  cfg: Config;
  readonly file: string;
  /** True when the default alert was just created (its note can be localised). */
  freshAlerts = false;

  constructor(dataDir: string, private readonly log: (m: string) => void = () => {}, defaultNote = DEFAULT_ALERT_NOTE_RU) {
    this.file = path.join(dataDir, CONFIG_FILE_NAME);
    const legacy = path.join(dataDir, LEGACY_CONFIG_FILE_NAME);
    if (!fs.existsSync(this.file) && fs.existsSync(legacy)) {
      try {
        fs.copyFileSync(legacy, this.file); // the old file stays as a backup
        log(`config: imported ${LEGACY_CONFIG_FILE_NAME}`);
      } catch (e) {
        log(`config: cannot import ${LEGACY_CONFIG_FILE_NAME}: ${e}`);
      }
    }
    this.cfg = this.load(defaultNote);
  }

  private load(defaultNote: string): Config {
    let raw: Record<string, unknown> = {};
    if (fs.existsSync(this.file)) {
      try {
        raw = JSON.parse(fs.readFileSync(this.file, "utf-8")) || {};
      } catch (e) {
        this.log(`config: cannot parse ${this.file}: ${e}`);
        raw = {};
      }
    }
    const cfg = defaultConfig();
    if (!("alerts" in raw)) {
      cfg.alerts[0].note = defaultNote;
      this.freshAlerts = true;
    }
    for (const [k, v] of Object.entries(raw)) if ((k in cfg || k === "window") && k !== "close_to_tray") (cfg as unknown as Record<string, unknown>)[k] = v;
    let dirty = false;
    // the old close_to_tray flag defaulted to true, so only an explicit false is a real choice
    if (raw.close_to_tray === false && !("close_action" in raw)) cfg.close_action = "quit";
    if (!["ask", "tray", "quit"].includes(cfg.close_action)) cfg.close_action = "ask";
    delete (cfg as unknown as Record<string, unknown>).close_to_tray;
    // migration from < 1.5.0: single logs_dir -> clients list
    if ((!cfg.clients || !cfg.clients.length) && typeof raw.logs_dir === "string" && raw.logs_dir) {
      const p = raw.logs_dir as string;
      const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
      cfg.clients = [{ name: parts[parts.length - 2] || "Client", path: p }];
      dirty = true;
    }
    if (!Array.isArray(cfg.clients)) cfg.clients = [];
    if (!Array.isArray(cfg.alerts)) cfg.alerts = [];
    cfg.alerts = cfg.alerts.filter((r) => r && typeof r === "object");
    if (ensureRuleIds(cfg.alerts)) dirty = true;
    if (!Array.isArray(cfg.sound_channels)) cfg.sound_channels = [];
    if (!Array.isArray(cfg.notify_channels)) cfg.notify_channels = [];
    if (!Array.isArray(cfg.no_translate_channels)) cfg.no_translate_channels = [...DEFAULT_NO_TRANSLATE];
    if (!Array.isArray(cfg.hidden_channels)) cfg.hidden_channels = [];
    if (!cfg.channel_sounds || typeof cfg.channel_sounds !== "object") cfg.channel_sounds = {};
    cfg.overlay = { ...defaultOverlayCfg(), ...(cfg.overlay && typeof cfg.overlay === "object" ? cfg.overlay : {}) };
    cfg.magnifier = { ...defaultMagnifierCfg(), ...(cfg.magnifier && typeof cfg.magnifier === "object" ? cfg.magnifier : {}) };
    // The path the user entered is sacred: used as is, even if the folder is
    // unavailable right now (other drive, renamed). Auto-search only on request.
    if (dirty || !fs.existsSync(this.file)) this.saveTo(cfg);
    return cfg;
  }

  private saveTo(cfg: Config) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf-8");
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log(`config: cannot save: ${e}`);
    }
  }

  save(): void {
    this.saveTo(this.cfg);
  }

  update(patch: Partial<Config>): Config {
    Object.assign(this.cfg, patch);
    if (patch.alerts) ensureRuleIds(this.cfg.alerts);
    this.save();
    return this.cfg;
  }
}
