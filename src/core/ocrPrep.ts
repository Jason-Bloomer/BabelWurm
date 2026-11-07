/**
 * Image preparation for OCR of game UI text, plus a tiny PNG encoder.
 *
 * Game text is small and often light-on-dark; Tesseract reads best with
 * large, dark text on a light background. So: upscale (bilinear), convert to
 * grayscale, invert when the background is dark, stretch contrast.
 * Pure TypeScript on raw pixel buffers — no Electron needed (testable).
 */
import { deflateSync } from "node:zlib";

export interface Bitmap {
  width: number;
  height: number;
  /** 4 bytes per pixel. */
  data: Uint8Array;
  /** Channel order of `data`: Electron's nativeImage.toBitmap() is BGRA. */
  order: "rgba" | "bgra";
}

export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export function toGray(b: Bitmap): Gray {
  const out = new Uint8Array(b.width * b.height);
  const [ri, bi] = b.order === "rgba" ? [0, 2] : [2, 0];
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (b.data[p + ri] * 299 + b.data[p + 1] * 587 + b.data[p + bi] * 114) / 1000;
  }
  return { width: b.width, height: b.height, data: out };
}

/** Bilinear upscale by an integer-ish factor. */
export function scaleGray(g: Gray, factor: number): Gray {
  if (factor <= 1) return g;
  const w = Math.round(g.width * factor);
  const h = Math.round(g.height * factor);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.height - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(g.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.width - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(g.width - 1, x0 + 1);
      const fx = sx - x0;
      const a = g.data[y0 * g.width + x0];
      const b = g.data[y0 * g.width + x1];
      const c = g.data[y1 * g.width + x0];
      const d = g.data[y1 * g.width + x1];
      out[y * w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return { width: w, height: h, data: out };
}

/** Is the background dark? Uses the median: text covers less area than background. */
export function isDarkBackground(g: Gray): boolean {
  const hist = new Uint32Array(256);
  for (const v of g.data) hist[v]++;
  let acc = 0;
  const half = g.data.length / 2;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) return v < 128;
  }
  return false;
}

/** Invert if needed and stretch the 2nd–98th percentile range to full contrast. */
export function normalize(g: Gray, invert: boolean): Gray {
  const hist = new Uint32Array(256);
  for (const v of g.data) hist[v]++;
  const lo = percentile(hist, g.data.length, 0.02);
  const hi = percentile(hist, g.data.length, 0.98);
  const span = Math.max(1, hi - lo);
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) {
    let v = ((g.data[i] - lo) * 255) / span;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    out[i] = invert ? 255 - v : v;
  }
  return { width: g.width, height: g.height, data: out };
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** Upscale factor so small captures reach a size Tesseract likes, capped for big ones. */
export function chooseScale(width: number, height: number): number {
  const target = 3;
  const maxPixels = 4_000_000;
  let f = target;
  while (f > 1 && width * f * height * f > maxPixels) f -= 0.5;
  return f;
}

/** Full preparation: grayscale → upscale → invert dark backgrounds → contrast stretch. */
export function prepareForOcr(b: Bitmap): { image: Gray; inverted: boolean; scale: number } {
  const g = toGray(b);
  const inverted = isDarkBackground(g);
  const scale = chooseScale(g.width, g.height);
  return { image: normalize(scaleGray(g, scale), inverted), inverted, scale };
}

/** Cheap fingerprint of an image (to skip OCR when nothing changed in auto mode). */
export function fingerprint(g: Gray): string {
  const step = Math.max(1, Math.floor(g.data.length / 4096));
  let h = 2166136261;
  for (let i = 0; i < g.data.length; i += step) {
    h ^= g.data[i] >> 3; // ignore tiny noise
    h = Math.imul(h, 16777619);
  }
  return `${g.width}x${g.height}:${(h >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit grayscale)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePngGray(g: Gray): Buffer {
  const raw = Buffer.alloc((g.width + 1) * g.height);
  for (let y = 0; y < g.height; y++) {
    raw[y * (g.width + 1)] = 0; // filter: none
    raw.set(g.data.subarray(y * g.width, (y + 1) * g.width), y * (g.width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(g.width, 0);
  ihdr.writeUInt32BE(g.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
