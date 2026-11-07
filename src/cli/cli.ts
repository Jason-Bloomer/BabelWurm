/**
 * Console mode: prints translated
 * chat to the terminal. Useful for debugging or headless setups.
 *
 *   node dist/cli/cli.js [--logs <folder>] [--lang ru] [--all-history]
 *
 * Without --logs the folder is found the same way as "Find automatically" in the app.
 */
import * as path from "node:path";
import { autoLogsDir } from "../core/discovery";
import { Engine } from "../core/engine";
import { Glossary } from "../core/glossary";
import { Lexicon, Pipeline } from "../core/pipeline";
import { Translator, type HttpGet } from "../core/translate";

const httpGet: HttpGet = async (url, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("BabelWurm console mode\nUsage: babelwurm-cli [--logs <…/players/<Char>/logs>] [--lang <code>] [--glossary <file>]");
    return;
  }
  const logs = arg("--logs") || (await autoLogsDir());
  const lang = arg("--lang") || "en";
  if (!logs) {
    console.error("No logs folder found. Pass --logs …/players/<Char>/logs");
    process.exit(1);
  }
  const translator = new Translator(httpGet);
  const glossary = new Glossary(arg("--glossary") ? path.resolve(arg("--glossary")!) : null);
  const pipeline = new Pipeline(translator, glossary, new Lexicon(null, translator));
  const engine = new Engine(
    pipeline,
    () => ({ translate: true, targetLang: lang, translateLangChannels: false, translateCurrency: true, noTranslate: ["Combat", "Skills"] }),
    (m) => {
      const who = m.name ? `${m.name}: ` : "";
      const head = `[${m.time}] [${m.channel}${m.sub ? `: ${m.sub}` : ""}] ${who}`;
      if (m.translated === null || m.translated === m.original) console.log(head + m.original);
      else console.log(`${head}${m.original}\n    → ${m.translated}`);
    },
    (e) => e.type === "error" && console.error(e.message),
  );
  const err = engine.start([{ name: "cli", path: logs }]);
  if (err) {
    console.error(err.error === "bad_path" ? `Logs folder unavailable: ${err.path}` : "No logs folder");
    process.exit(1);
  }
  console.log(`Watching ${logs} → ${lang}. Ctrl+C to quit.`);
  process.on("SIGINT", () => {
    engine.stop();
    process.exit(0);
  });
}

void main();
