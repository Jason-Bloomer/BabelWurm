/**
 * Translation backends: Google "gtx" (no API key) with MyMemory as fallback.
 *
 * After GTX_BAN_THRESHOLD consecutive HTTP 429 replies Google is switched off
 * for GTX_BAN_SECONDS so the queue does not stall on every message; MyMemory
 * is used in the meantime.
 */

export type HttpGet = (url: string, timeoutMs: number) => Promise<{ status: number; text: string }>;

export type BackendState = "gtx" | "mymemory" | "fallback" | null;

export interface TranslateResult {
  text: string | null;
  /** Detected (or given) source language, "auto" if unknown. */
  detected: string | null;
}

export const GTX_URL = "https://translate.googleapis.com/translate_a/single";
export const GTX_LANG_LIST_URL = "https://translate.googleapis.com/translate_a/l?client=gtx&hl=en";
export const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
export const GTX_TIMEOUT_MS = 6000;
export const TRANSLATE_MAX_CHARS = 1000;
export const MYMEMORY_MAX_CHARS = 400;
export const GTX_BAN_THRESHOLD = 3;
export const GTX_BAN_SECONDS = 1800;

const NULL_RESULT: TranslateResult = { text: null, detected: null };

export class Translator {
  backend: BackendState = null;
  lastError: string | null = null;
  private bannedUntil = 0;
  private fails = 0;
  onLog: (msg: string) => void = () => {};

  constructor(private readonly get: HttpGet, private readonly now: () => number = () => Date.now()) {}

  /** Google gtx. Returns {text, detected} or nulls on failure. */
  async google(text: string, dst: string, src?: string | null): Promise<TranslateResult> {
    this.lastError = null;
    if (!text) return { text, detected: "auto" };
    if (text.length > TRANSLATE_MAX_CHARS) return NULL_RESULT;
    const params = new URLSearchParams({ client: "gtx", sl: src || "auto", tl: dst, dt: "t", q: text });
    try {
      const res = await this.get(`${GTX_URL}?${params}`, GTX_TIMEOUT_MS);
      if (res.status === 429) {
        this.lastError = "429";
        return NULL_RESULT;
      }
      if (res.status !== 200) return NULL_RESULT;
      const body = res.text.trimStart();
      if (body.startsWith("<")) {
        // HTML "Sorry…" page = Google blocked us; treat like rate limiting
        this.lastError = "429";
        return NULL_RESULT;
      }
      const data = JSON.parse(body);
      let detected = "auto";
      if (Array.isArray(data) && typeof data[2] === "string" && data[2].trim()) detected = data[2].trim();
      const parts: string[] = [];
      if (Array.isArray(data) && Array.isArray(data[0])) {
        for (const seg of data[0]) if (Array.isArray(seg) && typeof seg[0] === "string") parts.push(seg[0]);
      }
      const translated = parts.join("").trim();
      return { text: translated || null, detected };
    } catch {
      return NULL_RESULT;
    }
  }

  /** MyMemory fallback (no key; src = null means auto-detect). */
  async myMemory(text: string, dst: string, src?: string | null): Promise<TranslateResult> {
    if (!text || text.length > MYMEMORY_MAX_CHARS) return NULL_RESULT;
    try {
      const langpair = src ? `${src}|${dst}` : `Autodetect|${dst}`;
      const params = new URLSearchParams({ q: text, langpair });
      const res = await this.get(`${MYMEMORY_URL}?${params}`, GTX_TIMEOUT_MS);
      if (res.status !== 200) return NULL_RESULT;
      const data = JSON.parse(res.text);
      if (String(data?.responseStatus) !== "200") return NULL_RESULT;
      const rd = data.responseData || {};
      const translated = String(rd.translatedText || "").trim();
      const detected = String(rd.detectedLanguage || "").trim() || "auto";
      if (translated.includes("MYMEMORY WARNING")) return NULL_RESULT; // daily quota used up
      return { text: translated || null, detected };
    } catch {
      return NULL_RESULT;
    }
  }

  private async myMemoryWithState(text: string, dst: string, src: string | null | undefined, fallback: boolean) {
    const r = await this.myMemory(text, dst, src);
    if (r.text !== null) this.backend = fallback ? "fallback" : "mymemory";
    return r;
  }

  /** Backend chain: Google gtx (with the 429 kill-switch) → MyMemory. */
  async translate(text: string, dst: string, src?: string | null): Promise<TranslateResult> {
    if (this.now() < this.bannedUntil) return this.myMemoryWithState(text, dst, src, true);
    const r = await this.google(text, dst, src);
    if (r.text !== null) {
      this.fails = 0;
      this.backend = "gtx";
      return r;
    }
    if (this.lastError === "429") {
      this.fails += 1;
      if (this.fails >= GTX_BAN_THRESHOLD) {
        this.bannedUntil = this.now() + GTX_BAN_SECONDS * 1000;
        this.fails = 0;
        this.onLog(`translate: Google is rate limiting (429), pausing it for ${GTX_BAN_SECONDS / 60} min, using MyMemory`);
      }
      return this.myMemoryWithState(text, dst, src, true);
    }
    return this.myMemoryWithState(text, dst, src, false);
  }

  /** True while Google is switched off after repeated 429s. */
  get googleCoolingDown(): boolean {
    return this.now() < this.bannedUntil;
  }
}
