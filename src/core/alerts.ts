/**
 * Alerts: react to a substring appearing in a channel (sound, notification,
 * red tab, alert log, "last alert" popup). Plus per-channel sound/notify flags
 * and player-name mention detection.
 */
import { escapeRe } from "./util";

export const BUILTIN_SOUNDS = ["beep", "chime", "bell", "ding", "pop", "alarm"] as const;
export type SoundId = (typeof BUILTIN_SOUNDS)[number];

export const ALERT_THROTTLE_MS = 10_000;

export interface AlertRule {
  /** Stable id (used for throttling); assigned on load if missing. */
  id?: string;
  /** Watched channels; empty = any channel. */
  channels?: string[];
  /** Legacy format (< v1.7.4): a single channel name. */
  channel?: string;
  pattern?: string;
  /** Custom notification text shown instead of the message text. */
  note?: string;
  enabled?: boolean;
  sound?: boolean;
  /** Own sound from the built-in collection; absent = channel's sound. */
  sound_id?: string;
  notify?: boolean;
}

/** Channels of a rule: [] = any. Understands the new ("channels": list) and old ("channel": str) formats. */
export function ruleChannels(rule: AlertRule): string[] {
  if (Array.isArray(rule.channels)) return rule.channels.map(String).filter((c) => c.trim());
  const ch = String(rule.channel ?? "").trim();
  return ch ? [ch] : [];
}

let idCounter = 0;
export function newRuleId(): string {
  idCounter += 1;
  return `r${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Give every rule an id (throttling key). Returns true when something changed. */
export function ensureRuleIds(rules: AlertRule[]): boolean {
  let changed = false;
  for (const r of rules) {
    if (!r.id) {
      r.id = newRuleId();
      changed = true;
    }
  }
  return changed;
}

export class AlertMatcher {
  private lastFired = new Map<string, number>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Rules that fire on a message. Channel list empty = any channel; the
   * substring is searched in the original and the translation, case-insensitive.
   * Throttled per rule and channel: at most once per ALERT_THROTTLE_MS.
   */
  match(rules: AlertRule[] | null | undefined, channel: string, original: string | null, translated: string | null): AlertRule[] {
    const fired: AlertRule[] = [];
    const hay = [(original || "").toLowerCase(), (translated || "").toLowerCase()];
    const now = this.now();
    (rules || []).forEach((rule, idx) => {
      if (!rule || typeof rule !== "object" || rule.enabled === false) return;
      const chans = ruleChannels(rule);
      if (chans.length && !chans.includes(channel)) return;
      const pattern = String(rule.pattern ?? "").trim().toLowerCase();
      if (!pattern) return;
      if (!hay.some((h) => h.includes(pattern))) return;
      const key = `${rule.id ?? `#${idx}`}|${channel}`;
      if (now - (this.lastFired.get(key) ?? -Infinity) < ALERT_THROTTLE_MS) return;
      this.lastFired.set(key, now);
      fired.push(rule);
    });
    if (this.lastFired.size > 200) {
      for (const [k, t] of this.lastFired) if (now - t > ALERT_THROTTLE_MS) this.lastFired.delete(k);
    }
    return fired;
  }

  reset() {
    this.lastFired.clear();
  }
}

/** First non-empty custom notification text of the fired rules. */
export function firedNote(fired: AlertRule[]): string {
  for (const r of fired) {
    const n = String(r.note ?? "").trim();
    if (n) return n;
  }
  return "";
}

/**
 * Sound for fired rules: the first rule with its own built-in sound wins over
 * the channel sound; rules without a choice use the channel sound.
 */
export function ruleSoundId(fired: AlertRule[], channelSound: string): string {
  for (const r of fired) {
    if (r.sound && r.sound_id && (BUILTIN_SOUNDS as readonly string[]).includes(r.sound_id)) return r.sound_id;
  }
  return channelSound;
}

/** Is the channel enabled for sound/notifications? Missing list = nothing enabled (quiet by default). */
export function channelFlag(list: string[] | null | undefined, channel: string): boolean {
  return !!list && list.includes(channel);
}

/** Add/remove a channel in a per-channel list (any channel name — channels are discovered at run time). */
export function setChannelFlag(list: string[] | null | undefined, channel: string, on: boolean): string[] {
  const cur = (list || []).filter((c) => typeof c === "string" && c);
  if (on && !cur.includes(channel)) cur.push(channel);
  if (!on) return cur.filter((c) => c !== channel);
  return cur;
}

/** Is the player's name mentioned in the text? Whole word, case-insensitive. */
export function mentionedIn(text: string | null | undefined, playerName: string | null | undefined): boolean {
  const p = (playerName || "").trim();
  if (!p || !text) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(p)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}
