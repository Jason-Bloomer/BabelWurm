/**
 * Log watcher: polls one client's logs folder and emits new lines from ANY file
 * in it — every chat the game opens (German GL, GL-Pandemonium, HOTS, a new PM…)
 * is picked up without configuration.
 *
 * - Files that already exist at start are skipped to the end (old history is
 *   not dumped). Files that appear later (a new chat, the next month's or
 *   day's log) are read from the beginning.
 * - Only complete lines (ending in \n) are emitted; a partially flushed tail
 *   is kept until the next pass. Bytes are buffered, so a multi-byte UTF-8
 *   character split across two writes is never corrupted.
 * - Hot/cold polling: a file that changed recently is checked every pass; a
 *   file untouched for COLD_AFTER_MS is checked only every COLD_CHECK_MS, so a
 *   folder with years of logs costs almost nothing. New files are found by
 *   listing the folder every pass.
 * - A truncated/rewritten file is read again from the start; binary files
 *   (NUL bytes) are ignored.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { channelFromFileName, isCurrentPeriod } from "./channels";

export interface RawLine {
  clientIdx: number;
  channel: string;
  line: string;
  /** PM conversation partner (from PM__<Name>.….txt). */
  sub?: string;
}

interface FileState {
  channel: string;
  sub?: string;
  offset: number;
  pending: Buffer;
  mtimeMs: number;
  lastChange: number;
  lastCheck: number;
  binary: boolean;
}

export const COLD_AFTER_MS = 10 * 60 * 1000;
export const COLD_CHECK_MS = 15 * 1000;
/** Channels with a file modified within this window are shown as tabs at start. */
export const RECENT_CHANNEL_MS = 31 * 24 * 3600 * 1000;
/** Don't dump megabytes from a newly appeared (or rewritten) file. */
const MAX_INITIAL_READ = 256 * 1024;
const RE_LOGGING_STARTED = /^Logging started\b/i;

export class LogWatcher {
  private files = new Map<string, FileState>();
  private channels = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private scanning = false;
  /** Last time a scan completed — the supervisor restarts a stalled watcher. */
  lastTick = Date.now();

  constructor(
    readonly logsDir: string,
    readonly clientIdx: number,
    private readonly emit: (l: RawLine) => void,
    private readonly onError: (e: unknown) => void = () => {},
    private readonly pollMs = 500,
    private readonly now: () => number = () => Date.now(),
    /** New channel seen (a file appeared) — the UI adds a tab. */
    private readonly onChannel: (channel: string) => void = () => {},
  ) {}

  private list(): string[] {
    try {
      return fs
        .readdirSync(this.logsDir, { withFileTypes: true })
        .filter((d) => d.isFile() || d.isSymbolicLink())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  /**
   * Position every existing file at its end. Returns the channels worth a tab
   * right away: files of the current month/day or modified recently.
   */
  start(startAtEnd = true): string[] {
    this.stopped = false;
    const initial = new Set<string>();
    const now = this.now();
    for (const name of this.list()) {
      const fc = channelFromFileName(name);
      if (!fc) continue;
      const p = path.join(this.logsDir, name);
      try {
        const st = fs.statSync(p);
        this.files.set(p, {
          channel: fc.channel,
          sub: fc.sub,
          offset: startAtEnd ? st.size : 0,
          pending: Buffer.alloc(0),
          mtimeMs: startAtEnd ? st.mtimeMs : -1,
          lastChange: st.mtimeMs,
          lastCheck: now,
          binary: false,
        });
        this.channels.add(fc.channel);
        if (now - st.mtimeMs < RECENT_CHANNEL_MS || (fc.period && isCurrentPeriod(fc.period, new Date(now)))) initial.add(fc.channel);
      } catch {
        /* ignore */
      }
    }
    this.lastTick = Date.now();
    this.schedule();
    return [...initial];
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return !this.stopped;
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.pollMs);
  }

  private async tick() {
    if (this.stopped) return;
    if (!this.scanning) {
      this.scanning = true;
      try {
        await this.scanOnce();
      } catch (e) {
        this.onError(e);
      } finally {
        this.scanning = false;
        this.lastTick = Date.now();
      }
    }
    this.schedule();
  }

  async scanOnce(): Promise<void> {
    const now = this.now();
    const present = new Set<string>();
    for (const name of this.list()) {
      const fc = channelFromFileName(name);
      if (!fc) continue;
      const p = path.join(this.logsDir, name);
      present.add(p);
      let state = this.files.get(p);
      if (!state) {
        // a file that appeared while running (new chat, next month/day) — read from the start
        state = { channel: fc.channel, sub: fc.sub, offset: 0, pending: Buffer.alloc(0), mtimeMs: -1, lastChange: now, lastCheck: 0, binary: false };
        this.files.set(p, state);
        if (!this.channels.has(fc.channel)) {
          this.channels.add(fc.channel);
          this.onChannel(fc.channel);
        }
      }
      if (state.binary) continue;
      const cold = now - state.lastChange > COLD_AFTER_MS;
      if (cold && now - state.lastCheck < COLD_CHECK_MS) continue;
      state.lastCheck = now;
      await this.readFile(p, state, now);
    }
    // forget deleted files (a re-created file is then read from the start)
    for (const p of [...this.files.keys()]) if (!present.has(p)) this.files.delete(p);
  }

  private async readFile(p: string, state: FileState, now: number) {
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(p);
    } catch {
      return;
    }
    if (st.size < state.offset) {
      state.offset = 0; // file was rewritten
      state.pending = Buffer.alloc(0);
    }
    if (state.mtimeMs === st.mtimeMs && st.size === state.offset) return; // unchanged
    if (st.size - state.offset > MAX_INITIAL_READ && state.offset === 0) state.offset = st.size - MAX_INITIAL_READ;
    let chunk: Buffer = Buffer.alloc(0);
    if (st.size > state.offset) {
      try {
        const fh = await fs.promises.open(p, "r");
        try {
          const len = st.size - state.offset;
          chunk = Buffer.alloc(len);
          const { bytesRead } = await fh.read(chunk, 0, len, state.offset);
          chunk = chunk.subarray(0, bytesRead);
          state.offset += bytesRead;
        } finally {
          await fh.close();
        }
      } catch {
        return;
      }
    }
    state.mtimeMs = st.mtimeMs;
    state.lastChange = now;
    if (chunk.includes(0)) {
      state.binary = true; // not a text log
      return;
    }
    const buf = state.pending.length ? Buffer.concat([state.pending, chunk]) : chunk;
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) {
      state.pending = Buffer.from(buf);
      return;
    }
    state.pending = Buffer.from(buf.subarray(lastNl + 1));
    const text = buf.subarray(0, lastNl).toString("utf-8").replace(/^﻿/, "");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      // "Logging started 2026-11-04" is written to every log at each game start — housekeeping, not content
      if (line && !RE_LOGGING_STARTED.test(line)) this.emit({ clientIdx: this.clientIdx, channel: state.channel, line, sub: state.sub });
    }
  }
}
