/**
 * Text recognition with Tesseract (tesseract.js, WebAssembly, fully offline).
 * One long-lived worker; language data lives in <data>/ocr. English is
 * bundled; other languages are downloaded once from jsDelivr on first use.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { OCR_DATA_URL } from "../core/ocrLangs";

export type Download = (url: string) => Promise<Buffer>;

export interface OcrResult {
  text: string;
  confidence: number;
}

export class OcrService {
  private worker: Worker | null = null;
  private workerLangs = "";
  private chain: Promise<unknown> = Promise.resolve();
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly bundledDir: string,
    private readonly download: Download,
    private readonly log: (m: string) => void,
  ) {
    this.dir = path.join(dataDir, "ocr");
    fs.mkdirSync(path.join(this.dir, "cache"), { recursive: true });
  }

  private file(code: string) {
    return path.join(this.dir, `${code}.traineddata.gz`);
  }

  isAvailable(code: string): boolean {
    return fs.existsSync(this.file(code)) || fs.existsSync(path.join(this.bundledDir, `${code}.traineddata.gz`));
  }

  /** Make sure the data for every language in "rus+eng" exists. onDownload is called before a download starts. */
  async ensure(langs: string, onDownload: (code: string) => void): Promise<void> {
    for (const code of langs.split("+")) {
      const target = this.file(code);
      if (fs.existsSync(target)) continue;
      const bundled = path.join(this.bundledDir, `${code}.traineddata.gz`);
      if (fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, target);
        continue;
      }
      onDownload(code);
      this.log(`ocr: downloading ${code}`);
      const data = await this.download(OCR_DATA_URL(code));
      if (data.length < 100_000 || data[0] !== 0x1f || data[1] !== 0x8b) throw new Error(`bad data for ${code}`);
      fs.writeFileSync(`${target}.part`, data);
      fs.renameSync(`${target}.part`, target);
    }
  }

  /** Recognize a PNG. Calls are serialized on the single worker. */
  recognize(png: Buffer, langs: string, singleLine: boolean): Promise<OcrResult> {
    const run = async (): Promise<OcrResult> => {
      if (!this.worker) {
        this.worker = await createWorker(langs, OEM.LSTM_ONLY, {
          langPath: this.dir,
          cachePath: path.join(this.dir, "cache"),
          gzip: true,
          logger: () => {},
          errorHandler: (e: unknown) => this.log(`ocr worker error: ${e}`),
        });
        this.workerLangs = langs;
      } else if (this.workerLangs !== langs) {
        await this.worker.reinitialize(langs, OEM.LSTM_ONLY);
        this.workerLangs = langs;
      }
      await this.worker.setParameters({
        tessedit_pageseg_mode: singleLine ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      const r = await this.worker.recognize(png);
      return { text: r.data.text || "", confidence: Math.round(r.data.confidence || 0) };
    };
    const safe = async () => {
      try {
        return await run();
      } catch (e) {
        // a failed init/reinitialize can leave the worker unusable — start fresh next time
        await this.dispose();
        throw e;
      }
    };
    const p = this.chain.then(safe, safe);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Stop the worker thread (bounded: never blocks quitting for more than 1.5 s). */
  async dispose() {
    const w = this.worker;
    this.worker = null;
    if (!w) return;
    try {
      await Promise.race([w.terminate(), new Promise((r) => setTimeout(r, 1500))]);
    } catch {
      /* ignore */
    }
  }
}
