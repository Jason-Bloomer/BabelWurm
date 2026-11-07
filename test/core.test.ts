/**
 * Core tests: chat parsing, the translation pipeline, glossary, currency,
 * alerts, config, the watcher, the 429 kill-switch and interface strings.
 * Network is faked: the fake Google wraps text as T[...] and reports the
 * detected language (Cyrillic -> ru, else en).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { AlertMatcher, channelFlag, mentionedIn, ruleSoundId, setChannelFlag, type AlertRule } from "../src/core/alerts";
import { RE_LANG_CHANNEL, channelFromFileName, languageOfChannel, parseChatLine, sortChannels } from "../src/core/channels";
import { Engine, type ChatMessage, type EngineEvent } from "../src/core/engine";
import { ConfigStore, defaultConfig } from "../src/core/config";
import { currencyProtect, currencyRestore } from "../src/core/currency";
import { characterFromLogsPath } from "../src/core/discovery";
import { DEFAULT_GLOSSARY, Glossary, glossaryRestore } from "../src/core/glossary";
import { I18N, UI_LANGS, isRtl, resolveUiLang, setMachineStrings, translate } from "../src/core/i18n";
import { decode, hashStrings, translateUiStrings } from "../src/core/uiTranslate";
import { chooseScale, encodePngGray, prepareForOcr } from "../src/core/ocrPrep";
import { cleanOcrText, ocrCodeFor, ocrLangString } from "../src/core/ocrLangs";
import { canonicalLang, languageName, nativeName, parseGoogleLanguageList, sameLanguage } from "../src/core/languages";
import { Lexicon, Pipeline } from "../src/core/pipeline";
import { Translator, type HttpGet } from "../src/core/translate";
import { COLD_AFTER_MS, COLD_CHECK_MS, LogWatcher, type RawLine } from "../src/core/watcher";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wct-test-"));

interface Fake {
  get: HttpGet;
  queries: string[];
  status: { gtx: number };
}

function fakeNet(): Fake {
  const queries: string[] = [];
  const status = { gtx: 200 };
  const get: HttpGet = async (url) => {
    const u = new URL(url);
    if (u.hostname === "translate.googleapis.com") {
      if (status.gtx !== 200) return { status: status.gtx, text: "" };
      const q = u.searchParams.get("q")!;
      const tl = u.searchParams.get("tl")!;
      queries.push(q);
      const src = u.searchParams.get("sl") !== "auto" ? u.searchParams.get("sl") : /[А-Яа-яЁё]/.test(q) ? "ru" : "en";
      // like the real endpoint, every line is translated separately and newlines are kept
      const out = src === tl ? q : q.split("\n").map((l) => `T[${l.trim()}]`).join("\n");
      return { status: 200, text: JSON.stringify([[[out, q, null, null]], null, src]) };
    }
    if (u.hostname === "api.mymemory.translated.net") {
      const q = u.searchParams.get("q")!;
      return { status: 200, text: JSON.stringify({ responseStatus: 200, responseData: { translatedText: `M[${q}]`, detectedLanguage: "en" } }) };
    }
    return { status: 404, text: "" };
  };
  return { get, queries, status };
}

function makePipeline(net = fakeNet()) {
  const translator = new Translator(net.get);
  const glossary = new Glossary(path.join(tmp, `glossary-${Math.random()}.json`));
  const lexicon = new Lexicon(null, translator);
  return { pipeline: new Pipeline(translator, glossary, lexicon, async () => {}), translator, glossary, net };
}

const opts = (targetLang = "ru") => ({ translate: true, targetLang, translateLangChannels: false, translateCurrency: true });

test("parse chat lines", () => {
  const cases: Array<[string, unknown]> = [
    ["[19:13:45] <Valerius> guards!", { time: "19:13:45", name: "Valerius", text: "guards!" }],
    ["[19:10:53] <Spirit templar> I'll take care of aged troll!", { time: "19:10:53", name: "Spirit templar", text: "I'll take care of aged troll!" }],
    ["[2026-10-10 17:02:17] <Liel> диоптра собралась", { time: "17:02:17", name: "Liel", text: "диоптра собралась" }],
    ["[17:38:41] Valerius has reached 30 Longsword!", { time: "17:38:41", name: null, text: "Valerius has reached 30 Longsword!" }],
    ["[21:42:03] PlayerOne: hello there", { time: "21:42:03", name: "PlayerOne", text: "hello there" }],
    ["Logging started 2026-10-03", null],
    ["[17:33:11] ", null],
  ];
  for (const [line, want] of cases) assert.deepEqual(parseChatLine(line), want, line);
});

test("trade prefixes per language, server tag, any case", async () => {
  const { pipeline } = makePipeline();
  const r = async (s: string, dst = "ru") => (await pipeline.translateTradeBody(s, dst)).translated!;
  assert.ok((await r("WTS rare pickaxe, 5s")).startsWith("Продаю"));
  assert.ok((await r("wtb: bulk cotton")).startsWith("Покупаю"));
  assert.ok((await r("PC on a rare hammer")).startsWith("Оценка цены"));
  assert.ok((await r("(Cad) WTS wemp, cotton, barley")).startsWith("(Cad) Продаю"));
  assert.ok((await r("(Mel) wtb rare leather cap")).includes("(Mel) Покупаю"));
  assert.ok((await r("(Xan) WTT rare sword for axe")).includes("(Xan) Меняю"));
  assert.ok((await r("WTB rare longsword", "pt")).startsWith("Compro"));
  assert.ok((await r("(Cad) wts deed", "de")).startsWith("(Cad) Verkaufe"));
  const only = await pipeline.translateTradeBody("WTS", "pt");
  assert.equal(only.translated, "Vendo");
  assert.equal(only.srcLang, "en");
  // Russian rest is not translated
  assert.equal(await r("WTS кедр"), "Продаю кедр (ru)");
});

test("trade prefixes for languages without a hand table are machine-translated once", async () => {
  const { pipeline } = makePipeline();
  const res = await pipeline.translateMessage("WTS sword", "Trade", opts("hu"));
  assert.match(res.translated!, /^T\[Selling\]/);
  // a second message reuses the cached words
  const res2 = await pipeline.translateMessage("WTB axe", "Trade", opts("hu"));
  assert.match(res2.translated!, /^T\[Buying\]/);
});

test("only a <Name>: no language tail", async () => {
  const { pipeline } = makePipeline();
  const r = await pipeline.translatePreservingNames("<Solo>", "ru");
  assert.equal(r.translated, "<Solo>");
  assert.equal(r.srcLang, null);
});

test("names and tokens never reach the translator", async () => {
  const { pipeline, net } = makePipeline();
  const res = await pipeline.translateMessage("hello <Bob> I sell nails for 2g 50s", "Local", opts("ru"));
  for (const q of net.queries) assert.ok(!q.includes("<"), `token leaked: ${q}`);
  assert.ok(res.translated!.includes("<Bob>"));
  assert.ok(res.translated!.includes("гвозди"), res.translated!);
  assert.ok(res.translated!.includes("2 золота, 50 серебра"), res.translated!);
  assert.ok(res.translated!.endsWith("(en)"));
  assert.equal(res.srcLang, "en");
});

test("message already in the target language is not translated", async () => {
  const { pipeline, net } = makePipeline();
  const r = await pipeline.translateMessage("уже русский текст", "Local", opts("ru"));
  assert.deepEqual(r, { translated: "уже русский текст", srcLang: "ru" });
  assert.equal(net.queries.length, 0);
  // generic path (no script hint): detected == target
  const r2 = await pipeline.translateMessage("hello there", "Local", opts("en"));
  assert.deepEqual(r2, { translated: "hello there", srcLang: "en" });
  // currency is still spelled out
  const r3 = await pipeline.translateMessage("продам меч 20s", "Local", opts("ru"));
  assert.equal(r3.translated, "продам меч 20 серебра");
});

test("language channels are shown as is unless enabled", async () => {
  const { pipeline } = makePipeline();
  const r = await pipeline.translateMessage("hello 20s", "Russian GL", opts("ru"));
  assert.deepEqual(r, { translated: "hello 20s", srcLang: null });
  const r2 = await pipeline.translateMessage("hello", "Russian GL", { ...opts("ru"), translateLangChannels: true });
  assert.equal(r2.translated, "T[hello] (en)");
  assert.ok(RE_LANG_CHANNEL.test("Russian GL") && RE_LANG_CHANNEL.test("english gl"));
  assert.ok(!RE_LANG_CHANNEL.test("GL-Freedom") && !RE_LANG_CHANNEL.test("Local"));
});

test("translation off -> null (original shown)", async () => {
  const { pipeline } = makePipeline();
  const r = await pipeline.translateMessage("hello", "Local", { ...opts("ru"), translate: false });
  assert.equal(r.translated, null);
});

test("preview (glossary editor)", async () => {
  const { pipeline } = makePipeline();
  assert.deepEqual(await pipeline.preview("уже русский текст без терминов", "ru"), { translated: "уже русский текст без терминов", srcLang: "ru" });
  assert.deepEqual(await pipeline.preview("", "ru"), { translated: "", srcLang: null });
  const p = await pipeline.preview("WTS rare pickaxe", "ru");
  assert.ok(p.translated!.startsWith("Продаю"));
});

test("glossary reverse protection for the reply panel (ru -> en)", () => {
  const g = new Glossary(path.join(tmp, "g-rev.json"));
  const { text, terms } = g.protectReverse("продаю гвозди и вемп", "ru");
  assert.equal(terms.length, 3);
  assert.ok(!/гвозди|вемп/.test(text));
  const restored = glossaryRestore(`I sell ${terms.find((t) => t[1] === "nails")![0]} and ${terms.find((t) => t[1] === "wemp")![0]}`, terms);
  assert.ok(restored.includes("nails") && restored.includes("wemp"), restored);
});

test("reply translation applies glossary in both directions", async () => {
  const { pipeline } = makePipeline();
  const out = await pipeline.translateReply("продаю вемп", "ru", "en");
  assert.ok(out!.includes("wemp"), out!);
  assert.equal(await pipeline.translateReply("same", "en", "en"), "same");
});

test("glossary file, post-pass and live reload", () => {
  const file = path.join(tmp, "g-main.json");
  const g = new Glossary(file);
  assert.equal(g.entries("ru").length, DEFAULT_GLOSSARY.length);
  assert.ok(fs.existsSync(file));
  const cases: Array<[string, string]> = [
    ["Продается deed, содержание 20 серебра", "деревня"],
    ["тролль рядом с guard tower, будь осторожен", "сторожевая башня"],
    ["wemp и хлопок оптом", "вемп"],
    ["Glimmersteel слиток 95ql", "глиммерсталь"],
    ["spirit templar убил тролля", "храмовник духа"],
    ["нужен favour для зачарования", "фавор"],
  ];
  for (const [src, want] of cases) assert.ok(g.fixForward(src, "ru").includes(want), src);
  const en = g.fixReverse("продаю кедр и вемп за фавор", "ru");
  for (const w of ["cedarwood", "wemp", "favour"]) assert.ok(en.includes(w), en);
  // external edit picked up without restart (mtime)
  const raw = g.rawItems();
  fs.writeFileSync(file, JSON.stringify([...raw, { en: "zzzcacheprobe", ru: "тесткэша" }]));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(file, future, future);
  assert.ok(g.entries("ru").some((e) => e.en === "zzzcacheprobe"));
  // other languages work the same way
  g.saveItems([...raw, { en: "deed", de: "Siedlung" }]);
  assert.equal(g.fixForward("my deed", "de"), "my Siedlung");
  assert.ok(g.hasLanguage("de") && !g.hasLanguage("fi"));
});

test("glossary protect keeps trade prefixes and word boundaries", () => {
  const g = new Glossary(path.join(tmp, "g-prot.json"));
  const { text, terms } = g.protect("wts nails for nailsmith", "ru");
  assert.ok(terms.length > 0);
  assert.ok(!/(?<![\w])nails(?![\w])/i.test(text));
  assert.ok(text.includes("nailsmith"));
  assert.ok(/(?<![\w])wts(?![\w])/i.test(text));
  const got = glossaryRestore(text.replace(terms[0][0], "гвозди"), terms);
  assert.ok(got.startsWith("wts гвозди"), got);
});

test("currency", () => {
  const cases: Array<[string, string, string]> = [
    ["WTS rare sword 20s", "ru", "20 серебра"],
    ["WTS rare sword 20s", "en", "20 silver"],
    ["price 2g 50s 30c 40i", "ru", "2 золота, 50 серебра, 30 меди, 40 железа"],
    ["price 2g 50s 30c 40i", "de", "2 Gold, 50 Silber, 30 Kupfer, 40 Eisen"],
    ["1g", "ru", "1 золото"],
    ["11s", "ru", "11 серебра"],
    ["21i", "ru", "21 железо"],
    ["20 seconds", "ru", "20 seconds"],
  ];
  for (const [phrase, lang, want] of cases) {
    const p = currencyProtect(phrase);
    assert.ok(currencyRestore(p.text, p.amounts, lang).includes(want), `${phrase} ${lang}`);
  }
  const p = currencyProtect("price 2g 50s 30c 40i");
  assert.ok(currencyRestore(p.text, p.amounts, null).includes("2g, 50s, 30c, 40i"));
  // eaten spaces restored
  const q = currencyProtect("sword 20s");
  assert.equal(currencyRestore("меч" + q.text.slice(6), q.amounts, "ru"), "меч 20 серебра");
});

test("alerts: matching, channels, legacy format, throttle", () => {
  let now = 1_000_000;
  const m = new AlertMatcher(() => now);
  const rules: AlertRule[] = [
    { id: "a", channels: ["Local"], pattern: "Complete the Location Details", enabled: true, sound: true, notify: true },
    { id: "b", channels: [], pattern: "wtb", enabled: true },
    { id: "c", channels: ["Trade"], pattern: "выключено", enabled: false },
    { id: "d", channels: ["Local", "Village"], pattern: "много каналов", enabled: true },
    { id: "e", channel: "GL", pattern: "наследие", enabled: true },
  ];
  assert.equal(m.match(rules, "Local", "You complete the location details.", null).length, 1);
  assert.equal(m.match(rules, "Local", "x", "WTB rare sword").length, 1);
  m.reset();
  assert.equal(m.match(rules, "Village", "wtb", null).length, 1);
  assert.equal(m.match(rules, "Village", "complete the location", null).length, 0);
  assert.equal(m.match(rules, "Village", "есть много каналов тут", null).length, 1);
  assert.equal(m.match(rules, "Local", "много каналов", null).length, 1);
  assert.equal(m.match(rules, "GL", "наследие старого формата", null).length, 1);
  assert.equal(m.match(rules, "Trade", "выключено правило", null).length, 0);
  m.reset();
  assert.equal(m.match(rules, "Local", "complete the location details", null).length, 1);
  assert.equal(m.match(rules, "Local", "complete the location details", null).length, 0);
  now += 10_001;
  assert.equal(m.match(rules, "Local", "complete the location details", null).length, 1);
  // same pattern in two rules: each has its own throttle window
  const dup: AlertRule[] = [
    { id: "x", channels: ["Local"], pattern: "complete the location details" },
    { id: "y", channels: ["Event"], pattern: "complete the location details" },
  ];
  assert.equal(m.match(dup, "Local", "complete the location details", null).length, 1);
  assert.equal(m.match(dup, "Event", "complete the location details", null).length, 1);
});

test("default config: archaeology alert, quiet channels", () => {
  const cfg = defaultConfig();
  assert.equal(cfg.alerts.length, 1);
  const a = cfg.alerts[0];
  assert.deepEqual(a.channels, ["Event"]);
  assert.equal(a.pattern, "complete the location details");
  assert.ok(a.enabled && a.sound && a.notify);
  assert.ok(!channelFlag(null, "Local") && !channelFlag([], "Trade"));
  let l = setChannelFlag([], "Trade", true);
  assert.ok(channelFlag(l, "Trade") && !channelFlag(l, "Local"));
  l = setChannelFlag(l, "Trade", false);
  assert.ok(!channelFlag(l, "Trade"));
});

test("config store: legacy migration, ids, note", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "cfg-"));
  fs.writeFileSync(path.join(dir, "wurm_chat_gui_config.json"), JSON.stringify({ logs_dir: "C:\\Wurm\\players\\Bob\\logs", translate: false }));
  const s = new ConfigStore(dir);
  assert.deepEqual(s.cfg.clients, [{ name: "Bob", path: "C:\\Wurm\\players\\Bob\\logs" }]);
  assert.equal(s.cfg.translate, false);
  assert.ok(s.cfg.alerts[0].id);
  assert.ok(s.cfg.alerts[0].note);
  const s2 = new ConfigStore(dir);
  assert.equal(s2.cfg.alerts[0].id, s.cfg.alerts[0].id);
});

test("rule sound: own sound wins over channel sound", () => {
  assert.equal(ruleSoundId([{ sound: true, sound_id: "bell" }], "chime"), "bell");
  assert.equal(ruleSoundId([{ sound: true }], "chime"), "chime");
  assert.equal(ruleSoundId([{ sound: true, sound_id: "zzz" }], "chime"), "chime");
  assert.equal(ruleSoundId([], "chime"), "chime");
});

test("mentions: word boundaries, case, empty values", () => {
  assert.ok(mentionedIn("Valerius, come here!", "Valerius"));
  assert.ok(mentionedIn("valerius приди", "Valerius"));
  assert.ok(!mentionedIn("ValeriusSecond хай", "Valerius"));
  assert.ok(!mentionedIn("привет всем", "Valerius"));
  assert.ok(!mentionedIn("ку-ку", ""));
  assert.ok(!mentionedIn(null, "Valerius"));
  assert.equal(characterFromLogsPath("C:\\x\\players\\Bob\\logs"), "Bob");
  assert.equal(characterFromLogsPath("/home/u/wurm/players/Al/logs/"), "Al");
});

test("i18n: every interface language has every key", () => {
  const ref = new Set(Object.keys(I18N.en));
  for (const l of UI_LANGS) {
    const keys = new Set(Object.keys(I18N[l]));
    const missing = [...ref].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !ref.has(k));
    assert.deepEqual([missing, extra], [[], []], l);
    assert.notEqual(translate(l, "btn_stop"), "btn_stop");
  }
  assert.equal(resolveUiLang("auto", "pt-PT"), "pt");
  assert.equal(resolveUiLang("auto", "ja"), "ja", "any language: machine-translated interface");
  assert.equal(resolveUiLang("auto", "zh-TW"), "zh");
  assert.equal(resolveUiLang("de", "ja"), "de");
  assert.equal(translate("en", "status_running", { n: 3, backend: "x" }), "Running, 3 messages so far. x");
});

test("languages: aliases, names, Google list", () => {
  assert.equal(canonicalLang("iw"), "he");
  assert.equal(canonicalLang("zh-CN"), "zh");
  assert.equal(canonicalLang("zh-tw"), "zh-TW");
  assert.ok(sameLanguage("pt", "pt-PT") && !sameLanguage("en", "ru"));
  assert.equal(languageName("ru", "en"), "Russian");
  assert.equal(nativeName("ru"), "Русский");
  assert.equal(nativeName("de"), "Deutsch");
  assert.deepEqual(parseGoogleLanguageList({ sl: { auto: "Detect" }, tl: { af: "Afrikaans", xx: "New" } }), [
    { code: "af", name: "Afrikaans" },
    { code: "xx", name: "New" },
  ]);
});

test("translator: 429 kill-switch falls back to MyMemory", async () => {
  const net = fakeNet();
  let now = 0;
  const t = new Translator(net.get, () => now);
  net.status.gtx = 429;
  for (let i = 0; i < 3; i++) {
    const r = await t.translate("hello", "ru");
    assert.equal(r.text, "M[hello]");
    assert.equal(t.backend, "fallback");
  }
  assert.ok(t.googleCoolingDown);
  net.status.gtx = 200;
  assert.equal((await t.translate("hello", "ru")).text, "M[hello]"); // still banned
  now += 1801 * 1000;
  assert.equal((await t.translate("hello", "ru")).text, "T[hello]");
  assert.equal(t.backend, "gtx");
});

test("watcher: start at end, partial lines, new files, UTF-8 split, rewrite", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "logs-"));
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const local = path.join(dir, `_Local.${month}.txt`);
  fs.writeFileSync(local, "[10:00:00] <Old> old history\n");
  const got: RawLine[] = [];
  const w = new LogWatcher(dir, 3, (l) => got.push(l));
  w.start(true);
  w.stop(); // drive scans by hand
  await w.scanOnce();
  assert.equal(got.length, 0, "old history skipped");
  fs.appendFileSync(local, "[10:00:01] <A> hello\n[10:00:02] <B> parti");
  await w.scanOnce();
  assert.deepEqual(got.map((g) => g.line), ["[10:00:01] <A> hello"]);
  assert.equal(got[0].clientIdx, 3);
  assert.equal(got[0].channel, "Local");
  // UTF-8 character split across writes
  const bytes = Buffer.from("al привет\n", "utf-8");
  fs.appendFileSync(local, bytes.subarray(0, 5));
  await w.scanOnce();
  fs.appendFileSync(local, bytes.subarray(5));
  await w.scanOnce();
  assert.equal(got[1].line, "[10:00:02] <B> partial привет");
  // a PM file that appears later is read from the start
  fs.writeFileSync(path.join(dir, `PM__Friend.${month}.txt`), "[10:01:00] <Friend> hi there\nLogging started\n");
  await w.scanOnce();
  assert.equal(got[2].channel, "PM");
  assert.equal(got.length, 3, "non-chat lines skipped");
  // file rewritten (smaller) -> read from the start
  fs.writeFileSync(local, "[11:00:00] <C> new\n");
  await w.scanOnce();
  assert.equal(got[3].line, "[11:00:00] <C> new");
});

test("unchanged translation is shown as is, without a language tail", async () => {
  const net = fakeNet();
  const echo: HttpGet = async (url) => {
    const u = new URL(url);
    const q = u.searchParams.get("q")!;
    return { status: 200, text: JSON.stringify([[[q, q]], null, "en"]) };
  };
  const translator = new Translator(echo);
  const p = new Pipeline(translator, new Glossary(null), new Lexicon(null, translator), async () => {});
  const r = await p.translateMessage("XYZ:99 ABC:0.0", "Local", opts("ru"));
  assert.deepEqual(r, { translated: "XYZ:99 ABC:0.0", srcLang: null });
  // tokens don't get extra spaces around them
  const r2 = await p.translateMessage("ql:99 dmg", "Local", opts("ru"));
  assert.equal(r2.translated, "ql:99 урон");
  void net;
});

test("lexicon: a failed lookup is not retried on every message", async () => {
  let calls = 0;
  const failing: HttpGet = async () => {
    calls++;
    return { status: 500, text: "" };
  };
  const translator = new Translator(failing);
  const lex = new Lexicon(null, translator);
  await lex.ensure("it");
  const after = calls;
  await lex.ensure("it");
  await lex.ensure("it");
  assert.equal(calls, after);
  assert.equal(lex.tradeWord("it", "WTS"), null);
});

test("channel names from any log file name", () => {
  const cases: Array<[string, unknown]> = [
    ["_Local.2026-10.txt", { channel: "Local", period: "2026-10" }],
    ["_Event.2026-10-05.txt", { channel: "Event", period: "2026-10-05" }],
    ["German_GL.2026-10.txt", { channel: "German GL", period: "2026-10" }],
    ["Non-English_GL.2026-10.txt", { channel: "Non-English GL", period: "2026-10" }],
    ["Spanish_GL.2026-10.txt", { channel: "Spanish GL", period: "2026-10" }],
    ["Portuguese_GL.2026-10.txt", { channel: "Portuguese GL", period: "2026-10" }],
    ["GL-Pandemonium.2018-10.txt", { channel: "GL-Pandemonium", period: "2018-10" }],
    ["HOTS.2019-01.txt", { channel: "HOTS", period: "2019-01" }],
    ["Freedom.2020-02.txt", { channel: "Freedom", period: "2020-02" }],
    ["CA_HELP.2026-10.txt", { channel: "CA Help", period: "2026-10" }],
    ["Russian_GL.2026-10.txt", { channel: "Russian GL", period: "2026-10" }],
    ["PM__Friend.2026-10.txt", { channel: "PM", sub: "Friend", period: "2026-10" }],
    ["_Skills.txt", { channel: "Skills", period: undefined }],
    [".hidden", null],
  ];
  for (const [f, want] of cases) assert.deepEqual(channelFromFileName(f), want, f);
  assert.deepEqual(sortChannels(["Skills", "German GL", "HOTS", "PM", "GL-Pandemonium", "Event", "Local", "Trade", "Freedom"]), [
    "Local", "Trade", "Freedom", "HOTS", "GL-Pandemonium", "German GL", "PM", "Event", "Skills",
  ]);
  assert.equal(languageOfChannel("German GL"), "de");
  assert.equal(languageOfChannel("Non-English GL"), null);
});

test("language chats: own language as is, other languages translated", async () => {
  const { pipeline } = makePipeline();
  const de = await pipeline.translateMessage("hello", "German GL", opts("en"));
  assert.deepEqual(de, { translated: "hello", srcLang: "en" }, "fake detects en; shows it untranslated because it IS english");
  const ru = await pipeline.translateMessage("hello", "German GL", opts("ru"));
  assert.equal(ru.translated, "T[hello] (en)", "German GL is translated for a Russian reader");
  const mixed = await pipeline.translateMessage("hello", "Non-English GL", opts("ru"));
  assert.equal(mixed.translated, "T[hello] (en)");
  const own = await pipeline.translateMessage("hello", "Russian GL", opts("ru"));
  assert.deepEqual(own, { translated: "hello", srcLang: null });
});

test("watcher: discovers new chats, any file name, daily rotation, cold files, binary files", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "logs-dyn-"));
  let now = Date.now();
  const recent = path.join(dir, "Freedom.2026-11.txt");
  const old = path.join(dir, "GL-Pandemonium.2018-10.txt");
  fs.writeFileSync(recent, "[10:00:00] <A> old\n");
  fs.writeFileSync(old, "[10:00:00] <A> ancient\n");
  const ancient = new Date("2018-10-31");
  fs.utimesSync(old, ancient, ancient);
  const got: RawLine[] = [];
  const newChannels: string[] = [];
  const w = new LogWatcher(dir, 0, (l) => got.push(l), () => {}, 500, () => now, (c) => newChannels.push(c));
  const initial = w.start(true);
  w.stop();
  assert.deepEqual(initial, ["Freedom"], "only recently used chats get a tab at start");

  // the game opens new chats: files appear -> new channels, read from the start
  fs.writeFileSync(path.join(dir, "German_GL.2026-11.txt"), "Logging started 2026-11-04\n[10:01:00] <Hans> Hallo zusammen\n");
  fs.writeFileSync(path.join(dir, "_Event.2026-11-04.txt"), "[10:01:01] You notice something.\n");
  fs.writeFileSync(path.join(dir, "HOTS.2026-11.txt"), "plain line without timestamp\n");
  await w.scanOnce();
  assert.deepEqual(newChannels.sort(), ["Event", "German GL", "HOTS"]);
  assert.deepEqual(got.map((g) => `${g.channel}|${g.line}`).sort(), [
    "Event|[10:01:01] You notice something.",
    "German GL|[10:01:00] <Hans> Hallo zusammen",
    "HOTS|plain line without timestamp",
  ]);

  // an old, cold file that suddenly gets written to is still picked up (after the cold interval)
  now += COLD_AFTER_MS + 1000;
  await w.scanOnce();
  fs.appendFileSync(old, "[11:00:00] <B> revived\n");
  now += COLD_CHECK_MS + 1;
  await w.scanOnce();
  assert.equal(got[got.length - 1].line, "[11:00:00] <B> revived");
  assert.equal(got[got.length - 1].channel, "GL-Pandemonium");

  // binary files are ignored
  fs.writeFileSync(path.join(dir, "junk.dat"), Buffer.from([1, 0, 2, 10, 65, 10]));
  const before = got.length;
  await w.scanOnce();
  assert.equal(got.length, before);

  // PM partner is reported
  fs.writeFileSync(path.join(dir, "PM__Olga.2026-11.txt"), "[10:02:00] <Olga> hi\n");
  await w.scanOnce();
  assert.equal(got[got.length - 1].sub, "Olga");
});

test("engine: untranslated channels skip the translation queue; backlog is capped", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "logs-eng-"));
  const { pipeline } = makePipeline();
  const msgs: ChatMessage[] = [];
  const events: EngineEvent[] = [];
  const eng = new Engine(
    pipeline,
    () => ({ ...opts("ru"), noTranslate: ["Combat"] }),
    (m) => msgs.push(m),
    (e) => events.push(e),
  );
  assert.equal(eng.start([{ name: "x", path: dir }]), null);
  assert.ok(events.some((e) => e.type === "channels"));
  eng.enqueue({ clientIdx: 0, channel: "Combat", line: "[10:00:00] You hit the troll." });
  assert.equal(msgs.length, 1, "emitted synchronously");
  assert.equal(msgs[0].translated, msgs[0].original);
  eng.enqueue({ clientIdx: 0, channel: "German GL", line: "[10:00:01] <Hans> hello" });
  for (let i = 0; i < 50 && msgs.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(msgs[1].translated, "T[hello] (en)");
  eng.stop();
});

test("interface machine translation: placeholders, multi-line strings, fallbacks", async () => {
  const en = {
    a: "Watching {n} client(s): {names}. {mode}",
    b: "Line one\n\nLine two",
    c: "Plain",
    d: "Uses {path}",
  };
  const calls: string[] = [];
  // fake: uppercases every line, keeps {0}; mangles the placeholder of "Uses …"
  const tr = async (text: string) => {
    calls.push(text);
    return text
      .split("\n")
      .map((l) => (l.startsWith("Uses") ? "USES {zero}" : l.toUpperCase().replace(/\{(\d)\}/g, "{ $1 }")))
      .join("\n");
  };
  const r = await translateUiStrings(en, "xx", tr);
  assert.ok(r.complete);
  assert.equal(r.strings.a, "WATCHING {n} CLIENT(S): {names}. {mode}");
  assert.equal(r.strings.b, "LINE ONE\n\nLINE TWO", "line structure kept, empty lines not sent");
  assert.equal(r.strings.c, "PLAIN");
  assert.equal(r.strings.d, "Uses {path}", "broken placeholder -> English kept");
  assert.equal(calls.length, 1, "one batch");
  assert.equal(decode("x {1} {0}", ["a", "b"]), "x {b} {a}");
  assert.equal(decode("x {0}", ["a", "b"]), null);

  // a translator that merges lines forces the batch to be split until counts match
  const merging = async (text: string) => {
    const lines = text.split("\n");
    return lines.length > 2 ? lines.join(" ").toUpperCase() : lines.map((l) => l.toUpperCase()).join("\n");
  };
  const r2 = await translateUiStrings(en, "xx", merging);
  assert.equal(r2.strings.c, "PLAIN");
  assert.equal(r2.strings.a, "WATCHING {n} CLIENT(S): {names}. {mode}");

  // network failure -> incomplete (retried later), English shown meanwhile
  const r3 = await translateUiStrings(en, "xx", async () => null);
  assert.equal(r3.complete, false);
  assert.equal(r3.strings.c, "Plain");
  assert.notEqual(hashStrings(en), hashStrings({ ...en, c: "Changed" }));
});

test("machine strings are used for languages without a hand translation", () => {
  setMachineStrings("ja", { btn_stop: "停止" });
  assert.equal(translate("ja", "btn_stop"), "停止");
  assert.equal(translate("ja", "btn_start"), I18N.en.btn_start, "missing key -> English");
  assert.equal(translate("ru", "btn_stop"), I18N.ru.btn_stop, "hand translations win");
  assert.ok(isRtl("ar") && !isRtl("de"));
  setMachineStrings("ja", null);
});

test("the whole English interface survives a round trip through the batcher", async () => {
  const en = I18N.en;
  const r = await translateUiStrings(en, "xx", async (t) => t);
  assert.ok(r.complete);
  assert.deepEqual(r.strings, en);
});

test("OCR preparation: dark backgrounds inverted, upscaled, PNG encoded", () => {
  const w = 4;
  const h = 4;
  const dark = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = i === 5 ? 220 : 30; // one light "text" pixel on dark
    dark.set([v, v, v, 255], i * 4);
  }
  const p = prepareForOcr({ width: w, height: h, data: dark, order: "rgba" });
  assert.equal(p.inverted, true);
  assert.equal(p.scale, 3);
  assert.equal(p.image.width, 12);
  assert.ok(p.image.data[0] > 200, "background became light");
  const png = encodePngGray(p.image);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(chooseScale(4000, 3000), 1, "big captures are not upscaled");
  assert.equal(cleanOcrText("  Hello   world \n|\n~ \nQuality: 45"), "Hello world\nQuality: 45");
  assert.equal(ocrLangString("deu"), "deu+eng");
  assert.equal(ocrLangString("eng"), "eng");
  assert.equal(ocrLangString("zzz"), "eng");
  assert.equal(ocrCodeFor("pt-PT"), "por");
  assert.equal(ocrCodeFor("zh-TW"), "chi_tra");
});

test("OCR end to end: small light-on-dark game text is read correctly", { timeout: 60_000 }, async () => {
  const { createWorker, OEM } = await import("tesseract.js");
  const data = fs.readFileSync(path.join(__dirname, "fixtures", "dark9.rgba"));
  const p = prepareForOcr({ width: 190, height: 44, data, order: "rgba" });
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: path.join(__dirname, "..", "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"),
    cachePath: path.join(tmp, "ocr-cache"),
    gzip: true,
  });
  try {
    const r = await worker.recognize(encodePngGray(p.image));
    const text = cleanOcrText(r.data.text);
    assert.match(text, /Quality: 45\.27/);
    assert.match(text, /large cart made from oak/);
    assert.match(text, /improve it with a mallet/);
  } finally {
    await worker.terminate();
  }
});

test("config: close action migration from the old close_to_tray flag", () => {
  const mk = (raw: object) => {
    const dir = fs.mkdtempSync(path.join(tmp, "cfg-close-"));
    fs.writeFileSync(path.join(dir, "wurm_chat_gui_config.json"), JSON.stringify(raw));
    return new ConfigStore(dir).cfg;
  };
  assert.equal(mk({}).close_action, "ask");
  assert.equal(mk({ close_to_tray: true }).close_action, "ask", "old default true was never a real choice");
  assert.equal(mk({ close_to_tray: false }).close_action, "quit");
  assert.equal(mk({ close_action: "tray" }).close_action, "tray");
  assert.ok(!("close_to_tray" in mk({ close_to_tray: true })));
});

test("config: settings saved under the old file name are imported", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "cfg-legacy-name-"));
  fs.writeFileSync(path.join(dir, "wurm_chat_gui_config.json"), JSON.stringify({ target_lang: "de", clients: [{ name: "Bob", path: "/x" }] }));
  const s = new ConfigStore(dir);
  assert.equal(s.cfg.target_lang, "de");
  assert.deepEqual(s.cfg.clients, [{ name: "Bob", path: "/x" }]);
  assert.ok(fs.existsSync(path.join(dir, "babelwurm_config.json")));
  assert.ok(fs.existsSync(path.join(dir, "wurm_chat_gui_config.json")), "old file kept as a backup");
});
