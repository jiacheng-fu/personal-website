/* Upscale the hero photo locally (no upload, no credits).
 *
 *   node scripts/upscale-photo.mjs
 *
 * Swin2SR (real-world x4) via Transformers.js on this machine, in 480px tiles
 * with blended overlaps so memory stays sane and no seams show. Upscaled 4x,
 * then saved at 2x (3344px) - enough for a Retina screen, and the downsample
 * hides most of the model's texture invention. Output: media/hero-photo/swin/.
 * The head cutout for it is made separately (macOS Vision). */
import { mkdirSync } from "node:fs";
import { pipeline, RawImage } from "@huggingface/transformers";
import sharp from "sharp";

/* `node scripts/upscale-photo.mjs [gentle]`
 *   (default) real-world x4 model, saved at 2x -> media/hero-photo/swin/
 *   gentle    classical x2 model, the least invented detail -> .../swin-gentle/
 * Brian, 2026-11-25: Upscayl at 4x came out "too shiny" - so never ship a
 * maxed-out upscale; 2x is the target either way. */
const GENTLE = process.argv[2] === "gentle";
const SRC = "media/hero-photo/background1.png";
const DIR = GENTLE ? "media/hero-photo/swin-gentle" : "media/hero-photo/swin";
const MODEL = GENTLE ? "Xenova/swin2SR-classical-sr-x2-64" : "Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr";
const T = 480;
const OV = 48;
const S = GENTLE ? 2 : 4;

mkdirSync(DIR, { recursive: true });
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const starts = (n) => {
  const p = [];
  for (let x = 0; ; x += T - OV) {
    if (x + T >= n) {
      p.push(Math.max(0, n - T));
      break;
    }
    p.push(x);
  }
  return [...new Set(p)];
};
const xs = starts(W);
const ys = starts(H);
const up = await pipeline("image-to-image", MODEL, { dtype: "fp32" });

const OW = W * S;
const OH = H * S;
const acc = new Float32Array(OW * OH * 3);
const wsum = new Float32Array(OW * OH);
/* weight falls to ~0 across a shared overlap, stays 1 at the picture edge */
const ramp = (d, shared) => (shared ? Math.min(1, Math.max(0.001, d / (OV * S))) : 1);

let n = 0;
for (const y0 of ys) {
  for (const x0 of xs) {
    const tw = Math.min(T, W - x0);
    const th = Math.min(T, H - y0);
    const tile = new Uint8ClampedArray(tw * th * 3);
    for (let y = 0; y < th; y++) {
      const src = ((y0 + y) * W + x0) * 3;
      tile.set(data.subarray(src, src + tw * 3), y * tw * 3);
    }
    const t0 = Date.now();
    const out = await up(new RawImage(tile, tw, th, 3));
    const ow = tw * S;
    const oh = th * S;
    for (let y = 0; y < oh; y++) {
      const wy = Math.min(ramp(y, y0 > 0), ramp(oh - 1 - y, y0 + th < H));
      for (let x = 0; x < ow; x++) {
        const w = Math.min(wy, ramp(x, x0 > 0), ramp(ow - 1 - x, x0 + tw < W));
        const si = (y * out.width + x) * out.channels;
        const di = (y0 * S + y) * OW + (x0 * S + x);
        acc[di * 3] += out.data[si] * w;
        acc[di * 3 + 1] += out.data[si + 1] * w;
        acc[di * 3 + 2] += out.data[si + 2] * w;
        wsum[di] += w;
      }
    }
    console.log(`tile ${++n}/${xs.length * ys.length} (${x0},${y0}) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

const rgb = new Uint8Array(OW * OH * 3);
for (let i = 0; i < OW * OH; i++) {
  const w = wsum[i] || 1;
  rgb[i * 3] = acc[i * 3] / w;
  rgb[i * 3 + 1] = acc[i * 3 + 1] / w;
  rgb[i * 3 + 2] = acc[i * 3 + 2] / w;
}
const x2 = sharp(Buffer.from(rgb), { raw: { width: OW, height: OH, channels: 3 } }).resize(W * 2, H * 2, { kernel: "lanczos3" });
await x2.clone().png({ compressionLevel: 9 }).toFile(`${DIR}/background1.png`);
await x2.clone().webp({ quality: 86, smartSubsample: true }).toFile(`${DIR}/background1.webp`);
console.log(`done: ${W * 2}x${H * 2} -> ${DIR}/background1.{png,webp}`);
