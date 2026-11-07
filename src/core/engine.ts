/**
 * Engine: one LogWatcher per client feeding a single translation queue, plus a
 * supervisor that restarts a stalled watcher or translation loop.
 * Independent of Electron — the console mode uses it too.
 */
import * as fs from "node:fs";
import { parseChatLine, stripLogPrefix } from "./channels";
import type { ClientCfg } from "./config";
import { keepAsIs, type MessageOptions, type Pipeline } from "./pipeline";
import { LogWatcher, type RawLine } from "./watcher";

export interface ChatMessage {
  id: number;
  clientIdx: number;
  channel: string;
  /** PM conversation partner. */
  sub?: string;
  time: string;
  name: string | null;
  original: string;
  /** null = not translated (translation off or failed). */
  translated: string | null;
  srcLang: string | null;
}

export type EngineEvent =
  | { type: "channels"; clientIdx: number; channels: string[] }
  | { type: "watcher_restarted" }
  | { type: "worker_restarted" }
  | { type: "error"; message: string };

const STALL_MS = 15_000;
/** Translation backlog limit: beyond it the oldest lines are shown untranslated instead of lagging behind. */
export const QUEUE_MAX = 300;

export interface EngineOptions extends MessageOptions {
  /** Channels shown as written, never sent for translation (e.g. Combat). */
  noTranslate: string[];
}

export class Engine {
  private watchers: LogWatcher[] = [];
  private queue: RawLine[] = [];
  private wake: (() => void) | null = null;
  private running = false;
  private loopGen = 0;
  private loopTick = Date.now();
  private busySince = 0;
  private supervisor: NodeJS.Timeout | null = null;
  private nextId = 1;
  private clients: ClientCfg[] = [];
  count = 0;

  constructor(
    private readonly pipeline: Pipeline,
    private readonly options: () => EngineOptions,
    private readonly onMessage: (m: ChatMessage) => void,
    private readonly onEvent: (e: EngineEvent) => void = () => {},
    private readonly log: (m: string) => void = () => {},
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Returns null when started, otherwise the problem: "no_clients" or the unavailable path. */
  start(clients: ClientCfg[]): { error: "no_clients" } | { error: "bad_path"; path: string } | null {
    this.stop();
    if (!clients.length) return { error: "no_clients" };
    const bad = clients.find((c) => !c.path || !isDir(c.path));
    if (bad) return { error: "bad_path", path: bad.path };
    this.clients = clients.map((c) => ({ ...c }));
    this.running = true;
    this.count = 0;
    this.watchers = this.clients.map((c, i) => this.makeWatcher(c.path, i));
    this.watchers.forEach((w, i) => {
      const channels = w.start(true);
      this.onEvent({ type: "channels", clientIdx: i, channels });
    });
    this.startLoop();
    this.supervisor = setInterval(() => this.supervise(), 2000);
    this.log(`start: clients=${JSON.stringify(this.clients)} target=${this.options().targetLang} translate=${this.options().translate}`);
    return null;
  }

  stop(): void {
    if (!this.running && !this.watchers.length) return;
    this.running = false;
    for (const w of this.watchers) w.stop();
    this.watchers = [];
    this.queue = [];
    this.loopGen++;
    this.wake?.();
    if (this.supervisor) clearInterval(this.supervisor);
    this.supervisor = null;
    this.log("stop");
  }

  private makeWatcher(dir: string, idx: number): LogWatcher {
    return new LogWatcher(
      dir,
      idx,
      (l) => this.enqueue(l),
      (e) => {
        this.log(`watcher: scan error: ${e}`);
        this.onEvent({ type: "error", message: `watcher: ${e}` });
      },
      500,
      () => Date.now(),
      (ch) => {
        this.log(`new channel in client ${idx}: ${ch}`);
        this.onEvent({ type: "channels", clientIdx: idx, channels: [ch] });
      },
    );
  }

  /** Feed a raw line directly (tests, console mode). */
  enqueue(l: RawLine): void {
    if (!this.running) return;
    const opts = this.options();
    const parsed = parseChatLine(l.line);
    // Fast lane: lines that won't be translated are shown at once instead of
    // waiting behind the translation pacing (busy logs like Combat).
    if (!opts.translate) return this.emitNow(l, null);
    if (!parsed || opts.noTranslate.includes(l.channel) || keepAsIs(l.channel, opts)) return this.emitNow(l, "as-is");
    this.queue.push(l);
    if (this.queue.length > QUEUE_MAX) {
      const old = this.queue.shift()!;
      if (!this.overflowLogged) {
        this.log(`translator: backlog over ${QUEUE_MAX}, oldest lines shown untranslated`);
        this.overflowLogged = true;
      }
      this.emitNow(old, null);
    }
    this.wake?.();
  }

  private overflowLogged = false;

  private emitNow(l: RawLine, mode: "as-is" | null) {
    const parsed = parseChatLine(l.line);
    const body = parsed?.text ?? stripLogPrefix(l.line);
    if (!body) return;
    this.count++;
    this.onMessage({
      id: this.nextId++,
      clientIdx: l.clientIdx,
      channel: l.channel,
      sub: l.sub,
      time: parsed?.time ?? "",
      name: parsed?.name ?? null,
      original: body,
      translated: mode === "as-is" ? body : null,
      srcLang: null,
    });
  }

  private startLoop() {
    const gen = ++this.loopGen;
    this.loopTick = Date.now();
    void this.loop(gen);
  }

  private async loop(gen: number) {
    this.log("translator: loop started");
    while (this.running && gen === this.loopGen) {
      this.loopTick = Date.now();
      const item = this.queue.shift();
      if (!item) {
        await new Promise<void>((r) => {
          this.wake = r;
          setTimeout(r, 1000);
        });
        this.wake = null;
        continue;
      }
      this.busySince = Date.now();
      try {
        await this.process(item, gen);
      } catch (e) {
        // any unexpected error — log it, the loop keeps going
        this.log(`translator: unexpected error: ${e instanceof Error ? e.stack : e}`);
      }
      this.busySince = 0;
    }
    this.log("translator: loop stopped");
  }

  private async process(item: RawLine, gen: number) {
    const parsed = parseChatLine(item.line);
    const time = parsed?.time ?? "";
    const name = parsed?.name ?? null;
    const body = parsed?.text ?? stripLogPrefix(item.line);
    if (!body) return; // empty lines like "[17:33:11] "
    const res = await this.pipeline.translateMessage(body, item.channel, this.options());
    if (gen !== this.loopGen) return; // stopped/restarted meanwhile
    this.count++;
    this.onMessage({
      id: this.nextId++,
      clientIdx: item.clientIdx,
      channel: item.channel,
      sub: item.sub,
      time,
      name,
      original: body,
      translated: res.translated,
      srcLang: res.srcLang,
    });
  }

  /** Restart background work that stalled or died. */
  private supervise() {
    if (!this.running) return;
    const now = Date.now();
    this.watchers.forEach((w, i) => {
      if (now - w.lastTick > STALL_MS) {
        this.log(`supervisor: watcher of client ${i} stalled — restarting`);
        w.stop();
        const nw = this.makeWatcher(this.clients[i].path, i);
        this.onEvent({ type: "channels", clientIdx: i, channels: nw.start(true) });
        this.watchers[i] = nw;
        this.onEvent({ type: "watcher_restarted" });
      }
    });
    // a single translation may legitimately take a while (timeouts + fallback); 60 s means it hung
    const hung = this.busySince && now - this.busySince > 60_000;
    if (hung || (!this.busySince && now - this.loopTick > STALL_MS)) {
      this.log("supervisor: translator loop stalled — restarting");
      this.busySince = 0;
      this.startLoop();
      this.onEvent({ type: "worker_restarted" });
    }
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
