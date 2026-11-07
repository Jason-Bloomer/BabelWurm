/**
 * Game glossary: keeps Wurm terms intact through machine translation.
 *
 * Machine translation mangles game terms ("deed" -> "document", "wemp" -> "raw
 * material", "nails" -> "fingernails"). Known terms are hidden in tokens
 * (<Gl0>, <Gl1>, …) before translation and put back in their exact glossary
 * form afterwards; terms that slipped through untouched are fixed by a
 * post-pass.
 *
 * File format (babelwurm_glossary.json):
 *   [{"en": "deed", "ru": "деревня", "de": "Siedlung"}, …]
 * Each entry has the English game term plus translations for any number of
 * target languages; any language code works. Built-in entries: glossaryDefaults.ts.
 */
import * as fs from "node:fs";
import { DEFAULT_GLOSSARY } from "./glossaryDefaults";
import { escapeRe } from "./util";

export type GlossaryItem = Record<string, string>;

export { DEFAULT_GLOSSARY };

/** Terms not hidden before translation: too ambiguous ("pm" is also post meridiem). */
export const GLOSSARY_NO_PROTECT = new Set(["pm"]);
/** Trade prefixes must stay visible so the trade-prefix logic can see them. */
export const TRADE_PREFIX_WORDS = new Set(["wts", "wtb", "wtt", "pc"]);

const WORD = "[\\p{L}\\p{N}_]";
const ALNUM = /[\p{L}\p{N}]/u;

export { escapeRe };

/** Whole-word, case-insensitive, Unicode-aware matcher. */
export function wordRe(term: string): RegExp {
  return new RegExp(`(?<!${WORD})${escapeRe(term)}(?!${WORD})`, "giu");
}

interface Entry {
  en: string;
  enRe: RegExp;
  tr: string;
  trRe: RegExp;
}

export type GlossaryTerms = Array<[token: string, replacement: string]>;

export class Glossary {
  private mtime: number | null | undefined = undefined;
  private items: GlossaryItem[] = DEFAULT_GLOSSARY;
  private compiled = new Map<string, Entry[]>();

  constructor(private readonly file: string | null, private readonly log: (m: string) => void = () => {}) {}

  /** Re-read the file when it changes on disk: edits apply without a restart. */
  private load(): GlossaryItem[] {
    if (!this.file) return this.items;
    let mtime: number | null = null;
    try {
      mtime = fs.statSync(this.file).mtimeMs;
    } catch {
      mtime = null;
    }
    if (mtime === this.mtime) return this.items;
    let items = DEFAULT_GLOSSARY;
    try {
      if (mtime === null) {
        fs.writeFileSync(this.file, JSON.stringify(DEFAULT_GLOSSARY, null, 2), "utf-8");
        try {
          mtime = fs.statSync(this.file).mtimeMs;
        } catch {
          /* ignore */
        }
      } else {
        const loaded = JSON.parse(fs.readFileSync(this.file, "utf-8"));
        if (Array.isArray(loaded)) items = loaded.filter((x) => x && typeof x === "object");
      }
    } catch (e) {
      // broken file — keep working with the built-in glossary
      this.log(`glossary: cannot read ${this.file}: ${e}`);
    }
    this.mtime = mtime;
    this.items = items;
    this.compiled.clear();
    return items;
  }

  /** Entries for target language `lang`, longest English term first ("guard tower" before "guard"). */
  entries(lang: string): Entry[] {
    const items = this.load();
    const hit = this.compiled.get(lang);
    if (hit) return hit;
    const out: Entry[] = [];
    for (const item of items) {
      const en = String(item.en ?? "").trim();
      const tr = String(item[lang] ?? "").trim();
      if (!en || !tr) continue;
      out.push({ en, enRe: wordRe(en), tr, trRe: wordRe(tr) });
    }
    out.sort((a, b) => b.en.length - a.en.length);
    this.compiled.set(lang, out);
    return out;
  }

  /** Does the glossary have any entries for this language? */
  hasLanguage(lang: string): boolean {
    return lang !== "en" && this.entries(lang).length > 0;
  }

  /** Post-pass on a translation into `lang`: English terms left untouched -> glossary form. */
  fixForward(text: string, lang: string): string {
    if (!text || lang === "en") return text;
    for (const e of this.entries(lang)) text = text.replace(e.enRe, () => e.tr);
    return text;
  }

  /** Post-pass on a translation from `srcLang` into English (reply panel): known terms -> English game term. */
  fixReverse(text: string, srcLang: string): string {
    if (!text || srcLang === "en") return text;
    for (const e of this.entries(srcLang)) text = text.replace(e.trRe, () => e.en);
    return text;
  }

  /** Hide English terms in tokens before translating into `lang`. */
  protect(text: string, lang: string): { text: string; terms: GlossaryTerms } {
    const terms: GlossaryTerms = [];
    if (!text || lang === "en") return { text, terms };
    let n = 0;
    for (const e of this.entries(lang)) {
      const low = e.en.toLowerCase();
      if (GLOSSARY_NO_PROTECT.has(low) || TRADE_PREFIX_WORDS.has(low)) {
        n++;
        continue;
      }
      e.enRe.lastIndex = 0;
      if (e.enRe.test(text)) {
        const token = `<Gl${n}>`;
        e.enRe.lastIndex = 0;
        text = text.replace(e.enRe, token);
        terms.push([token, e.tr]);
      }
      n++;
    }
    return { text, terms };
  }

  /** Reverse protection for the reply panel (srcLang -> en): hide known terms, restore as English. */
  protectReverse(text: string, srcLang: string): { text: string; terms: GlossaryTerms } {
    const terms: GlossaryTerms = [];
    if (!text || srcLang === "en") return { text, terms };
    const list = this.entries(srcLang).slice().sort((a, b) => b.tr.length - a.tr.length);
    let n = 0;
    for (const e of list) {
      e.trRe.lastIndex = 0;
      if (e.trRe.test(text)) {
        const token = `<Gl${n}>`;
        e.trRe.lastIndex = 0;
        text = text.replace(e.trRe, token);
        terms.push([token, e.en]);
      }
      n++;
    }
    return { text, terms };
  }

  /** Raw entries for the editor. */
  rawItems(): GlossaryItem[] {
    return this.load().map((x) => ({ ...x }));
  }

  /** Save entries and drop caches — changes apply immediately. */
  saveItems(items: GlossaryItem[]): void {
    if (!this.file) {
      this.items = items;
      this.compiled.clear();
      return;
    }
    fs.writeFileSync(this.file, JSON.stringify(items, null, 2), "utf-8");
    this.mtime = undefined;
    this.load();
  }

  get path(): string | null {
    return this.file;
  }
}

/**
 * Put glossary tokens back. Machine translation sometimes eats the spaces
 * around a token and glues words together ("изумруд<Gl57>"), so a space is
 * added when the term ends up touching a letter, digit or bracket.
 */
export function glossaryRestore(text: string, terms: GlossaryTerms): string {
  if (!text || !terms.length) return text;
  for (const [token, repl] of terms) {
    const re = new RegExp(escapeRe(token), "gi");
    text = text.replace(re, (_m, offset: number, s: string) => {
      const pre = offset > 0 ? s[offset - 1] : " ";
      const end = offset + token.length;
      const post = end < s.length ? s[end] : " ";
      let res = repl;
      if ((ALNUM.test(pre) || ")]}".includes(pre)) && ALNUM.test(repl[0] || "")) res = " " + res;
      if (ALNUM.test(post) || "([{".includes(post)) res = res + " ";
      return res;
    });
  }
  return text;
}
