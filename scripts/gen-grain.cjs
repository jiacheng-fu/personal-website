/* Small generated textures for the notice board (the site's last page).
 *
 * Usage: node scripts/gen-grain.cjs
 * Writes public/textures/:
 *   grain.png    128x128  fine tooth: cork speckle, paper (tiled 1:1)
 *   mottle.png   48x48    soft blotches, scaled up: the cork's patchiness
 *
 * Gray PNGs, a few KB each; the materials are CSS gradients over them.
 * Seeded: a re-run writes identical bytes. (The lobby version also made
 * brushed-metal streaks; that generator and its PNGs are parked in
 * media/abandoned-ground-floor-lobby/.)
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
/* roughly gaussian around mid-grey: the sum of three uniforms */
const px = () => Math.max(0, Math.min(255, Math.round(128 + (rand() + rand() + rand() - 1.5) * 90)));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, pixel) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = pixel(x, y);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

const dir = path.join(__dirname, "..", "public", "textures");
fs.mkdirSync(dir, { recursive: true });
const write = (name, buf) => {
  fs.writeFileSync(path.join(dir, name), buf);
  console.log(`public/textures/${name}: ${buf.length} bytes`);
};

write("grain.png", png(128, 128, () => px()));
{
  /* value noise, blurred twice: soft clouds when scaled up */
  const n = 48;
  let g = Array.from({ length: n * n }, () => (rand() - 0.5) * 120);
  const at = (a, x, y) => a[((y + n) % n) * n + ((x + n) % n)];
  for (let k = 0; k < 2; k++)
    g = g.map((_, i) => {
      const x = i % n;
      const y = (i / n) | 0;
      let s2 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s2 += at(g, x + dx, y + dy);
      return s2 / 9;
    });
  write("mottle.png", png(n, n, (x, y) => clamp(128 + g[y * n + x] * 2.2)));
}
