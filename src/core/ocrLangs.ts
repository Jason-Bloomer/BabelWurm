/**
 * Text-recognition (Tesseract) languages offered by the magnifier, with the
 * matching translation language code (for display names). English data is
 * bundled with the app; others are downloaded once on first use.
 */
export interface OcrLang {
  /** Tesseract code. */
  code: string;
  /** Translation language code (for the native name). */
  lang: string;
}

export const OCR_LANGS: OcrLang[] = [
  { code: "eng", lang: "en" },
  { code: "rus", lang: "ru" },
  { code: "deu", lang: "de" },
  { code: "fra", lang: "fr" },
  { code: "spa", lang: "es" },
  { code: "por", lang: "pt" },
  { code: "ita", lang: "it" },
  { code: "pol", lang: "pl" },
  { code: "nld", lang: "nl" },
  { code: "swe", lang: "sv" },
  { code: "nor", lang: "no" },
  { code: "dan", lang: "da" },
  { code: "fin", lang: "fi" },
  { code: "ces", lang: "cs" },
  { code: "slk", lang: "sk" },
  { code: "hun", lang: "hu" },
  { code: "ron", lang: "ro" },
  { code: "bul", lang: "bg" },
  { code: "ukr", lang: "uk" },
  { code: "ell", lang: "el" },
  { code: "tur", lang: "tr" },
  { code: "lit", lang: "lt" },
  { code: "lav", lang: "lv" },
  { code: "est", lang: "et" },
  { code: "hrv", lang: "hr" },
  { code: "srp", lang: "sr" },
  { code: "slv", lang: "sl" },
  { code: "chi_sim", lang: "zh" },
  { code: "chi_tra", lang: "zh-TW" },
  { code: "jpn", lang: "ja" },
  { code: "kor", lang: "ko" },
  { code: "ara", lang: "ar" },
  { code: "heb", lang: "he" },
  { code: "fas", lang: "fa" },
  { code: "hin", lang: "hi" },
  { code: "tha", lang: "th" },
  { code: "vie", lang: "vi" },
  { code: "ind", lang: "id" },
  { code: "msa", lang: "ms" },
  { code: "fil", lang: "fil" },
];

/** Tesseract language string for a choice: non-English languages are combined with English (game UI + player text). */
export function ocrLangString(code: string): string {
  if (!OCR_LANGS.some((l) => l.code === code)) return "eng";
  return code === "eng" ? "eng" : `${code}+eng`;
}

/** Best OCR language for a translation language code ("de" -> "deu"), else English. */
export function ocrCodeFor(lang: string): string {
  const base = lang.split("-")[0];
  return OCR_LANGS.find((l) => l.lang === lang)?.code || OCR_LANGS.find((l) => l.lang === base)?.code || "eng";
}

export const OCR_DATA_URL = (code: string) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`;

/** Clean up recognized text: drop empty/garbage lines, collapse spaces. */
export function cleanOcrText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l && /[\p{L}\p{N}]/u.test(l) && !/^[^\p{L}\p{N}]{0,2}.?[^\p{L}\p{N}]{0,2}$/u.test(l))
    .join("\n");
}
