/**
 * The built-in Wurm glossary, written for BabelWurm.
 *
 * Columns: English term (in the form it should be written), then its
 * translation into ru, de, pt, es, fr and pl. "=" keeps the English form in
 * that language (acronyms, names and game words players use untranslated);
 * an empty string means "no entry for that language".
 *
 * Short entries that are real words in a target language get no entry for
 * that language: the post-pass would otherwise rewrite them in translations.
 *
 * Matching is whole-word and case-insensitive, so "wts", "WTS" and "Wts" all
 * hit the "WTS" row. Users edit their own copy (babelwurm_glossary.json);
 * this table is only written when that file doesn't exist yet.
 */
import type { GlossaryItem } from "./glossary";

const LANGS = ["ru", "de", "pt", "es", "fr", "pl"] as const;
type Row = [en: string, ru: string, de: string, pt: string, es: string, fr: string, pl: string];

const ROWS: Row[] = [
  // ── Trade shorthand ──
  ["WTS", "Продаю", "Verkaufe", "Vendo", "Vendo", "Vends", "Sprzedam"],
  ["WTB", "Покупаю", "Suche", "Compro", "Busco", "Achète", "Kupię"],
  ["WTT", "Меняю", "Tausche", "Troco", "Cambio", "Échange", "Wymienię"],
  ["PC", "Оценка цены", "Preisfrage", "Quanto vale", "Consulta de precio", "Estimation", "Wycena"],
  ["WTA", "Аукцион", "Auktion", "Leilão", "Subasta", "Enchères", "Aukcja"],
  ["OBO", "или ваша цена", "oder bestes Angebot", "ou melhor oferta", "o mejor oferta", "ou meilleure offre", "lub najlepsza oferta"],
  ["neg", "торг уместен", "verhandelbar", "negociável", "negociable", "négociable", "do negocjacji"],
  ["ea", "за штуку", "pro Stück", "cada", "cada uno", "l'unité", "za sztukę"],
  ["COD", "оплата при получении", "Zahlung bei Lieferung", "pagamento na entrega", "pago contra entrega", "paiement à la livraison", "płatność przy odbiorze"],
  ["BO", "выкуп", "Sofortkauf", "compra imediata", "compra directa", "achat immédiat", ""], // "bo" is a Polish word
  ["pm", "в личку", "per PN", "no privado", "por privado", "en MP", "na priv"],
  ["LF", "ищу", "suche", "procuro", "busco", "cherche", "szukam"],

  // ── Chat shorthand ──
  ["ty", "спасибо", "danke", "obrigado", "gracias", "merci", ""], // "ty" is a Polish word
  ["thx", "спасибо", "danke", "obrigado", "gracias", "merci", "dzięki"],
  ["tyvm", "большое спасибо", "vielen Dank", "muito obrigado", "muchas gracias", "merci beaucoup", "wielkie dzięki"],
  ["np", "без проблем", "kein Problem", "sem problema", "no hay problema", "pas de souci", ""], // "np" is a Polish abbreviation
  ["nvm", "неважно", "vergiss es", "deixa pra lá", "da igual", "laisse tomber", "nieważne"],
  ["btw", "кстати", "übrigens", "aliás", "por cierto", "au fait", "przy okazji"],
  ["brb", "сейчас вернусь", "bin gleich zurück", "já volto", "ahora vuelvo", "je reviens", "zaraz wracam"],
  ["bbl", "вернусь позже", "komme später wieder", "volto mais tarde", "vuelvo más tarde", "je reviens plus tard", "wrócę później"],
  ["gtg", "мне пора", "muss los", "tenho que ir", "me tengo que ir", "je dois y aller", "muszę lecieć"],
  ["omw", "уже иду", "bin unterwegs", "tô indo", "voy de camino", "j'arrive", "już idę"],
  ["wb", "с возвращением", "willkommen zurück", "bem-vindo de volta", "bienvenido de nuevo", "content de te revoir", "witaj z powrotem"],
  ["pls", "пожалуйста", "bitte", "por favor", "por favor", "s'il te plaît", "proszę"],
  ["plz", "пожалуйста", "bitte", "por favor", "por favor", "s'il te plaît", "proszę"],
  ["imo", "по-моему", "meiner Meinung nach", "na minha opinião", "en mi opinión", "à mon avis", "moim zdaniem"],
  ["imho", "по-моему", "meiner Meinung nach", "na minha opinião", "en mi opinión", "à mon avis", "moim zdaniem"],
  ["idk", "не знаю", "keine Ahnung", "não sei", "no sé", "je ne sais pas", "nie wiem"],
  ["iirc", "если я правильно помню", "wenn ich mich recht erinnere", "se não me engano", "si no recuerdo mal", "si je me souviens bien", "jeśli dobrze pamiętam"],
  ["irl", "в реальной жизни", "im echten Leben", "na vida real", "en la vida real", "dans la vraie vie", "w realu"],
  ["atm", "сейчас", "gerade", "no momento", "ahora mismo", "en ce moment", "w tej chwili"],
  ["rn", "прямо сейчас", "gerade", "agora", "ahora", "là maintenant", "teraz"],
  ["asap", "как можно скорее", "so schnell wie möglich", "o quanto antes", "lo antes posible", "dès que possible", "jak najszybciej"],
  ["ofc", "конечно", "natürlich", "claro", "claro", "bien sûr", "oczywiście"],
  ["tbh", "честно говоря", "ehrlich gesagt", "sinceramente", "la verdad", "honnêtement", "szczerze mówiąc"],
  ["ppl", "люди", "Leute", "pessoal", "gente", "les gens", "ludzie"],
  ["gz", "поздравляю", "Glückwunsch", "parabéns", "felicidades", "félicitations", "gratulacje"],
  ["grats", "поздравляю", "Glückwunsch", "parabéns", "felicidades", "félicitations", "gratulacje"],
  ["gratz", "поздравляю", "Glückwunsch", "parabéns", "felicidades", "félicitations", "gratulacje"],
  ["AFK", "=", "=", "=", "=", "=", "="],
  ["noob", "нуб", "Noob", "noob", "novato", "noob", "nowy"],
  ["PvP", "=", "=", "=", "=", "=", "="],
  ["PvE", "=", "=", "=", "=", "=", "="],

  // ── Quality, skills and stats ──
  ["ql", "=", "=", "=", "=", "=", "="],
  ["dmg", "урон", "Schaden", "dano", "daño", "dégâts", "obrażenia"],
  ["rare", "редкий", "selten", "raro", "raro", "rare", "rzadki"],
  ["supreme", "высший", "überragend", "supremo", "supremo", "suprême", "najwyższy"],
  ["fantastic", "фантастический", "fantastisch", "fantástico", "fantástico", "fantastique", "fantastyczny"],
  ["imp", "улучшение", "Verbesserung", "melhoria", "mejora", "amélioration", "ulepszanie"],
  ["grind", "гринд", "Grinden", "grind", "grindeo", "grind", "grind"],
  ["SB", "бонус сна", "Schlafbonus", "bônus de sono", "bonificación de sueño", "bonus de sommeil", "bonus snu"],
  ["sleep bonus", "бонус сна", "Schlafbonus", "bônus de sono", "bonificación de sueño", "bonus de sommeil", "bonus snu"],
  ["sleep powder", "сонный порошок", "Schlafpulver", "pó do sono", "polvo de sueño", "poudre de sommeil", "proszek snu"],
  ["FS", "боевой навык", "Kampffertigkeit", "habilidade de luta", "habilidad de combate", "compétence de combat", "umiejętność walki"],
  ["affinity", "аффинити", "Affinität", "afinidade", "afinidad", "affinité", "powinowactwo"],
  ["aff", "аффинити", "Affinität", "afinidade", "afinidad", "affinité", "powinowactwo"],
  ["CCFP", "=", "=", "=", "=", "=", "="],
  ["ench", "зачарование", "Verzauberung", "encantamento", "encantamiento", "enchantement", "zaklęcie"],
  ["favor", "фавор", "Gunst", "favor", "favor", "faveur", "łaska"],
  ["favour", "фавор", "Gunst", "favor", "favor", "faveur", "łaska"],
  ["sermon", "проповедь", "Predigt", "sermão", "sermón", "sermon", "kazanie"],
  ["rune", "руна", "Rune", "runa", "runa", "rune", "runa"],

  // ── Enchantments (spell names stay in English, the game has no other) ──
  ["CoC", "=", "=", "=", "=", "=", "="],
  ["WoA", "=", "=", "=", "=", "=", "="],
  ["BotD", "=", "=", "=", "=", "=", "="],
  ["AoSP", "=", "=", "=", "=", "=", "="],
  ["LT", "=", "=", "=", "=", "=", "="],
  ["FA", "=", "=", "=", "=", "=", "="],
  ["nimb", "=", "=", "=", "=", "=", "="],

  // ── Settlements and people ──
  ["deed", "деревня", "Siedlung", "vila", "aldea", "village", "osada"],
  ["token", "токен", "Token", "token", "token", "token", "token"],
  ["guard tower", "сторожевая башня", "Wachturm", "torre de guarda", "torre de guardia", "tour de garde", "wieża strażnicza"],
  ["guard", "стражник", "Wache", "guarda", "guardia", "garde", "strażnik"],
  ["guards", "стража", "Wachen", "guardas", "guardias", "gardes", "strażnicy"],
  ["spirit templar", "храмовник духа", "Geistertempler", "templário espiritual", "templario espiritual", "templier spirituel", "duchowy templariusz"],
  ["mailbox", "почтовый ящик", "Briefkasten", "caixa de correio", "buzón", "boîte aux lettres", "skrzynka pocztowa"],
  ["trader", "торговец", "Händler", "comerciante", "comerciante", "marchand", "handlarz"],
  ["merchant", "купец", "Kaufmann", "mercador", "mercader", "négociant", "kupiec"],
  ["priest", "жрец", "Priester", "sacerdote", "sacerdote", "prêtre", "kapłan"],
  ["HotA", "=", "=", "=", "=", "=", "="],
  ["HotS", "=", "=", "=", "=", "=", "="],

  // ── Gods ──
  ["Fo", "Фо", "=", "=", "=", "=", "="],
  ["Vynora", "Винора", "=", "=", "=", "=", "="],
  ["Magranon", "Магранон", "=", "=", "=", "=", "="],
  ["Libila", "Либила", "=", "=", "=", "=", "="],

  // ── Storage, vehicles and ships ──
  ["BSB", "=", "=", "=", "=", "=", "="],
  ["FSB", "=", "=", "=", "=", "=", "="],
  ["larder", "кладовая", "Speisekammer", "despensa", "despensa", "garde-manger", "spiżarnia"],
  ["crate", "ящик", "Kiste", "caixote", "caja", "caisse", "skrzynia"],
  ["wagon", "фургон", "Wagen", "carroça", "carreta", "chariot", "wóz"],
  ["large cart", "большая телега", "großer Karren", "carroça grande", "carro grande", "grande charrette", "duży wózek"],
  ["small cart", "малая тележка", "kleiner Karren", "carroça pequena", "carro pequeño", "petite charrette", "mały wózek"],
  ["rowing boat", "гребная лодка", "Ruderboot", "barco a remo", "bote de remos", "barque", "łódź wiosłowa"],
  ["sailing boat", "парусная лодка", "Segelboot", "barco a vela", "velero", "voilier", "żaglówka"],
  ["knarr", "кнарр", "Knorr", "=", "=", "=", "knara"],
  ["cog", "ког", "Kogge", "coca", "coca", "cogue", "koga"],
  ["caravel", "каравелла", "Karavelle", "caravela", "carabela", "caravelle", "karawela"],
  ["corbita", "корбита", "=", "=", "=", "=", "="],

  // ── Materials and building ──
  ["wemp", "вемп", "=", "=", "=", "=", "="],
  ["glimmersteel", "глиммерсталь", "=", "=", "=", "=", "="],
  ["glim", "глим", "=", "=", "=", "=", "="],
  ["seryll", "серилл", "=", "=", "=", "=", "="],
  ["adamantine", "адамантин", "Adamantin", "adamantina", "adamantina", "adamantine", "adamantyn"],
  ["moonmetal", "лунный металл", "Mondmetall", "metal lunar", "metal lunar", "métal lunaire", "księżycowy metal"],
  ["electrum", "электрум", "Elektrum", "electrum", "electrum", "électrum", "elektrum"],
  ["lump", "слиток", "Klumpen", "lingote", "lingote", "lingot", "sztabka"],
  ["nails", "гвозди", "Nägel", "pregos", "clavos", "clous", "gwoździe"],
  ["plank", "доска", "Brett", "tábua", "tablón", "planche", "deska"],
  ["planks", "доски", "Bretter", "tábuas", "tablones", "planches", "deski"],
  ["shaft", "древко", "Schaft", "haste", "astil", "manche", "drzewce"],
  ["brick", "кирпич", "Ziegel", "tijolo", "ladrillo", "brique", "cegła"],
  ["bricks", "кирпичи", "Ziegel", "tijolos", "ladrillos", "briques", "cegły"],
  ["mortar", "раствор", "Mörtel", "argamassa", "mortero", "mortier", "zaprawa"],
  ["slab", "плита", "Platte", "laje", "losa", "dalle", "płyta"],
  ["clay", "глина", "Ton", "argila", "arcilla", "argile", "glina"],
  ["tar", "смола", "Teer", "piche", "brea", "goudron", "smoła"],
  ["peat", "торф", "Torf", "turfa", "turba", "tourbe", "torf"],
  ["dirt", "земля", "Erde", "terra", "tierra", "terre", "ziemia"],
  ["rock shards", "осколки камня", "Steinsplitter", "lascas de pedra", "fragmentos de roca", "éclats de roche", "odłamki skał"],
  ["cotton", "хлопок", "Baumwolle", "algodão", "algodón", "coton", "bawełna"],
  ["forge", "горн", "Schmiede", "forja", "forja", "forge", "kuźnia"],
  ["kiln", "печь для обжига", "Brennofen", "forno de cerâmica", "horno de alfarero", "four à céramique", "piec do wypału"],
  ["smelter", "плавильня", "Schmelzofen", "fundição", "fundición", "fonderie", "huta"],

  // ── Woods ──
  ["birchwood", "берёза", "Birkenholz", "bétula", "abedul", "bouleau", "brzoza"],
  ["pinewood", "сосна", "Kiefernholz", "pinho", "pino", "pin", "sosna"],
  ["oakenwood", "дуб", "Eichenholz", "carvalho", "roble", "chêne", "dąb"],
  ["cedarwood", "кедр", "Zedernholz", "cedro", "cedro", "cèdre", "cedr"],
  ["maplewood", "клён", "Ahornholz", "bordo", "arce", "érable", "klon"],
  ["applewood", "яблоня", "Apfelholz", "macieira", "manzano", "pommier", "jabłoń"],
  ["lemonwood", "лимонное дерево", "Zitronenholz", "limoeiro", "limonero", "citronnier", "drewno cytrynowe"],
  ["olivewood", "олива", "Olivenholz", "oliveira", "olivo", "olivier", "oliwka"],
  ["cherrywood", "вишня", "Kirschholz", "cerejeira", "cerezo", "cerisier", "wiśnia"],
  ["firwood", "пихта", "Tannenholz", "abeto", "abeto", "sapin", "jodła"],
  ["lindenwood", "липа", "Lindenholz", "tília", "tilo", "tilleul", "lipa"],

  // ── Creatures ──
  ["hell horse", "адская лошадь", "Höllenpferd", "cavalo infernal", "caballo infernal", "cheval infernal", "piekielny koń"],
  ["hell hound", "адская гончая", "Höllenhund", "cão infernal", "sabueso infernal", "chien infernal", "piekielny ogar"],
  ["lava spider", "лавовый паук", "Lavaspinne", "aranha de lava", "araña de lava", "araignée de lave", "pająk lawowy"],
  ["drake", "дрейк", "=", "=", "=", "=", "="],
  ["unique", "уник", "Unique", "unique", "unique", "unique", "unikat"],
];

export const DEFAULT_GLOSSARY: GlossaryItem[] = ROWS.map((row) => {
  const item: GlossaryItem = { en: row[0] };
  LANGS.forEach((lang, i) => {
    const v = row[i + 1];
    if (v) item[lang] = v === "=" ? row[0] : v;
  });
  return item;
});
