/**
 * The translation pipeline for chat messages, the reply panel and the
 * glossary editor's "translate a phrase" box.
 *
 * Message flow: currency amounts and glossary terms are hidden in tokens,
 * <Name> tokens split the text so names are never translated, trade prefixes
 * (WTS/WTB/WTT/PC) get a fixed translation, the rest goes through
 * Google → MyMemory, then the post-pass and token restore run.
 */
import * as fs from "node:fs";
import { languageOfChannel } from "./channels";
import { currencyProtect, currencyRestore, hasHandWords, type UnitWords } from "./currency";
import { Glossary, glossaryRestore } from "./glossary";
import { canonicalLang, isKnownLanguage, sameLanguage } from "./languages";
import type { Translator } from "./translate";

import { TRADE_PREFIXES, type TradeWord } from "./gamewords";

export { TRADE_PREFIXES, type TradeWord };

/** "(Cad) WTS …" — optional server tag in brackets, prefix in any case. */
export const RE_TRADE_PREFIX = /^(?:\(([A-Za-z]{2,10})\)\s*)?(WTS|WTB|WTT|PC)\b[:\s-]*/i;
const NAME_TOKEN_SPLIT = /(<[^<>\r\n]+>)/;
const CYRILLIC = /[А-Яа-яЁё]/;

export const TRANSLATE_INTERVAL_MS = 1000;
export const TRANSLATE_CACHE_MAX = 5000;
const LEXICON_RETRY_MS = 10 * 60 * 1000;

/**
 * Cheap "already in the target language" checks for scripts that are
 * (practically) unique to one language — saves a network round-trip.
 */
const SCRIPT_HINTS: Record<string, RegExp> = {
  ru: CYRILLIC,
  ko: /[가-힯]/,
  el: /[Ͱ-Ͽ]/,
  th: /[฀-๿]/,
  he: /[֐-׿]/,
  ka: /[Ⴀ-ჿ]/,
  hy: /[԰-֏]/,
  ja: /[぀-ヿ]/,
};

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function looksLikeTarget(text: string, dst: string): boolean {
  const re = SCRIPT_HINTS[dst];
  return !!re && re.test(text);
}

export interface MessageOptions {
  translate: boolean;
  targetLang: string;
  translateLangChannels: boolean;
  translateCurrency: boolean;
}

/**
 * A language chat ("Russian GL", "German GL", …) held in the reader's own
 * language is shown as is (no point sending it to a translator). Chats in
 * other languages are translated, so "German GL" is readable for an English
 * reader.
 * The option "translate language channels" translates them all.
 */
export function keepAsIs(channel: string | null, opts: Pick<MessageOptions, "targetLang" | "translateLangChannels">): boolean {
  if (channel === null || opts.translateLangChannels) return false;
  const lang = languageOfChannel(channel);
  return !!lang && sameLanguage(lang, opts.targetLang);
}

export interface TranslatedMessage {
  translated: string | null;
  srcLang: string | null;
}

interface LexiconEntry {
  currency?: UnitWords;
  trade?: Record<TradeWord, string>;
}

/**
 * Machine-translated words for target languages without a hand-made table
 * (currency units, trade prefixes). Fetched once per language and cached on disk.
 */
export class Lexicon {
  private data: Record<string, LexiconEntry> = {};
  private pending = new Map<string, Promise<void>>();
  /** lang -> time of the last failed lookup; retried after LEXICON_RETRY_MS. */
  private failedAt = new Map<string, number>();

  constructor(private readonly file: string | null, private readonly translator: Translator) {
    if (file) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, "utf-8")) || {};
      } catch {
        this.data = {};
      }
    }
  }

  private save() {
    if (!this.file) return;
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1), "utf-8");
    } catch {
      /* ignore */
    }
  }

  currencyWords(lang: string): UnitWords | null {
    return this.data[lang]?.currency || null;
  }

  tradeWord(lang: string, word: TradeWord): string | null {
    return this.data[lang]?.trade?.[word] || null;
  }

  /** Make sure words for `lang` are available (no-op for hand-made languages). */
  async ensure(lang: string): Promise<void> {
    if (lang === "en" || (hasHandWords(lang) && TRADE_PREFIXES[lang])) return;
    const have = this.data[lang];
    if (have?.currency && have?.trade) return;
    const inflight = this.pending.get(lang);
    if (inflight) return inflight;
    const failed = this.failedAt.get(lang);
    if (failed !== undefined && Date.now() - failed < LEXICON_RETRY_MS) return;
    const p = this.fetch(lang).finally(() => this.pending.delete(lang));
    this.pending.set(lang, p);
    return p;
  }

  private async fetch(lang: string): Promise<void> {
    const entry: LexiconEntry = { ...(this.data[lang] || {}) };
    if (!entry.currency && !hasHandWords(lang)) {
      const r = await this.translator.translate("gold, silver, copper, iron", lang, "en");
      const parts = (r.text || "").split(/\s*[,،、，;]\s*/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 4) entry.currency = { g: [parts[0]], s: [parts[1]], c: [parts[2]], i: [parts[3]] };
    }
    if (!entry.trade && !TRADE_PREFIXES[lang]) {
      const r = await this.translator.translate("Selling\nBuying\nTrading\nPrice check", lang, "en");
      const parts = (r.text || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 4) entry.trade = { WTS: parts[0], WTB: parts[1], WTT: parts[2], PC: parts[3] };
    }
    if (entry.currency || entry.trade) {
      this.data[lang] = entry;
      this.save();
    }
    if (!entry.currency || !entry.trade) this.failedAt.set(lang, Date.now());
    else this.failedAt.delete(lang);
  }
}

export class Pipeline {
  private cache = new Map<string, TranslatedMessage>();
  private lastRequest = 0;

  constructor(
    readonly translator: Translator,
    readonly glossary: Glossary,
    readonly lexicon: Lexicon,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Normalise a detected language code; unknown/odd detections count as English (the game's main language). */
  normLang(detected: string | null | undefined): string {
    const c = canonicalLang(detected || "");
    return c && c !== "auto" && isKnownLanguage(c) ? c : "en";
  }

  /**
   * Translate text while leaving <Name>, <Gl…>, <Cur…> tokens untouched: the text
   * is split on tokens and only the pieces between them are sent to the translator.
   * Returns detected = null when there was nothing to translate.
   */
  async translateSegments(text: string, dst: string): Promise<{ text: string | null; detected: string | null }> {
    const parts = text.split(NAME_TOKEN_SPLIT);
    const out: string[] = [];
    let detected: string | null = null;
    for (const part of parts) {
      if (!part) continue;
      if ((part.startsWith("<") && part.endsWith(">") && part.length > 2) || !part.trim()) {
        out.push(part); // token or whitespace: kept verbatim
        continue;
      }
      const r = await this.translator.translate(part, dst);
      if (r.text === null) return { text: null, detected: null };
      let piece = r.text;
      if (detected === null && r.detected && r.detected !== "auto") detected = r.detected;
      // keep the original's surrounding whitespace — translators trim it, which
      // glued words to names/tokens ("<Bob>hello") or added spaces that weren't there
      const lead = /^\s*/.exec(part)![0];
      const trail = /\s*$/.exec(part)![0];
      piece = lead + piece.trim() + trail;
      out.push(piece);
    }
    const joined = out.join("").trim();
    if (!joined) return { text: null, detected: null };
    return { text: joined, detected };
  }

  /**
   * Translate keeping <Name> intact and append the source language code: "… (en)".
   * Returns {text, srcLang}; srcLang = target language when the text already was in it.
   */
  async translatePreservingNames(text: string, dst: string): Promise<TranslatedMessage> {
    const r = await this.translateSegments(text, dst);
    if (r.text === null) return { translated: null, srcLang: null };
    if (r.detected === null) return { translated: r.text, srcLang: null }; // only a <Name>: no "(lang)" tail
    const lang = this.normLang(r.detected);
    if (sameLanguage(lang, dst)) return { translated: text, srcLang: dst };
    // nothing changed (names, numbers, "QL:99 DMG:0.0"): show as is, no "(lang)" duplicate
    if (norm(r.text) === norm(text)) return { translated: text, srcLang: null };
    return { translated: `${r.text} (${lang})`, srcLang: lang };
  }

  tradeHead(prefix: TradeWord, dst: string): string {
    return TRADE_PREFIXES[dst]?.[prefix] || this.lexicon.tradeWord(dst, prefix) || prefix;
  }

  /** WTS/WTB/WTT/PC at the start get a fixed translation; the rest goes through the normal chain. */
  async translateTradeBody(body: string, dst: string): Promise<TranslatedMessage> {
    const m = RE_TRADE_PREFIX.exec(body);
    if (!m) return this.translatePreservingNames(body, dst);
    const prefix = m[2].toUpperCase() as TradeWord;
    const server = m[1];
    const rest = body.slice(m[0].length);
    let head = this.tradeHead(prefix, dst);
    if (server) head = `(${server}) ${head}`;
    if (!rest.trim()) return { translated: head, srcLang: "en" }; // prefix only: no language tail
    let tail: string;
    let lang: string;
    if (looksLikeTarget(rest, dst)) {
      tail = rest;
      lang = dst;
    } else {
      const r = await this.translateSegments(rest, dst);
      if (r.text === null) return { translated: null, srcLang: null };
      lang = r.detected ? this.normLang(r.detected) : "en";
      tail = sameLanguage(lang, dst) ? rest : r.text;
    }
    return { translated: `${head} ${tail.trim()} (${lang})`, srcLang: lang };
  }

  /**
   * The full message pipeline (per chat line).
   * `channel` = null for the glossary editor's preview (trade prefix detected anywhere).
   */
  async translateMessage(body: string, channel: string | null, opts: MessageOptions): Promise<TranslatedMessage> {
    if (!body) return { translated: body, srcLang: null };
    const dst = opts.targetLang;
    if (keepAsIs(channel, opts)) return { translated: body, srcLang: null }; // own-language chat: shown as is
    if (!opts.translate) return { translated: null, srcLang: null };
    const tradePrefixed = (channel === null || channel === "Trade") && RE_TRADE_PREFIX.test(body);
    await this.lexicon.ensure(dst);
    const curWords = this.lexicon.currencyWords(dst);
    const curDst = opts.translateCurrency ? dst : null;

    if (looksLikeTarget(body, dst) && !tradePrefixed) {
      // already in the target language — only currency is spelled out
      const { text, amounts } = currencyProtect(body);
      if (!amounts.length || !opts.translateCurrency) return { translated: body, srcLang: dst };
      return { translated: currencyRestore(text, amounts, curDst, curWords), srcLang: dst };
    }

    const key = `${dst}|${opts.translateCurrency ? 1 : 0}|${tradePrefixed ? 1 : 0}|${body}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const pause = TRANSLATE_INTERVAL_MS - (Date.now() - this.lastRequest);
    if (pause > 0) await this.sleep(pause);
    // currency is hidden even when the option is off — so "20s" reaches the
    // screen as written instead of a mangled machine translation
    const cur = currencyProtect(body);
    // glossary terms are hidden too, so Google doesn't guess them ("nails" -> "fingernails")
    const gl = this.glossary.protect(cur.text, dst);
    const res = tradePrefixed ? await this.translateTradeBody(gl.text, dst) : await this.translatePreservingNames(gl.text, dst);
    this.lastRequest = Date.now();
    if (res.translated === null) return res;

    let out = res.translated;
    if (res.srcLang && sameLanguage(res.srcLang, dst) && !tradePrefixed) {
      // detected as the target language: show the original (with currency spelled out)
      out = gl.text;
    } else {
      out = this.glossary.fixForward(out, dst);
    }
    out = currencyRestore(out, cur.amounts, curDst, curWords);
    out = glossaryRestore(out, gl.terms);
    const final: TranslatedMessage = { translated: out, srcLang: res.srcLang };
    this.cache.set(key, final);
    if (this.cache.size > TRANSLATE_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return final;
  }

  /** Glossary editor preview: the same pipeline as a chat message, one phrase. */
  async preview(body: string, targetLang: string, translateCurrency = true): Promise<TranslatedMessage> {
    if (!body) return { translated: body, srcLang: null };
    return this.translateMessage(body, null, {
      translate: true,
      targetLang,
      translateLangChannels: true,
      translateCurrency,
    });
  }

  /** Reply panel: src -> dst with glossary handling in both directions. */
  async translateReply(text: string, src: string, dst: string): Promise<string | null> {
    let terms: Array<[string, string]> = [];
    let input = text;
    if (dst === "en" && this.glossary.hasLanguage(src)) {
      // hide terms before translating, otherwise Google mangles them ("вемп" -> "hemp")
      const p = this.glossary.protectReverse(text, src);
      input = p.text;
      terms = p.terms;
    }
    let result: string | null;
    if (src === dst) result = input;
    else result = (await this.translator.translate(input, dst, src)).text;
    if (!result) return null;
    if (terms.length) result = glossaryRestore(result, terms);
    if (dst === "en" && this.glossary.hasLanguage(src)) result = this.glossary.fixReverse(result, src);
    else if (this.glossary.hasLanguage(dst)) result = this.glossary.fixForward(result, dst);
    return result;
  }

  clearCache() {
    this.cache.clear();
  }
}
