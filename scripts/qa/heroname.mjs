import { createRequire } from "module";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const BASE = process.argv[2] || "http://localhost:4183/";
const b = await pw.chromium.launch({ headless: true, channel: "chrome" });
const sizes = [[1920,1080],[2560,1440],[2560,1305],[1920,969],[1512,982],[1512,860],[1366,768],[1280,720],[1024,768],[390,844],[960,1080],[844,390],[2050,1000],[1920,700],[3440,1440],[5120,1440],[1920,560]];
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: "load" }); await new Promise(r => setTimeout(r, 2500));
for (const [w, h] of sizes) {
  await p.setViewportSize({ width: w, height: h }); await new Promise(r => setTimeout(r, 900));
  const o = await p.evaluate(() => {
    const hits = [...document.querySelectorAll(".hx__glyph--name .hx__glyphHit")].map((r) => r.getBoundingClientRect());
    const sub = [...document.querySelectorAll(".hx__glyph--sub .hx__glyphHit")].map((r) => r.getBoundingClientRect());
    const top = Math.min(...hits.map((r) => r.top)), cap = hits[0]?.height || 0;
    return { capPx: Math.round(cap), capTop: Math.round(top), vh: innerHeight, subBottom: sub.length ? Math.round(Math.max(...sub.map((r) => r.bottom))) : null, left: Math.round(Math.min(...hits.map((r) => r.left))), right: Math.round(Math.max(...hits.map((r) => r.right))) };
  });
  console.log(`${w}x${h} a=${(w/h).toFixed(2)}  cap ${o.capPx}px (${(o.capPx/o.vh).toFixed(3)} of h)  cap top at ${o.capTop}px (${(o.capTop/o.vh).toFixed(3)})  role bottom ${o.subBottom}  x ${o.left}-${o.right}`);
}
await b.close();
