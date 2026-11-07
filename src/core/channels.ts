/**
 * Chat channels and log-file naming in the Wurm Online log folder.
 *
 * Every file in a client's logs folder is a channel. The channel name comes
 * from the file name, with the rotation date (monthly or daily) stripped:
 *
 *   _Local.2026-10.txt        -> "Local"        (leading "_" = game-generated log)
 *   _Event.2026-10-05.txt     -> "Event"        (daily rotation)
 *   German_GL.2026-10.txt     -> "German GL"    ("_" -> space)
 *   Non-English_GL.2026-10.txt-> "Non-English GL"
 *   GL-Pandemonium.2018-10.txt-> "GL-Pandemonium"
 *   HOTS.2019-01.txt          -> "HOTS"
 *   CA_HELP.2026-10.txt       -> "CA Help"      (known names keep their old spelling)
 *   PM__Friend.2026-10.txt    -> "PM", partner "Friend" (all PMs share one tab)
 *   _Skills.txt               -> "Skills"       (no rotation)
 *
 * New channels are discovered while running: when the game opens a new chat
 * (and creates its log file), a tab appears.
 */

export interface ChannelDef {
  /** Tab name shown in the UI and used as the channel id in config. */
  name: string;
  /** File name prefix in the logs folder. */
  prefix: string;
  /** PM channel: many files `PM__<Name>.<YYYY-MM>.txt`. */
  isPm: boolean;
}

/** The standard Wurm chats, in tab order. Any other log file becomes a channel too. */
export const CHANNELS: readonly ChannelDef[] = [
  { name: "Local", prefix: "_Local", isPm: false },
  { name: "Village", prefix: "Village", isPm: false },
  { name: "Alliance", prefix: "Alliance", isPm: false },
  { name: "Trade", prefix: "Trade", isPm: false },
  { name: "Freedom", prefix: "Freedom", isPm: false },
  { name: "GL-Freedom", prefix: "GL-Freedom", isPm: false },
  { name: "Russian GL", prefix: "Russian_GL", isPm: false },
  { name: "CA Help", prefix: "CA_HELP", isPm: false },
  { name: "Event", prefix: "_Event", isPm: false },
  { name: "PM", prefix: "PM__", isPm: true },
];

export const CHANNEL_NAMES: readonly string[] = CHANNELS.map((c) => c.name);

/** Game-generated English system logs that are not translated by default (very busy, nothing to translate). */
export const DEFAULT_NO_TRANSLATE = ["Combat", "Skills"];

/** Other game-generated logs (sorted after the chats). */
export const SYSTEM_LOGS = ["Combat", "Skills", "Friends", "Support", "Team", "Debug", "Achievements", "Deaths"];

const RE_FILE = /^(.+?)(?:\.(\d{4}-\d{2}(?:-\d{2})?))?(?:\.(txt|log))$/i;
const RE_ANY = /^([^.].*?)(?:\.[A-Za-z0-9]{1,5})?$/;
const KNOWN_BY_STEM = new Map(CHANNELS.filter((c) => !c.isPm).map((c) => [c.prefix.toLowerCase(), c.name]));

export interface FileChannel {
  channel: string;
  /** PM conversation partner. */
  sub?: string;
  /** Rotation stamp from the file name ("2026-10" / "2026-10-05"), if any. */
  period?: string;
}

/** Channel of a log file name, or null for files that are not logs. */
export function channelFromFileName(fileName: string): FileChannel | null {
  // Wurm writes .txt logs; any other (non-hidden) file is shown under its own name
  const m = RE_FILE.exec(fileName) || RE_ANY.exec(fileName);
  if (!m) return null;
  const stem = m[1];
  const period = m[2];
  if (/^PM__/i.test(stem)) return { channel: "PM", sub: stem.slice(4) || undefined, period };
  const known = KNOWN_BY_STEM.get(stem.toLowerCase());
  if (known) return { channel: known, period };
  const name = stem.replace(/^_+/, "").replace(/_+/g, " ").trim();
  return name ? { channel: name, period } : null;
}

/** Does the rotation stamp belong to the current month/day (or is there none)? */
export function isCurrentPeriod(period: string | undefined, now: Date = new Date()): boolean {
  if (!period) return true;
  const month = monthStamp(now);
  if (period.length === 7) return period === month;
  return period === `${month}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Tab order: the standard chats first, kingdom chats, global chats, language chats, then the rest. */
export function channelRank(name: string): [number, string] {
  const known = CHANNEL_NAMES.indexOf(name);
  const order: Record<string, number> = { Local: 0, Village: 1, Alliance: 2, Trade: 3 };
  if (name in order) return [order[name], name];
  if (name === "PM") return [90, name];
  if (name === "Event") return [91, name];
  if (SYSTEM_LOGS.includes(name)) return [95, name];
  if (/^GL-/i.test(name)) return [20, name.toLowerCase()];
  if (isLanguageChannel(name) || /\bGL$/i.test(name)) return [30, name.toLowerCase()];
  if (name === "CA Help") return [40, name];
  if (known >= 0) return [10, name.toLowerCase()];
  // anything else that looks like a kingdom chat (single word, e.g. HOTS) sits with the kingdoms
  if (/^[A-Za-z][\w-]*$/.test(name) && !/\s/.test(name)) return [10, name.toLowerCase()];
  return [50, name.toLowerCase()];
}

export function sortChannels(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => {
    const [ra, ka] = channelRank(a);
    const [rb, kb] = channelRank(b);
    return ra - rb || ka.localeCompare(kb);
  });
}

/** Language chats ("Russian GL", "German GL", …) and the language they are held in. */
const LANG_CHANNEL_CODES: Record<string, string> = {
  russian: "ru",
  english: "en",
  german: "de",
  french: "fr",
  spanish: "es",
  portuguese: "pt",
  chinese: "zh",
  polish: "pl",
  italian: "it",
  dutch: "nl",
  turkish: "tr",
  japanese: "ja",
  korean: "ko",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  czech: "cs",
  hungarian: "hu",
  romanian: "ro",
  ukrainian: "uk",
};

export const RE_LANG_CHANNEL = new RegExp(`^(${Object.keys(LANG_CHANNEL_CODES).join("|")})\\s+GL$`, "i");

export function isLanguageChannel(channel: string | null | undefined): boolean {
  return RE_LANG_CHANNEL.test(channel || "");
}

/** Language code of a language chat ("German GL" -> "de"), else null. "Non-English GL" is mixed: null. */
export function languageOfChannel(channel: string | null | undefined): string | null {
  const m = RE_LANG_CHANNEL.exec(channel || "");
  return m ? LANG_CHANNEL_CODES[m[1].toLowerCase()] : null;
}

// Real Wurm Online log formats:
//   [19:13:45] <Valerius> guards!              — regular channels and PMs
//   [2026-10-10 17:02:17] <Liel> text           — with date prefix
//   [21:42:03] PlayerOne: hello                — "name: text" style
//   [17:38:41] Valerius has reached 30 ... !   — system lines without a name
const RE_NAME = /^\[(?:\d{4}-\d{2}-\d{2} )?(\d{2}:\d{2}:\d{2})\]\s*<([^<>\r\n]+)>\s*(.*\S)\s*$/;
const RE_COLON = /^\[(?:\d{4}-\d{2}-\d{2} )?(\d{2}:\d{2}:\d{2})\]\s*([^\s:\[\]]{2,30}):\s*(.*\S)\s*$/;
const RE_SYS = /^\[(?:\d{4}-\d{2}-\d{2} )?(\d{2}:\d{2}:\d{2})\]\s*(.+?\S)\s*$/;
const RE_PREFIX = /^\[(?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}\]\s*/;

export interface ParsedLine {
  time: string;
  name: string | null;
  text: string;
}

/**
 * "[19:13:45] <Valerius> text" -> {time, name, text}.
 * Lines without a <name> -> name = null (system messages).
 * Not a chat line (empty, "Logging started …") -> null.
 */
export function parseChatLine(line: string): ParsedLine | null {
  let m = RE_NAME.exec(line);
  if (m) return { time: m[1], name: m[2], text: m[3] };
  m = RE_COLON.exec(line);
  if (m) return { time: m[1], name: m[2], text: m[3] };
  m = RE_SYS.exec(line);
  if (m) return { time: m[1], name: null, text: m[2] };
  return null;
}

export function stripLogPrefix(line: string): string {
  return line.replace(RE_PREFIX, "").trim();
}

/** "2026-10" for the given date (log files are rotated monthly). */
export function monthStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Character name from a logs path: …/players/<Name>/logs -> <Name>. */
export function characterFromLogsPath(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const parts = norm.split(/[\\/]/);
  if (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === "logs") return parts[parts.length - 2];
  return "";
}
