/**
 * Development aid: offline stand-in for Google/MyMemory, enabled with
 * WCT_MOCK_NET=1. Lets the whole pipeline run (tokens, glossary, currency,
 * trade prefixes) without network access — used for screenshots and smoke tests.
 * The phrase table holds real, correct translations so screenshots show what
 * the app actually produces.
 */
import type { HttpGet } from "../core/translate";

/** target language -> source phrase -> [source language, translation] */
const PHRASES: Record<string, Record<string, [string, string]>> = {
  en: {
    "Кто-нибудь знает, где купить хорошую кирку?": ["ru", "Does anyone know where to buy a good pickaxe?"],
    "Sucht jemand noch Holzfäller für sein Dorf?": ["de", "Is anyone still looking for woodcutters for their village?"],
    "Alguém quer ajudar a matar o troll perto da ponte?": ["pt", "Does anyone want to help kill the troll near the bridge?"],
    "Quelqu'un a vu le dragon près de la côte est ?": ["fr", "Has anyone seen the dragon near the east coast?"],
    "¡Gracias por la ayuda con el barco!": ["es", "Thanks for the help with the boat!"],
    "Czy ktoś sprzedaje cegły?": ["pl", "Is anyone selling bricks?"],
    "кирка 70ql,": ["ru", "pickaxe 70ql,"],
    "Ziegel, 1000 Stück, zahle": ["de", "bricks, 1000 pieces, paying"],
    "Guten Abend! Wer hat Lust auf eine Bootsfahrt?": ["de", "Good evening! Who feels like a boat trip?"],
    "Привет всем, рынок у озера открыт": ["ru", "Hi everyone, the market by the lake is open"],
    "Obrigado, até amanhã!": ["pt", "Thanks, see you tomorrow!"],
    "добрый вечер всем": ["ru", "good evening everyone"],
    "продаю": ["ru", "selling"],
    "Olá, alguém vende": ["pt", "Hi, does anyone sell"],
    "obrigado": ["pt", "thank you"],
    "Hallo zusammen": ["de", "Hello everyone"],
  },
  de: {
    "Quality: 45.27, damage: 0.00\nA large cart made from oak.\nYou need to improve it with a mallet.": [
      "en",
      "Qualität: 45,27, Schaden: 0,00\nEin großer Karren aus Eichenholz.\nDu musst ihn mit einem Holzhammer verbessern.",
    ],
  },
  ru: {
    "Yes, I can sell you one for 3 silver": ["en", "Да, могу продать тебе одну за 3 серебра"],
    "anyone selling": ["en", "кто-нибудь продаёт"],
    "rare pickaxe": ["en", "редкую кирку"],
    "good evening friends": ["en", "добрый вечер, друзья"],
    "hello": ["en", "привет"],
    "is the market open?": ["en", "рынок открыт?"],
    "Hey": ["en", "Эй"],
    "come to my": ["en", "приходи к моему"],
    "for": ["en", "за"],
    "I need": ["en", "мне нужны"],
    "bulk": ["en", "оптом"],
    "Selling\nBuying\nTrading\nPrice check": ["en", "Продам\nКуплю\nОбменяю\nПрайсчек"],
  },
};

function detect(q: string): string {
  if (/[А-Яа-яЁё]/.test(q)) return "ru";
  if (/\b(olá|alguém|obrigado|vende)\b/i.test(q)) return "pt";
  if (/\b(hallo|zusammen)\b/i.test(q)) return "de";
  return "en";
}

export const mockHttpGet: HttpGet = async (url) => {
  await new Promise((r) => setTimeout(r, 60));
  const u = new URL(url);
  if (u.pathname.endsWith("/translate_a/l")) return { status: 404, text: "" };
  const q = u.searchParams.get("q") || "";
  const tl = u.searchParams.get("tl") || (u.searchParams.get("langpair") || "|en").split("|")[1];
  const sl = u.searchParams.get("sl");
  if (tl === "it" || tl === "ar") {
    // pretend translation for interface tests: uppercase (it) / Arabic-marked (ar), placeholders kept
    const out = q.split("\n").map((l) => (l.trim() ? (tl === "it" ? `IT: ${l.toUpperCase()}` : `ع ${l}`) : l)).join("\n");
    return { status: 200, text: JSON.stringify([[[out, q, null, null]], null, sl && sl !== "auto" ? sl : detect(q)]) };
  }
  const trimmed = q.trim();
  const hit = PHRASES[tl]?.[trimmed];
  const src = sl && sl !== "auto" ? sl : hit ? hit[0] : detect(q);
  const out = src === tl ? q : q.replace(trimmed, hit ? hit[1] : trimmed);
  return { status: 200, text: JSON.stringify([[[out, q, null, null]], null, src]) };
};
