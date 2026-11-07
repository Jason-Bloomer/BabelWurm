/**
 * Hand-made word tables for trade shorthand and coin names.
 *
 * Languages listed here never need a lookup; any other target language gets
 * its words machine-translated once and cached (Lexicon in pipeline.ts).
 */

export type TradeWord = "WTS" | "WTB" | "WTT" | "PC";

/**
 * What the trade prefixes at the start of a Trade-chat line mean, per target
 * language. English is absent on purpose: English readers know the shorthand,
 * so it is left as written.
 */
export const TRADE_PREFIXES: Record<string, Record<TradeWord, string>> = {
  ru: { WTS: "Продаю", WTB: "Покупаю", WTT: "Меняю", PC: "Оценка цены" },
  uk: { WTS: "Продаю", WTB: "Купую", WTT: "Обмінюю", PC: "Оцінка ціни" },
  pl: { WTS: "Sprzedam", WTB: "Kupię", WTT: "Wymienię", PC: "Wycena" },
  de: { WTS: "Verkaufe", WTB: "Suche", WTT: "Tausche", PC: "Preisfrage" },
  nl: { WTS: "Te koop", WTB: "Gezocht", WTT: "Te ruil", PC: "Prijscheck" },
  sv: { WTS: "Säljes", WTB: "Köpes", WTT: "Bytes", PC: "Priskoll" },
  pt: { WTS: "Vendo", WTB: "Compro", WTT: "Troco", PC: "Quanto vale" },
  es: { WTS: "Vendo", WTB: "Busco", WTT: "Cambio", PC: "Consulta de precio" },
  fr: { WTS: "Vends", WTB: "Achète", WTT: "Échange", PC: "Estimation" },
  it: { WTS: "Vendo", WTB: "Cerco", WTT: "Scambio", PC: "Valutazione" },
  zh: { WTS: "出售", WTB: "收购", WTT: "交换", PC: "估价" },
};

export type CurrencyUnit = "g" | "s" | "c" | "i";

/**
 * Coin names: unit -> {lang: forms}. One form for most languages. Russian and
 * Ukrainian give [form after 1, 21, 31…; form after every other number]
 * ("1 серебро", "20 серебра").
 */
export const CURRENCY_WORDS: Record<CurrencyUnit, Record<string, string[]>> = {
  g: {
    en: ["gold"], ru: ["золото", "золота"], uk: ["золото", "золота"], pl: ["złota"], de: ["Gold"], nl: ["goud"],
    sv: ["guld"], pt: ["ouro"], es: ["oro"], fr: ["or"], it: ["oro"], zh: ["金"],
  },
  s: {
    en: ["silver"], ru: ["серебро", "серебра"], uk: ["срібло", "срібла"], pl: ["srebra"], de: ["Silber"], nl: ["zilver"],
    sv: ["silver"], pt: ["prata"], es: ["plata"], fr: ["argent"], it: ["argento"], zh: ["银"],
  },
  c: {
    en: ["copper"], ru: ["медь", "меди"], uk: ["мідь", "міді"], pl: ["miedzi"], de: ["Kupfer"], nl: ["koper"],
    sv: ["koppar"], pt: ["cobre"], es: ["cobre"], fr: ["cuivre"], it: ["rame"], zh: ["铜"],
  },
  i: {
    en: ["iron"], ru: ["железо", "железа"], uk: ["залізо", "заліза"], pl: ["żelaza"], de: ["Eisen"], nl: ["ijzer"],
    sv: ["järn"], pt: ["ferro"], es: ["hierro"], fr: ["fer"], it: ["ferro"], zh: ["铁"],
  },
};

/** Languages whose coin words take the 1 / 21 / 31… form ("1 серебро") vs. the rest ("20 серебра"). */
export const TWO_FORM_LANGS = new Set(["ru", "uk"]);
