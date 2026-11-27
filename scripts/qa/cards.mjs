import { createRequire } from "module";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const BASE = process.argv[2] || "http://localhost:4183/";
const b = await pw.chromium.launch({ headless: true, channel: "chrome" });
const sizes = [[1920,1080],[2560,1305],[1512,982],[1440,900],[1450,1000],[1440,1000],[1366,768],[1280,800],[1280,1024],[1024,768],[1180,820],[960,1080],[1100,1200],[900,1400],[768,1024],[800,600],[721,900],[3440,1440],[1920,700]];
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: "load" }); await new Promise(r => setTimeout(r, 2000));
if (await p.locator(".framechoice").count()) await p.getByRole("button", { name: /Full width/ }).click();
await p.locator('.dots__dot[data-section="ask"]').click({ force: true }); await new Promise(r => setTimeout(r, 6000));
for (const [w, h] of sizes) {
  await p.setViewportSize({ width: w, height: h }); await new Promise(r => setTimeout(r, 1200));
  const o = await p.evaluate(() => {
    const R = (s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === "none") return null; return e.getBoundingClientRect(); };
    const g = R(".a2m__screen"), f = R(".feed"), br = R(".brain");
    const ov = (a, c) => a && c ? Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left)) * (Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top)) > 0 ? 1 : 0) : 0;
    return { g: g && [Math.round(g.left), Math.round(g.right)], f: f && [Math.round(f.left), Math.round(f.right)], b: br && [Math.round(br.left), Math.round(br.right)], fo: ov(f, g), bo: ov(br, g) };
  });
  console.log(`${w}x${h} a=${(w/h).toFixed(2)}  glass ${o.g}  feed ${o.f ?? "hidden"} ${o.fo ? "OVERLAPS by " + o.fo + "px" : ""}  brain ${o.b ?? "hidden"} ${o.bo ? "OVERLAPS by " + o.bo + "px" : ""}`);
}
await b.close();
