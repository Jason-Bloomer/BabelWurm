/**
 * UI state: settings mirror, chat history per (client, channel), unread and
 * alert highlighting, alert log, status line. History lives outside Preact
 * state for speed; components subscribe to a version counter.
 */
import { useEffect, useState } from "preact/hooks";
import { AlertMatcher, channelFlag, firedNote, mentionedIn, ruleSoundId } from "../core/alerts";
import { CHANNEL_NAMES, characterFromLogsPath, sortChannels } from "../core/channels";
import { isRtl, makeT, resolveUiLang, setMachineStrings, type TFunc } from "../core/i18n";
import { setLanguages } from "../core/languages";
import type { AlertRecord, Api, ChatMessage, Config, InitState, Language } from "../shared/api";

declare global {
  interface Window {
    api: Api;
  }
}
export const api = (): Api => window.api;

export const HISTORY_MAX = 1000;

export interface Entry {
  id: number;
  /** PM conversation partner. */
  sub?: string;
  time: string;
  name: string | null;
  original: string;
  translated: string | null;
  src: string | null;
  mention: boolean;
}

/** Everything the UI knows that the engine doesn't — handed to the new window on a mode switch. */
export interface Snapshot {
  history: Array<[string, Entry[]]>;
  seen: Array<[number, string[]]>;
  currentClient: number;
  currentTab: Record<number, string>;
  unread: string[];
  alerted: string[];
  unreadClients: number[];
  alertedClients: number[];
  alertLog: AlertRecord[];
  count: number;
  backend: string | null;
  status: string;
}

export type Dialog = null | "clients" | "settings" | "alerts" | "alertlog" | "glossary" | "search" | "about";

type Listener = () => void;

class Store {
  cfg!: Config;
  init!: InitState;
  targetLang = "en";
  languages: Language[] = [];
  t: TFunc = makeT("en");
  uiLang = "en";
  /** The interface is being machine-translated right now. */
  uiBusy = false;
  running = false;
  status = "";
  count = 0;
  dialog: Dialog = null;
  searchQuery = "";
  currentClient = 0;
  currentTab: Record<number, string> = {};
  history = new Map<string, Entry[]>();
  unread = new Set<string>();
  alerted = new Set<string>();
  unreadClients = new Set<number>();
  alertedClients = new Set<number>();
  alertLog: AlertRecord[] = [];
  /** Channels discovered per client (log files present or messages received). */
  seen = new Map<number, Set<string>>();
  customSoundUrl = "";
  backend: string | null = null;
  /** Bumped on every change; components re-render on it. */
  version = 0;
  /** Set by the reply bar so a chat "Reply" can switch its language and focus it. */
  replyTo: ((lang: string) => void) | null = null;
  private listeners = new Set<Listener>();
  private matcher = new AlertMatcher();
  private audioCache = new Map<string, HTMLAudioElement>();

  snapshot(): Snapshot {
    return {
      history: [...this.history.entries()],
      seen: [...this.seen.entries()].map(([k, v]) => [k, [...v]]),
      currentClient: this.currentClient,
      currentTab: { ...this.currentTab },
      unread: [...this.unread],
      alerted: [...this.alerted],
      unreadClients: [...this.unreadClients],
      alertedClients: [...this.alertedClients],
      alertLog: this.alertLog.slice(),
      count: this.count,
      backend: this.backend,
      status: this.status,
    };
  }

  restore(sn: Snapshot) {
    try {
      this.history = new Map(sn.history);
      this.seen = new Map(sn.seen.map(([k, v]) => [k, new Set(v)]));
      this.currentClient = sn.currentClient || 0;
      this.currentTab = sn.currentTab || {};
      this.unread = new Set(sn.unread);
      this.alerted = new Set(sn.alerted);
      this.unreadClients = new Set(sn.unreadClients);
      this.alertedClients = new Set(sn.alertedClients);
      this.alertLog = sn.alertLog || [];
      this.count = sn.count || 0;
      this.backend = sn.backend;
      if (sn.status) this.status = sn.status;
    } catch (e) {
      void api().log(`restore failed: ${e}`);
    }
  }

  get overlay(): boolean {
    return this.init?.mode === "overlay";
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  async load() {
    this.init = await api().init();
    this.cfg = this.init.cfg;
    this.targetLang = this.init.targetLang;
    this.languages = this.init.languages;
    setLanguages(this.languages);
    if (this.init.uiStrings) setMachineStrings(this.init.uiLang, this.init.uiStrings);
    this.uiBusy = this.init.uiBusy;
    this.refreshLang();
    this.status = this.t("status_stopped");
    await this.refreshCustomSound();
    this.applyAppearance();
    api().onUiStrings((d) => {
      if (d.strings) setMachineStrings(d.lang, d.strings);
      this.uiBusy = d.busy && d.lang === this.uiLang;
      this.refreshLang();
      if (!this.running) this.status = this.t("status_stopped");
      this.emit();
    });
    api().onLanguages((list) => {
      this.languages = list;
      setLanguages(list);
      this.emit();
    });
  }

  refreshLang() {
    this.uiLang = resolveUiLang(this.cfg.ui_lang, this.targetLang);
    this.t = makeT(this.uiLang);
    document.documentElement.lang = this.uiLang;
    document.documentElement.dir = isRtl(this.uiLang) ? "rtl" : "ltr";
  }

  applyAppearance() {
    const root = document.documentElement;
    root.classList.toggle("overlay", this.overlay);
    root.style.setProperty("--ov-alpha", String(this.cfg.overlay?.opacity ?? 0.7));
    const theme = this.cfg.theme || "system";
    root.dataset.theme = theme;
    root.style.setProperty("--chat-font-size", `${this.cfg.font_size || 13}px`);
  }

  async refreshCustomSound() {
    this.customSoundUrl = this.cfg.sound_file ? await api().fileUrl(this.cfg.sound_file) : "";
  }

  /** Save settings (main persists immediately). */
  async set(patch: Partial<Config>) {
    Object.assign(this.cfg, patch);
    this.emit();
    const r = await api().setConfig(patch);
    this.cfg = r.cfg;
    const langChanged = r.targetLang !== this.targetLang || "ui_lang" in patch;
    this.targetLang = r.targetLang;
    if (langChanged) this.refreshLang();
    if ("sound_file" in patch) await this.refreshCustomSound();
    if ("theme" in patch || "font_size" in patch) this.applyAppearance();
    this.emit();
  }

  // ---------------- clients / tabs ----------------
  clientLabel(idx: number): string {
    const c = this.cfg.clients[idx];
    return c?.name || this.t("client_default", { n: idx + 1 });
  }

  /** "Client · Channel" when several clients, else just the channel. */
  placeLabel(idx: number, channel: string): string {
    return this.cfg.clients.length > 1 ? `${this.clientLabel(idx)} · ${channel}` : channel;
  }

  /** Visible tabs of a client: discovered channels in a sensible order, minus hidden ones. */
  tabs(idx: number): string[] {
    const names = new Set<string>(["Local", ...(this.seen.get(idx) || [])]);
    const hidden = new Set(this.cfg.hidden_channels || []);
    return sortChannels(names).filter((n) => !hidden.has(n));
  }

  /** Every channel known in this session plus those in the settings (alert rules, toggles). */
  allChannels(): string[] {
    const all = new Set<string>(CHANNEL_NAMES);
    for (const set of this.seen.values()) for (const c of set) all.add(c);
    for (const r of this.cfg.alerts || []) for (const c of r.channels || []) all.add(c);
    return sortChannels(all);
  }

  addChannels(idx: number, channels: string[]) {
    let set = this.seen.get(idx);
    if (!set) this.seen.set(idx, (set = new Set()));
    let added = false;
    for (const c of channels) {
      if (!set.has(c)) {
        set.add(c);
        added = true;
      }
    }
    if (added) this.emit();
  }

  hideChannel(channel: string) {
    const hidden = [...new Set([...(this.cfg.hidden_channels || []), channel])];
    void this.set({ hidden_channels: hidden });
  }

  unhideChannel(channel: string) {
    void this.set({ hidden_channels: (this.cfg.hidden_channels || []).filter((c) => c !== channel) });
  }

  isTranslated(channel: string): boolean {
    return !(this.cfg.no_translate_channels || []).includes(channel);
  }

  setTranslated(channel: string, on: boolean) {
    const cur = new Set(this.cfg.no_translate_channels || []);
    if (on) cur.delete(channel);
    else cur.add(channel);
    void this.set({ no_translate_channels: [...cur] });
  }

  tabOf(idx: number): string {
    const tabs = this.tabs(idx);
    const cur = this.currentTab[idx];
    return cur && tabs.includes(cur) ? cur : tabs[0] || "Local";
  }

  isVisible(idx: number, channel: string): boolean {
    return idx === this.currentClient && channel === this.tabOf(idx) && document.visibilityState === "visible";
  }

  switchClient(idx: number) {
    this.currentClient = idx;
    this.unreadClients.delete(idx);
    this.alertedClients.delete(idx);
    this.clearTab(idx, this.tabOf(idx));
    this.emit();
  }

  switchTab(idx: number, channel: string) {
    this.currentTab[idx] = channel;
    this.clearTab(idx, channel);
    this.emit();
  }

  jump(idx: number, channel: string) {
    if (idx >= this.cfg.clients.length) return;
    if ((this.cfg.hidden_channels || []).includes(channel)) this.unhideChannel(channel);
    this.currentClient = idx;
    this.unreadClients.delete(idx);
    this.alertedClients.delete(idx);
    this.switchTab(idx, channel);
  }

  private clearTab(idx: number, channel: string) {
    const k = key(idx, channel);
    this.unread.delete(k);
    this.alerted.delete(k);
  }

  entries(idx: number, channel: string): Entry[] {
    return this.history.get(key(idx, channel)) || [];
  }

  clearAll() {
    this.history.clear();
    this.emit();
  }

  /** Client list changed: drop history of clients that no longer exist. */
  clientsChanged() {
    const n = this.cfg.clients.length;
    for (const k of [...this.history.keys()]) if (Number(k.split("|")[0]) >= n) this.history.delete(k);
    this.seen.clear(); // the engine re-reports channels when it restarts
    if (this.currentClient >= n) this.currentClient = 0;
    this.emit();
  }

  backendText(): string {
    const b = this.backend;
    if (b === "gtx") return this.t("backend_gtx");
    if (b === "mymemory") return this.t("backend_mymemory");
    if (b === "fallback") return this.t("backend_fallback");
    return this.t("backend_unknown");
  }

  // ---------------- sounds ----------------
  channelSoundId(channel: string): string {
    return this.cfg.channel_sounds?.[channel] || this.cfg.sound || "beep";
  }

  play(soundId: string) {
    // a custom sound file wins over the built-in collection
    const url = this.customSoundUrl || this.init.soundUrls[soundId] || this.init.soundUrls.beep;
    if (!url) return;
    let a = this.audioCache.get(url);
    if (!a) {
      a = new Audio(url);
      this.audioCache.set(url, a);
    }
    const inst = a.paused ? a : (a.cloneNode(true) as HTMLAudioElement);
    inst.currentTime = 0;
    inst.play().catch((e) => void api().log(`sound: ${e}`));
  }

  // ---------------- incoming messages ----------------
  onMessage(m: ChatMessage) {
    const k = key(m.clientIdx, m.channel);
    const list = this.history.get(k) || [];
    this.addChannels(m.clientIdx, [m.channel]);
    list.push({
      id: m.id,
      sub: m.sub,
      time: m.time,
      name: m.name,
      original: m.original,
      translated: m.translated,
      src: m.srcLang,
      mention: this.isMention(m),
    });
    if (list.length > HISTORY_MAX) list.splice(0, list.length - HISTORY_MAX);
    this.history.set(k, list);
    this.count++;
    if (this.running) this.status = this.t("status_running", { n: this.count, backend: this.backendText() });

    const visible = this.isVisible(m.clientIdx, m.channel);
    if (!visible) {
      this.unread.add(k);
      if (m.clientIdx !== this.currentClient) this.unreadClients.add(m.clientIdx);
    }

    let alertSounded = false;
    let noted = false;
    const fired = this.matcher.match(this.cfg.alerts, m.channel, m.original, m.translated);
    if (fired.length) {
      const note = firedNote(fired);
      const rec: AlertRecord = {
        at: new Date().toTimeString().slice(0, 8),
        client: m.clientIdx,
        channel: m.channel,
        text: note || (m.translated || m.original).slice(0, 180),
      };
      // always logged, even with sound/notification off — a red tab is easy to miss
      this.alertLog.push(rec);
      if (this.alertLog.length > 200) this.alertLog.shift();
      if (!visible) {
        this.alerted.add(k);
        if (m.clientIdx !== this.currentClient) this.alertedClients.add(m.clientIdx);
      }
      // Alerts override the per-channel ♪/✉ toggles: they always sound/notify when ticked.
      let showPopup = false;
      if (fired.some((r) => r.sound)) {
        alertSounded = true;
        this.play(ruleSoundId(fired, this.channelSoundId(m.channel)));
        showPopup = true;
      }
      if (fired.some((r) => r.notify)) {
        void api().notify(`${this.t("alert_toast_title")} — ${this.placeLabel(m.clientIdx, m.channel)}`, rec.text, {
          clientIdx: m.clientIdx,
          channel: m.channel,
        });
        showPopup = true;
        noted = true; // no second, ordinary notification for the same message
      }
      if (showPopup) {
        const head = this.cfg.clients.length > 1 ? `${rec.at} · ${this.clientLabel(rec.client)} · ${rec.channel}` : `${rec.at} · ${rec.channel}`;
        void api().showLastAlert(rec, head);
      }
    }
    if (channelFlag(this.cfg.sound_channels, m.channel) && !alertSounded) this.play(this.channelSoundId(m.channel));
    if (!noted && channelFlag(this.cfg.notify_channels, m.channel)) {
      void api().notify(`Wurm — ${this.placeLabel(m.clientIdx, m.channel)}`, (m.translated || m.original).slice(0, 180), {
        clientIdx: m.clientIdx,
        channel: m.channel,
      });
    }
    this.emit();
  }

  /** Message mentions this client's character (not their own message). */
  private isMention(m: ChatMessage): boolean {
    if (!this.cfg.highlight_mentions || !m.name) return false;
    const c = this.cfg.clients[m.clientIdx];
    if (!c) return false;
    const names = [c.name, characterFromLogsPath(c.path)].map((s) => (s || "").trim()).filter(Boolean);
    const sender = m.name.trim().toLowerCase();
    if (names.some((n) => n.toLowerCase() === sender)) return false;
    return names.some((n) => mentionedIn(m.original, n) || mentionedIn(m.translated, n));
  }
}

export function key(idx: number, channel: string) {
  return `${idx}|${channel}`;
}

export const store = new Store();

/** Re-render the calling component whenever the store changes. */
export function useStore(): Store {
  const [, setV] = useState(0);
  useEffect(() => {
    const un = store.subscribe(() => setV(store.version));
    return () => {
      un();
    };
  }, []);
  return store;
}
