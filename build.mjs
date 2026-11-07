// Bundles the main process, preload scripts, console mode and the UI with esbuild.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const watch = process.argv.includes("--watch");
const out = "dist";
fs.rmSync(out, { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, logLevel: "info", legalComments: "none" };

const builds = [
  {
    ...common,
    entryPoints: { main: "src/main/main.ts", preload: "src/main/preload.ts", alertPreload: "src/main/alertPreload.ts", magPreload: "src/main/magPreload.ts" },
    outdir: `${out}/main`,
    platform: "node",
    format: "cjs",
    target: "node20",
    // tesseract.js spawns its worker from files on disk, so it stays in node_modules
    external: ["electron", "tesseract.js"],
  },
  {
    ...common,
    entryPoints: { cli: "src/cli/cli.ts" },
    outdir: `${out}/cli`,
    platform: "node",
    format: "cjs",
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...common,
    entryPoints: { app: "src/renderer/app.tsx", alert: "src/renderer/alert.tsx", magnifier: "src/renderer/magnifier.tsx" },
    outdir: `${out}/renderer`,
    platform: "browser",
    format: "iife",
    target: "chrome120",
    jsx: "automatic",
    jsxImportSource: "preact",
  },
];

// English text-recognition data is bundled (other languages download on first use)
function copyOcrData() {
  const src = "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz";
  fs.mkdirSync("resources/ocr", { recursive: true });
  if (fs.existsSync(src) && !fs.existsSync("resources/ocr/eng.traineddata.gz")) fs.copyFileSync(src, "resources/ocr/eng.traineddata.gz");
}
copyOcrData();

function copyStatic() {
  fs.mkdirSync(`${out}/renderer`, { recursive: true });
  for (const f of ["index.html", "alert.html", "styles.css", "magnifier.html", "magnifier.css"]) {
    fs.copyFileSync(path.join("src/renderer", f), path.join(out, "renderer", f));
  }
}

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
  copyStatic();
  fs.watch("src/renderer", (_e, f) => f && /\.(html|css)$/.test(f) && copyStatic());
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
}
