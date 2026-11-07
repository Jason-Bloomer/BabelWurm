/**
 * Finding Wurm Online log folders (Steam and the standalone client from
 * wurmonline.com) on Windows, macOS and Linux, plus Steam persona name and
 * Steam UI language.
 *
 * Used only on explicit request ("Find all" in the Clients dialog): a path the
 * user entered is never replaced automatically.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface FoundClient {
  name: string;
  path: string;
}

const HOME = os.homedir();
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/** Read a value from the Windows registry (HKCU\Software\Valve\Steam). */
export function regQuery(key: string, value: string): Promise<string | null> {
  if (!IS_WIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("reg", ["query", key, "/v", value], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.*)`, "i").exec(stdout);
      resolve(m ? m[1].trim() : null);
    });
  });
}

/** Candidate Steam installation folders for this OS. */
export async function steamRoots(): Promise<string[]> {
  const out: string[] = [];
  if (IS_WIN) {
    const reg = await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath");
    if (reg) out.push(path.normalize(reg));
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    out.push(path.join(pf86, "Steam"), path.join(pf, "Steam"), "C:\\Steam", "D:\\Steam", "E:\\Steam");
  } else if (IS_MAC) {
    out.push(path.join(HOME, "Library", "Application Support", "Steam"));
  } else {
    out.push(
      path.join(HOME, ".steam", "steam"),
      path.join(HOME, ".steam", "root"),
      path.join(HOME, ".local", "share", "Steam"),
      path.join(HOME, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
      path.join(HOME, "snap", "steam", "common", ".local", "share", "Steam"),
    );
  }
  return dedupe(out.filter(isDir));
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    let key = p;
    try {
      key = fs.realpathSync(p);
    } catch {
      /* keep */
    }
    key = IS_WIN || IS_MAC ? key.toLowerCase() : key;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Steam library folders from libraryfolders.vdf (games can live on other drives). */
export function steamLibraries(steamRoot: string): string[] {
  const libs = [steamRoot];
  for (const rel of [["steamapps", "libraryfolders.vdf"], ["config", "libraryfolders.vdf"]]) {
    const text = readText(path.join(steamRoot, ...rel));
    if (!text) continue;
    const re = /"path"\s+"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) libs.push(m[1].replace(/\\\\/g, "\\"));
  }
  return libs;
}

/** All "players" folders where Wurm keeps per-character logs. Order = search priority. */
export async function wurmPlayersRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const steam of await steamRoots()) {
    for (const lib of steamLibraries(steam)) {
      roots.push(path.join(lib, "steamapps", "common", "Wurm Online", "gamedata", "players"));
    }
  }
  if (IS_WIN) {
    for (const drive of ["E:", "D:", "C:"]) {
      roots.push(path.join(`${drive}\\`, "SteamLibrary", "steamapps", "common", "Wurm Online", "gamedata", "players"));
    }
  }
  // standalone client (installer from wurmonline.com): data in the user profile
  roots.push(path.join(HOME, "wurm", "players"), path.join(HOME, "Wurm", "players"), path.join(HOME, "Wurm Online", "players"));
  if (IS_WIN) {
    roots.push("C:\\Program Files (x86)\\Wurm Online\\wurm\\players", "C:\\Program Files\\Wurm Online\\wurm\\players");
  }
  return dedupe(roots.filter(isDir));
}

/**
 * PersonaName of the current Steam user from config/loginusers.vdf.
 * The account with MostRecent=1 wins; otherwise the last one in the file.
 */
export async function steamPersonaName(): Promise<string | null> {
  for (const root of await steamRoots()) {
    const text = readText(path.join(root, "config", "loginusers.vdf"));
    if (!text) continue;
    let recent: string | null = null;
    let last: string | null = null;
    for (const block of text.match(/\{[^{}]*\}/g) || []) {
      const pm = /"PersonaName"\s+"([^"]+)"/.exec(block);
      if (!pm || !pm[1].trim()) continue;
      last = pm[1].trim();
      if (/"MostRecent"\s+"1"/.test(block)) recent = last;
    }
    if (recent || last) return recent || last;
  }
  return null;
}

/** Steam client UI language ("russian", "english", …) or null. */
export async function steamLanguage(): Promise<string | null> {
  if (IS_WIN) {
    const v = await regQuery("HKCU\\Software\\Valve\\Steam", "Language");
    return v ? v.trim().toLowerCase() : null;
  }
  const candidates = IS_MAC
    ? [path.join(HOME, "Library", "Application Support", "Steam", "registry.vdf")]
    : [path.join(HOME, ".steam", "registry.vdf"), path.join(HOME, ".var", "app", "com.valvesoftware.Steam", ".steam", "registry.vdf")];
  for (const c of candidates) {
    const text = readText(c);
    const m = text && /"language"\s+"([^"]+)"/i.exec(text);
    if (m) return m[1].trim().toLowerCase();
  }
  return null;
}

/** Steam language name -> translation language code. */
export const STEAM_LANG_MAP: Record<string, string> = {
  english: "en",
  russian: "ru",
  german: "de",
  french: "fr",
  spanish: "es",
  latam: "es",
  portuguese: "pt",
  brazilian: "pt",
  schinese: "zh",
  tchinese: "zh-TW",
  japanese: "ja",
  koreana: "ko",
  polish: "pl",
  italian: "it",
  turkish: "tr",
  ukrainian: "uk",
  dutch: "nl",
  swedish: "sv",
  danish: "da",
  finnish: "fi",
  norwegian: "no",
  czech: "cs",
  hungarian: "hu",
  romanian: "ro",
  bulgarian: "bg",
  greek: "el",
  thai: "th",
  vietnamese: "vi",
  indonesian: "id",
  arabic: "ar",
};

function lastActivity(logs: string): number {
  try {
    let best = -1;
    for (const f of fs.readdirSync(logs)) {
      try {
        best = Math.max(best, fs.statSync(path.join(logs, f)).mtimeMs);
      } catch {
        /* skip */
      }
    }
    return best;
  } catch {
    return -1;
  }
}

/**
 * The single most likely log folder: the character matching the Steam persona
 * name, else the character with the most recent log activity.
 */
export async function autoLogsDir(): Promise<string> {
  const persona = (await steamPersonaName())?.toLowerCase() || null;
  for (const root of await wurmPlayersRoots()) {
    let subs: string[] = [];
    try {
      subs = fs.readdirSync(root).map((d) => path.join(root, d)).filter(isDir);
    } catch {
      continue;
    }
    const logsOf = (d: string) => (isDir(path.join(d, "logs")) ? path.join(d, "logs") : null);
    if (persona) {
      for (const d of subs) if (path.basename(d).toLowerCase() === persona && logsOf(d)) return logsOf(d)!;
    }
    let best: string | null = null;
    let bestT = -2;
    for (const d of subs) {
      const l = logsOf(d);
      if (!l) continue;
      const t = lastActivity(l);
      if (t > bestT) {
        best = l;
        bestT = t;
      }
    }
    if (best) return best;
  }
  return "";
}

/**
 * Every log folder of every client (Steam + standalone + any other root), for
 * multi-boxing. Name = character, with the client kind in brackets when the
 * same character exists in several clients. The Steam persona's character
 * comes first.
 */
export async function findAllLogsDirs(kindSteam: string, kindSite: string): Promise<FoundClient[]> {
  const candidates: Array<{ char: string; kind: string; logs: string; t: number }> = [];
  for (const root of await wurmPlayersRoots()) {
    const kind = root.toLowerCase().includes("steamapps") ? kindSteam : kindSite;
    let names: string[] = [];
    try {
      names = fs.readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const d of names) {
      const logs = path.join(root, d, "logs");
      if (isDir(logs)) candidates.push({ char: d, kind, logs, t: lastActivity(logs) });
    }
  }
  const persona = (await steamPersonaName())?.toLowerCase() || null;
  const count = new Map<string, number>();
  for (const c of candidates) count.set(c.char.toLowerCase(), (count.get(c.char.toLowerCase()) || 0) + 1);
  const seen = new Set<string>();
  const result: Array<FoundClient & { rank: number }> = [];
  for (const c of candidates) {
    const key = IS_WIN || IS_MAC ? c.logs.toLowerCase() : c.logs;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = (count.get(c.char.toLowerCase()) || 0) > 1 ? `${c.char} (${c.kind})` : c.char;
    result.push({ name: label, path: c.logs, rank: persona && c.char.toLowerCase() === persona ? 0 : 1 });
  }
  result.sort((a, b) => a.rank - b.rank);
  return result.map(({ name, path: p }) => ({ name, path: p }));
}

export { characterFromLogsPath } from "./channels";
