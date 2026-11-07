/** Types shared by the main process, the preload scripts and the UI. */
import type { AlertRule } from "../core/alerts";
import type { ClientCfg, Config } from "../core/config";
import type { ChatMessage, EngineEvent } from "../core/engine";
import type { GlossaryItem } from "../core/glossary";
import type { Language } from "../core/languages";
import type { BackendState } from "../core/translate";

export type { AlertRule, ChatMessage, ClientCfg, Config, EngineEvent, GlossaryItem, Language, BackendState };

export interface InitState {
  cfg: Config;
  version: string;
  platform: string;
  /** Resolved target language (config "auto" → Steam → OS). */
  targetLang: string;
  languages: Language[];
  dataDir: string;
  /** file:// URLs of the built-in sounds by id. */
  soundUrls: Record<string, string>;
  /** True when the OS supports a tray icon here (close → minimize to tray). */
  hasTray: boolean;
  /** Interface language and its machine-translated strings (null for hand-translated languages). */
  uiLang: string;
  uiStrings: Record<string, string> | null;
  uiBusy: boolean;
  /** About page: the logo as a data URL and runtime versions. */
  logoUrl: string;
  /** Window mode, UI state handed over from the previous window (mode switch), engine state. */
  mode: "normal" | "overlay";
  snapshot: unknown;
  engineRunning: boolean;
  clickThroughSupported: boolean;
  runtime: { electron: string; chrome: string; node: string; os: string; arch: string };
}

export interface Status {
  running: boolean;
  count: number;
  backend: BackendState;
}

export type StartResult = { ok: true } | { ok: false; error: "no_clients" } | { ok: false; error: "bad_path"; path: string };

export interface AlertRecord {
  at: string;
  client: number;
  channel: string;
  text: string;
}

export interface Jump {
  clientIdx: number;
  channel: string;
}

export interface Api {
  init(): Promise<InitState>;
  setConfig(patch: Partial<Config>): Promise<{ cfg: Config; targetLang: string }>;
  start(): Promise<StartResult>;
  stop(): Promise<void>;
  status(): Promise<Status>;
  findAllClients(): Promise<Array<{ name: string; path: string }>>;
  pickFolder(title: string): Promise<string | null>;
  pickSoundFile(filterName: string): Promise<string | null>;
  fileUrl(p: string): Promise<string>;
  translateReply(text: string, src: string, dst: string): Promise<string | null>;
  preview(text: string, lang: string): Promise<string | null>;
  glossaryGet(): Promise<{ items: GlossaryItem[]; path: string | null }>;
  glossarySave(items: GlossaryItem[]): Promise<{ ok: boolean; error?: string }>;
  openGlossaryFile(): Promise<void>;
  openDataDir(): Promise<void>;
  copy(text: string): Promise<void>;
  notify(title: string, body: string, jump?: Jump): Promise<void>;
  showLastAlert(rec: AlertRecord, head: string): Promise<void>;
  log(msg: string): Promise<void>;
  retranslateUi(): Promise<void>;
  toggleMagnifier(): Promise<void>;
  quit(): Promise<void>;
  setHotkeys(keys: { mag_toggle: string; mag_translate: string; overlay: string }): Promise<Record<string, boolean>>;
  ready(): Promise<void>;
  toggleOverlay(on?: boolean): Promise<void>;
  overlaySet(patch: { opacity?: number; click_through?: boolean; no_focus?: boolean }): Promise<Config["overlay"]>;
  overlayIgnoreMouse(ignore: boolean): void;
  overlayResize(width: number, height: number): void;
  onUiStrings(cb: (d: { lang: string; busy: boolean; strings: Record<string, string> | null }) => void): void;
  onMessage(cb: (m: ChatMessage) => void): void;
  onEngineEvent(cb: (e: EngineEvent) => void): void;
  onJump(cb: (j: Jump) => void): void;
  onLanguages(cb: (list: Language[]) => void): void;
  onAppMenu(cb: (cmd: string) => void): void;
}

export interface AlertWindowApi {
  onData(cb: (d: { head: string; text: string; jumpLabel: string; closeLabel: string; title: string; dark: boolean }) => void): void;
  jump(): void;
  close(): void;
}

export interface MagInit {
  labels: Record<string, string>;
  auto: boolean;
  ocrLang: string;
  ocrLangs: Array<{ code: string; name: string }>;
  suggested: string;
  targetLang: string;
  header: number;
  panel: number;
  border: number;
  dark: boolean;
  clickThrough: boolean;
  last: MagResult;
}

export interface MagResult {
  state: "idle" | "reading" | "downloading" | "done" | "empty" | "error" | "permission";
  text?: string;
  translated?: string | null;
  srcLang?: string | null;
  confidence?: number;
  message?: string;
}

export interface MagApi {
  init(): Promise<MagInit>;
  capture(box: { x: number; y: number; width: number; height: number }, auto: boolean): Promise<void>;
  ignoreMouse(ignore: boolean): void;
  resize(w: number, h: number): void;
  set(patch: { auto?: boolean; ocr_lang?: string }): void;
  close(): void;
  openPrefs(): void;
  copy(text: string): void;
  onResult(cb: (r: MagResult) => void): void;
  onTrigger(cb: () => void): void;
}
