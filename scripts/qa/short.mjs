import { createRequire } from "module";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const b = await pw.chromium.launch({ headless: true, channel: "chrome" });
for (const [w, h, touch] of [[640, 400], [844, 390, 1], [720, 480], [1366, 500], [1920, 1080], [2560, 1305]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage(); await p.goto(process.argv[2], { waitUntil: "load" }); await new Promise(r => setTimeout(r, 2000));
  if (await p.locator(".framechoice").count()) await p.getByRole("button", { name: /Full width/ }).click();
  await p.locator('.dots__dot[data-section="ask"]').click({ force: true }); await new Promise(r => setTimeout(r, 7000));
  const o = await p.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const l = r(".rag .section__label"), f = r(".rag__foot"), g = r(".a2m__screen"); return { label: Math.round(l.top), foot: Math.round(f.bottom), glass: [Math.round(g.top), Math.round(g.bottom), Math.round(g.width)] }; });
  console.log(`${w}x${h}: label top ${o.label}, caption bottom ${o.foot} of ${h} ${o.label >= 0 && o.foot <= h ? "OK" : "CUT"}; glass ${o.glass}`);
  await p.screenshot({ path: `short-${w}x${h}.png` }); await ctx.close();
}
await b.close();
