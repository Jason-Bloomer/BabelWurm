/**
 * Machine translation of the interface strings, for every interface language
 * that has no hand-made translation. Uses the same translator chain as chat
 * (Google → MyMemory); the result is cached on disk by the caller.
 *
 * - Placeholders ({n}, {path}, …) are replaced by numbered ones ({0}, {1})
 *   before translating and checked afterwards; a line that lost or mangled a
 *   placeholder keeps its English text rather than showing a broken string.
 * - Strings are sent in batches, one string line per text line (Google keeps
 *   line breaks). If a reply comes back with a different number of lines the
 *   batch is split in half and retried, down to single lines.
 */

export type Dict = Record<string, string>;
export type TranslateFn = (text: string, dst: string, src: string) => Promise<string | null>;

const BATCH_CHARS = 900;
const RE_NAMED = /\{(\w+)\}/g;
const RE_NUMBERED = /\{\s*(\d+)\s*\}/g;

interface Unit {
  key: string;
  line: number;
  text: string;
  names: string[];
}

function encode(line: string): { text: string; names: string[] } {
  const names: string[] = [];
  const text = line.replace(RE_NAMED, (_m, name: string) => {
    let i = names.indexOf(name);
    if (i < 0) i = names.push(name) - 1;
    return `{${i}}`;
  });
  return { text, names };
}

/** Put named placeholders back; null when one is missing or unknown. */
export function decode(translated: string, names: string[]): string | null {
  const seen = new Set<number>();
  let bad = false;
  const out = translated.replace(RE_NUMBERED, (_m, d: string) => {
    const i = Number(d);
    if (i >= names.length) {
      bad = true;
      return "";
    }
    seen.add(i);
    return `{${names[i]}}`;
  });
  if (bad || seen.size !== names.length) return null;
  return out;
}

export async function translateUiStrings(
  en: Dict,
  lang: string,
  tr: TranslateFn,
  pause: () => Promise<void> = async () => {},
): Promise<{ strings: Dict; complete: boolean }> {
  const units: Unit[] = [];
  for (const [key, value] of Object.entries(en)) {
    value.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      const { text, names } = encode(line);
      units.push({ key, line: i, text, names });
    });
  }
  const result = new Map<Unit, string>();
  let complete = true;

  const run = async (batch: Unit[]): Promise<void> => {
    if (!batch.length) return;
    const out = await tr(batch.map((u) => u.text).join("\n"), lang, "en");
    await pause();
    if (out === null) {
      complete = false; // network/service failure — retried another time
      return;
    }
    const lines = out.split("\n");
    if (lines.length !== batch.length) {
      if (batch.length === 1) return; // keep English
      const mid = Math.ceil(batch.length / 2);
      await run(batch.slice(0, mid));
      await run(batch.slice(mid));
      return;
    }
    batch.forEach((u, i) => {
      const decoded = decode(lines[i].trim(), u.names);
      if (decoded) result.set(u, decoded);
    });
  };

  let batch: Unit[] = [];
  let size = 0;
  for (const u of units) {
    if (batch.length && size + u.text.length + 1 > BATCH_CHARS) {
      await run(batch);
      batch = [];
      size = 0;
    }
    batch.push(u);
    size += u.text.length + 1;
  }
  await run(batch);

  const strings: Dict = {};
  for (const [key, value] of Object.entries(en)) {
    const lines = value.split("\n");
    const mine = units.filter((u) => u.key === key);
    for (const u of mine) {
      const t = result.get(u);
      if (t) lines[u.line] = t;
    }
    strings[key] = lines.join("\n");
  }
  return { strings, complete };
}

/** Short stable hash of the English strings: a cached translation is redone when they change. */
export function hashStrings(en: Dict): string {
  const s = JSON.stringify(en);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
