/**
 * Game currency: 1g = 100s = 10000c = 1000000i (gold/silver/copper/iron).
 *
 * Amounts like "20s" or "2g 50s 30c 40i" get mangled by machine translation,
 * so they are hidden in <CurN> tokens before translating and restored as
 * words in the target language afterwards ("20 серебра", "20 silver").
 *
 * Hand-made word tables (gamewords.ts) cover the common languages. For every
 * other target language the words are machine-translated once and cached
 * (see Lexicon in pipeline.ts) and passed in via `extra`.
 */
import { CURRENCY_WORDS, TWO_FORM_LANGS, type CurrencyUnit } from "./gamewords";

export { CURRENCY_WORDS, type CurrencyUnit };
export type UnitWords = Record<CurrencyUnit, string[]>;

export const CURRENCY_UNITS: CurrencyUnit[] = ["g", "s", "c", "i"];

const RE_CURRENCY = /(?<![\p{L}\p{N}_])(\d+)\s*([gsci])(?![\p{L}\p{N}_])/giu;
const ALNUM = /[\p{L}\p{N}]/u;

export type Amount = [num: string, unit: CurrencyUnit];

export function hasHandWords(lang: string): boolean {
  return lang in CURRENCY_WORDS.g;
}

/** 'WTS sword 2g 50s' -> {text: 'WTS sword <Cur0> <Cur1>', amounts: [['2','g'],['50','s']]}. */
export function currencyProtect(text: string): { text: string; amounts: Amount[] } {
  const amounts: Amount[] = [];
  const out = text.replace(RE_CURRENCY, (_m, num: string, unit: string) => {
    amounts.push([num, unit.toLowerCase() as CurrencyUnit]);
    return `<Cur${amounts.length - 1}>`;
  });
  return { text: out, amounts };
}

function wordFor(num: string, unit: CurrencyUnit, dst: string, extra?: UnitWords | null): string {
  let forms = CURRENCY_WORDS[unit]?.[dst];
  if (!forms && extra && extra[unit]?.length) forms = extra[unit];
  if (!forms) forms = CURRENCY_WORDS[unit].en;
  if (TWO_FORM_LANGS.has(dst) && forms.length > 1) {
    // 1 серебро, but 20 серебра (11 серебра is genitive too)
    const n = parseInt(num, 10) % 100;
    return n % 10 === 1 && n !== 11 ? forms[0] : forms[1];
  }
  return forms[0];
}

/**
 * <CurN> tokens -> '20 серебра' (ru), '20 silver' (en)…; `dst = null` puts
 * the amount back as written ("20s"). Adjacent amounts get a comma
 * ("2g 50s" -> "2 золота, 50 серебра"); a space eaten by the translator
 * around a token is restored.
 */
export function currencyRestore(text: string, amounts: Amount[], dst: string | null, extra?: UnitWords | null): string {
  if (!text || !amounts.length) return text;
  for (let i = 1; i < amounts.length; i++) {
    text = text.replace(new RegExp(`<Cur${i - 1}>\\s*<Cur${i}>`, "g"), `<Cur${i - 1}>, <Cur${i}>`);
  }
  const raw = dst === null;
  amounts.forEach(([num, unit], i) => {
    const word = raw ? unit : wordFor(num, unit, dst!, extra);
    let done = false;
    text = text.replace(new RegExp(`<Cur${i}>`, "g"), (m, offset: number, s: string) => {
      if (done) return m;
      done = true;
      const before = offset > 0 ? s[offset - 1] : " ";
      const end = offset + m.length;
      const after = end < s.length ? s[end] : " ";
      // CJK writes numbers and units without a space
      const tight = raw || /^[぀-ヿ㐀-鿿가-힯]/.test(word);
      let out = tight ? `${num}${word}` : `${num} ${word}`;
      if (ALNUM.test(before) || ">)]»".includes(before)) out = " " + out;
      if (ALNUM.test(after) || "<([«".includes(after)) out += " ";
      return out;
    });
  });
  return text;
}
