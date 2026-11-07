/**
 * Translation languages.
 *
 * The built-in list is Google Cloud Translation's published NMT list plus the
 * 2024 expansion of Google Translate. At runtime the app also asks Google's
 * public endpoint for its current language list and caches it, so newly added
 * languages show up without an app update (see `parseGoogleLanguageList`).
 */

export interface Language {
  code: string;
  /** English name. */
  name: string;
}

/** Codes Google accepts that duplicate another entry (kept for compatibility, hidden from pickers). */
export const LANGUAGE_ALIASES: Record<string, string> = {
  "zh-CN": "zh",
  iw: "he",
  jw: "jv",
  tl: "fil",
};

export const BUILTIN_LANGUAGES: Language[] = [
  { code: "ab", name: "Abkhaz" },
  { code: "ace", name: "Acehnese" },
  { code: "ach", name: "Acholi" },
  { code: "aa", name: "Afar" },
  { code: "af", name: "Afrikaans" },
  { code: "sq", name: "Albanian" },
  { code: "alz", name: "Alur" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "hy", name: "Armenian" },
  { code: "as", name: "Assamese" },
  { code: "av", name: "Avar" },
  { code: "awa", name: "Awadhi" },
  { code: "ay", name: "Aymara" },
  { code: "az", name: "Azerbaijani" },
  { code: "ban", name: "Balinese" },
  { code: "bal", name: "Baluchi" },
  { code: "bm", name: "Bambara" },
  { code: "bci", name: "Baoulé" },
  { code: "ba", name: "Bashkir" },
  { code: "eu", name: "Basque" },
  { code: "btx", name: "Batak Karo" },
  { code: "bts", name: "Batak Simalungun" },
  { code: "bbc", name: "Batak Toba" },
  { code: "be", name: "Belarusian" },
  { code: "bem", name: "Bemba" },
  { code: "bn", name: "Bengali" },
  { code: "bew", name: "Betawi" },
  { code: "bho", name: "Bhojpuri" },
  { code: "bik", name: "Bikol" },
  { code: "bs", name: "Bosnian" },
  { code: "br", name: "Breton" },
  { code: "bg", name: "Bulgarian" },
  { code: "bua", name: "Buryat" },
  { code: "yue", name: "Cantonese" },
  { code: "ca", name: "Catalan" },
  { code: "ceb", name: "Cebuano" },
  { code: "ch", name: "Chamorro" },
  { code: "ce", name: "Chechen" },
  { code: "ny", name: "Chichewa (Nyanja)" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "chk", name: "Chuukese" },
  { code: "cv", name: "Chuvash" },
  { code: "co", name: "Corsican" },
  { code: "crh", name: "Crimean Tatar" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "fa-AF", name: "Dari" },
  { code: "dv", name: "Dhivehi" },
  { code: "din", name: "Dinka" },
  { code: "doi", name: "Dogri" },
  { code: "dov", name: "Dombe" },
  { code: "nl", name: "Dutch" },
  { code: "dyu", name: "Dyula" },
  { code: "dz", name: "Dzongkha" },
  { code: "en", name: "English" },
  { code: "eo", name: "Esperanto" },
  { code: "et", name: "Estonian" },
  { code: "ee", name: "Ewe" },
  { code: "fo", name: "Faroese" },
  { code: "fj", name: "Fijian" },
  { code: "fil", name: "Filipino (Tagalog)" },
  { code: "fi", name: "Finnish" },
  { code: "fon", name: "Fon" },
  { code: "fr", name: "French" },
  { code: "fr-CA", name: "French (Canada)" },
  { code: "fy", name: "Frisian" },
  { code: "fur", name: "Friulian" },
  { code: "ff", name: "Fulani" },
  { code: "gaa", name: "Ga" },
  { code: "gl", name: "Galician" },
  { code: "lg", name: "Ganda (Luganda)" },
  { code: "ka", name: "Georgian" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "gn", name: "Guarani" },
  { code: "gu", name: "Gujarati" },
  { code: "ht", name: "Haitian Creole" },
  { code: "cnh", name: "Hakha Chin" },
  { code: "ha", name: "Hausa" },
  { code: "haw", name: "Hawaiian" },
  { code: "he", name: "Hebrew" },
  { code: "hil", name: "Hiligaynon" },
  { code: "hi", name: "Hindi" },
  { code: "hmn", name: "Hmong" },
  { code: "hu", name: "Hungarian" },
  { code: "hrx", name: "Hunsrik" },
  { code: "iba", name: "Iban" },
  { code: "is", name: "Icelandic" },
  { code: "ig", name: "Igbo" },
  { code: "ilo", name: "Ilocano" },
  { code: "id", name: "Indonesian" },
  { code: "iu-Latn", name: "Inuktut (Latin)" },
  { code: "iu", name: "Inuktut (Syllabics)" },
  { code: "ga", name: "Irish" },
  { code: "it", name: "Italian" },
  { code: "jam", name: "Jamaican Patois" },
  { code: "ja", name: "Japanese" },
  { code: "jv", name: "Javanese" },
  { code: "kac", name: "Jingpo" },
  { code: "kl", name: "Kalaallisut" },
  { code: "kn", name: "Kannada" },
  { code: "kr", name: "Kanuri" },
  { code: "pam", name: "Kapampangan" },
  { code: "kk", name: "Kazakh" },
  { code: "kha", name: "Khasi" },
  { code: "km", name: "Khmer" },
  { code: "cgg", name: "Kiga" },
  { code: "kg", name: "Kikongo" },
  { code: "rw", name: "Kinyarwanda" },
  { code: "ktu", name: "Kituba" },
  { code: "trp", name: "Kokborok" },
  { code: "kv", name: "Komi" },
  { code: "gom", name: "Konkani" },
  { code: "ko", name: "Korean" },
  { code: "kri", name: "Krio" },
  { code: "ku", name: "Kurdish (Kurmanji)" },
  { code: "ckb", name: "Kurdish (Sorani)" },
  { code: "ky", name: "Kyrgyz" },
  { code: "lo", name: "Lao" },
  { code: "ltg", name: "Latgalian" },
  { code: "la", name: "Latin" },
  { code: "lv", name: "Latvian" },
  { code: "lij", name: "Ligurian" },
  { code: "li", name: "Limburgish" },
  { code: "ln", name: "Lingala" },
  { code: "lt", name: "Lithuanian" },
  { code: "lmo", name: "Lombard" },
  { code: "luo", name: "Luo" },
  { code: "lb", name: "Luxembourgish" },
  { code: "mk", name: "Macedonian" },
  { code: "mad", name: "Madurese" },
  { code: "mai", name: "Maithili" },
  { code: "mak", name: "Makassar" },
  { code: "mg", name: "Malagasy" },
  { code: "ms", name: "Malay" },
  { code: "ms-Arab", name: "Malay (Jawi)" },
  { code: "ml", name: "Malayalam" },
  { code: "mt", name: "Maltese" },
  { code: "mam", name: "Mam" },
  { code: "gv", name: "Manx" },
  { code: "mi", name: "Maori" },
  { code: "mr", name: "Marathi" },
  { code: "mh", name: "Marshallese" },
  { code: "mwr", name: "Marwadi" },
  { code: "mfe", name: "Mauritian Creole" },
  { code: "chm", name: "Meadow Mari" },
  { code: "mni-Mtei", name: "Meiteilon (Manipuri)" },
  { code: "min", name: "Minang" },
  { code: "lus", name: "Mizo" },
  { code: "mn", name: "Mongolian" },
  { code: "my", name: "Myanmar (Burmese)" },
  { code: "nhe", name: "Nahuatl (Eastern Huasteca)" },
  { code: "ndc-ZW", name: "Ndau" },
  { code: "nr", name: "Ndebele (South)" },
  { code: "new", name: "Nepalbhasa (Newari)" },
  { code: "ne", name: "Nepali" },
  { code: "bm-Nkoo", name: "NKo" },
  { code: "no", name: "Norwegian" },
  { code: "nus", name: "Nuer" },
  { code: "oc", name: "Occitan" },
  { code: "or", name: "Odia (Oriya)" },
  { code: "om", name: "Oromo" },
  { code: "os", name: "Ossetian" },
  { code: "pag", name: "Pangasinan" },
  { code: "pap", name: "Papiamento" },
  { code: "ps", name: "Pashto" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "pa", name: "Punjabi (Gurmukhi)" },
  { code: "pa-Arab", name: "Punjabi (Shahmukhi)" },
  { code: "qu", name: "Quechua" },
  { code: "kek", name: "Qʼeqchiʼ" },
  { code: "rom", name: "Romani" },
  { code: "ro", name: "Romanian" },
  { code: "rn", name: "Rundi" },
  { code: "ru", name: "Russian" },
  { code: "se", name: "Sami (North)" },
  { code: "sm", name: "Samoan" },
  { code: "sg", name: "Sango" },
  { code: "sa", name: "Sanskrit" },
  { code: "sat-Latn", name: "Santali (Latin)" },
  { code: "sat", name: "Santali (Ol Chiki)" },
  { code: "gd", name: "Scots Gaelic" },
  { code: "nso", name: "Sepedi" },
  { code: "sr", name: "Serbian" },
  { code: "st", name: "Sesotho" },
  { code: "crs", name: "Seychellois Creole" },
  { code: "shn", name: "Shan" },
  { code: "sn", name: "Shona" },
  { code: "scn", name: "Sicilian" },
  { code: "szl", name: "Silesian" },
  { code: "sd", name: "Sindhi" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "so", name: "Somali" },
  { code: "es", name: "Spanish" },
  { code: "su", name: "Sundanese" },
  { code: "sus", name: "Susu" },
  { code: "sw", name: "Swahili" },
  { code: "ss", name: "Swati" },
  { code: "sv", name: "Swedish" },
  { code: "ty", name: "Tahitian" },
  { code: "tg", name: "Tajik" },
  { code: "ber-Latn", name: "Tamazight" },
  { code: "ber", name: "Tamazight (Tifinagh)" },
  { code: "ta", name: "Tamil" },
  { code: "tt", name: "Tatar" },
  { code: "te", name: "Telugu" },
  { code: "tet", name: "Tetum" },
  { code: "th", name: "Thai" },
  { code: "bo", name: "Tibetan" },
  { code: "ti", name: "Tigrinya" },
  { code: "tiv", name: "Tiv" },
  { code: "tpi", name: "Tok Pisin" },
  { code: "to", name: "Tongan" },
  { code: "ts", name: "Tsonga" },
  { code: "tn", name: "Tswana" },
  { code: "tcy", name: "Tulu" },
  { code: "tum", name: "Tumbuka" },
  { code: "tr", name: "Turkish" },
  { code: "tk", name: "Turkmen" },
  { code: "tyv", name: "Tuvan" },
  { code: "ak", name: "Twi (Akan)" },
  { code: "udm", name: "Udmurt" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "ug", name: "Uyghur" },
  { code: "uz", name: "Uzbek" },
  { code: "ve", name: "Venda" },
  { code: "vec", name: "Venetian" },
  { code: "vi", name: "Vietnamese" },
  { code: "war", name: "Waray" },
  { code: "cy", name: "Welsh" },
  { code: "wo", name: "Wolof" },
  { code: "xh", name: "Xhosa" },
  { code: "sah", name: "Yakut" },
  { code: "yi", name: "Yiddish" },
  { code: "yo", name: "Yoruba" },
  { code: "yua", name: "Yucatec Maya" },
  { code: "zap", name: "Zapotec" },
  { code: "zu", name: "Zulu" },
];

let current: Language[] = BUILTIN_LANGUAGES.slice();
let byCode = new Map(current.map((l) => [l.code, l]));

export function allLanguages(): Language[] {
  return current;
}

/**
 * Replace the active language list (e.g. with the list fetched from Google).
 * Built-in entries missing from the new list are kept so a partial reply never
 * removes a language the user has selected.
 */
export function setLanguages(list: Language[]): void {
  if (!list.length) return;
  const merged = new Map<string, Language>();
  for (const l of list) {
    const code = canonicalLang(l.code);
    if (!merged.has(code)) merged.set(code, { code, name: l.name });
  }
  for (const l of BUILTIN_LANGUAGES) if (!merged.has(l.code)) merged.set(l.code, l);
  current = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  byCode = new Map(current.map((l) => [l.code, l]));
}

/** Map Google's alias codes (iw, jw, tl, zh-CN) to the canonical one. */
export function canonicalLang(code: string | null | undefined): string {
  if (!code) return "";
  const c = code.trim();
  if (LANGUAGE_ALIASES[c]) return LANGUAGE_ALIASES[c];
  // Google returns region in upper case; normalise "zh-tw" -> "zh-TW"
  const lower = c.toLowerCase();
  for (const l of current) if (l.code.toLowerCase() === lower) return l.code;
  for (const [alias, canon] of Object.entries(LANGUAGE_ALIASES))
    if (alias.toLowerCase() === lower) return canon;
  return c;
}

export function isKnownLanguage(code: string | null | undefined): boolean {
  return !!code && byCode.has(canonicalLang(code));
}

/** Base language without script/region: "zh-TW" -> "zh", "pt-PT" -> "pt". */
export function baseLang(code: string | null | undefined): string {
  return (code || "").split("-")[0].toLowerCase();
}

/** Same language ignoring region/script ("pt" vs "pt-PT", "zh" vs "zh-TW"). */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return baseLang(canonicalLang(a)) === baseLang(canonicalLang(b));
}

export function englishName(code: string): string {
  return byCode.get(canonicalLang(code))?.name || code;
}

const displayNameCache = new Map<string, string>();

/**
 * Name of language `code` written in language `inLang` (e.g. ("ru","en") -> "Russian",
 * ("ru","ru") -> "русский"). Falls back to the English name.
 */
export function languageName(code: string, inLang: string): string {
  const key = `${code}|${inLang}`;
  const hit = displayNameCache.get(key);
  if (hit) return hit;
  let name = "";
  try {
    const dn = new Intl.DisplayNames([inLang, "en"], { type: "language", fallback: "none" });
    name = dn.of(intlCode(code)) || "";
  } catch {
    name = "";
  }
  // ICU returns the code itself when it has no name — treat as "unknown"
  if (!name || name.toLowerCase() === code.toLowerCase()) name = englishName(code);
  if (inLang === "en") name = englishName(code) || name;
  displayNameCache.set(key, name);
  return name;
}

/** Name of a language in that language itself (for pickers: "Русский", "中文"). */
export function nativeName(code: string): string {
  const n = languageName(code, code);
  return n ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : englishName(code);
}

function intlCode(code: string): string {
  // Google-specific codes → BCP-47 that ICU understands
  const map: Record<string, string> = {
    "zh-TW": "zh-Hant",
    zh: "zh-Hans",
    "mni-Mtei": "mni",
    "ms-Arab": "ms-Arab",
    "pa-Arab": "pa-Arab",
    "bm-Nkoo": "bm",
    "ndc-ZW": "ndc",
    "iu-Latn": "iu",
    "sat-Latn": "sat",
    "ber-Latn": "ber",
    "fa-AF": "fa-AF",
  };
  return map[code] || code;
}

/**
 * Parse the reply of `translate_a/l?client=gtx&hl=en`:
 * `{"sl": {"auto": "Detect language", "af": "Afrikaans", …}, "tl": {"af": "Afrikaans", …}}`.
 */
export function parseGoogleLanguageList(json: unknown): Language[] {
  if (!json || typeof json !== "object") return [];
  const tl = (json as { tl?: Record<string, string> }).tl;
  if (!tl || typeof tl !== "object") return [];
  const out: Language[] = [];
  for (const [code, name] of Object.entries(tl)) {
    if (typeof name === "string" && code && code !== "auto") out.push({ code, name });
  }
  return out;
}
