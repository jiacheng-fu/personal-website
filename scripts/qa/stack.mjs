// The machine -> projects handoff started while the glass is still changing:
// does the overlay's text (`ls ~/work`, the names) land on visible session text?
//   node stack.mjs <baseURL> <outDir>
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const [, , BASE, OUT] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const b = await pw.chromium.launch({ headless: true, channel: "chrome" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* every visible line of session text on the glass, and every overlay text box;
   report overlay boxes that sit on top of session text */
const overlap = () => {
  const glass = document.querySelector(".a2m__screen")?.getBoundingClientRect();
  if (!glass) return { n: 0, hits: [] };
  const vis = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity < 0.15 || cs.visibility === "hidden" || cs.display === "none") return false; } return true; };
  const clipVisible = (el) => { const cp = getComputedStyle(el).clipPath; return !cp || cp === "none" || !/inset\(0(px)? 100%/.test(cp); };
  const session = [...document.querySelectorAll(".a2-boot > *, .a2-boot li, .a2-perf *")]
    .filter((e) => e.children.length === 0 || e.tagName === "LI")
    .filter((e) => (e.innerText || "").trim() && vis(e) && clipVisible(e))
    .map((e) => ({ t: e.innerText.trim().slice(0, 24), r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width && r.height && r.bottom > glass.top + 2 && r.top < glass.bottom - 2);
  const over = [...document.querySelectorAll(".handoff.is-on .handoff__cmd, .handoff.is-on .handoff__line.is-in")]
    .filter((e) => vis(e))
    .map((e) => ({ t: (e.innerText || "").trim().slice(0, 20), r: e.getBoundingClientRect() }))
    .filter(({ r, t }) => t && r.width && r.height);
  const hits = [];
  for (const o of over) for (const s of session) {
    const ix = Math.min(o.r.right, s.r.right) - Math.max(o.r.left, s.r.left);
    const iy = Math.min(o.r.bottom, s.r.bottom) - Math.max(o.r.top, s.r.top);
    if (ix > 4 && iy > 4) hits.push(`"${o.t}" over "${s.t}"`);
  }
  return { n: over.length, hits: [...new Set(hits)].slice(0, 4) };
};

async function scenario(name, prep) {
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.route(/huggingface\.co|raw\.githubusercontent\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "load" }); await sleep(2500);
  await prep(p);
  await p.mouse.move(1785, 972); for (const v of [40, 120, 240]) { await p.mouse.wheel(0, v); await sleep(10); }
  const seen = [];
  for (const t of [300, 700, 1100, 1500, 1900, 2400, 3000, 3600]) {
    await sleep(t - (seen.length ? [300, 700, 1100, 1500, 1900, 2400, 3000, 3600][seen.length - 1] : 0));
    const o = await p.evaluate(overlap);
    seen.push(o);
    if (o.hits.length) await p.screenshot({ path: `${OUT}/${name.replace(/[^a-z0-9]+/gi, "-")}-${t}ms.png`, clip: await p.evaluate(() => { const g = document.querySelector(".a2m__screen").getBoundingClientRect(); return { x: g.left - 20, y: g.top - 20, width: g.width + 40, height: g.height + 40 }; }) });
  }
  const bad = seen.flatMap((o, i) => o.hits.map((h) => `${[300, 700, 1100, 1500, 1900, 2400, 3000, 3600][i]}ms ${h}`));
  console.log(`${bad.length ? "STACKED" : "clean  "} ${name}${bad.length ? "\n      - " + bad.slice(0, 6).join("\n      - ") : ""}`);
  await sleep(6000);
  await ctx.close();
}
const toCraft = async (p) => { await p.keyboard.press("ArrowDown"); await sleep(4500); };
// arrive by the clip (the boot starts as it ends), go down while the menu is typing
await scenario("arrive by the clip, scroll as soon as the menu starts typing", async (p) => {
  await toCraft(p); await p.keyboard.press("ArrowDown");
  await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(150);
});
await scenario("arrive by the clip, scroll halfway through the menu typing", async (p) => {
  await toCraft(p); await p.keyboard.press("ArrowDown");
  await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(650);
});
await scenario("dot jump to the machine, scroll while the tube is still warming", async (p) => {
  await p.locator('.dots__dot[data-section="ask"]').click({ force: true });
  await p.waitForSelector(".a2-crt--off, .a2-crt--bloom", { timeout: 20000 }); await sleep(1200);
});
await scenario("ask a question, scroll while it is answering", async (p) => {
  await p.locator('.dots__dot[data-section="ask"]').click({ force: true });
  await p.waitForSelector(".rag.is-booting", { timeout: 30000 }); await p.waitForSelector(".rag:not(.is-booting) .a2-prompt input", { timeout: 30000 }); await sleep(800);
  await p.locator(".a2-prompt input").fill("what did brian do at his compiler internship"); await p.locator(".a2-prompt input").press("Enter");
  await sleep(1500);
});
await scenario("ask a question, scroll right after the answer lands", async (p) => {
  await p.locator('.dots__dot[data-section="ask"]').click({ force: true });
  await p.waitForSelector(".rag.is-booting", { timeout: 30000 }); await p.waitForSelector(".rag:not(.is-booting) .a2-prompt input", { timeout: 30000 }); await sleep(800);
  await p.locator(".a2-prompt input").fill("tell me about axle"); await p.locator(".a2-prompt input").press("Enter");
  await sleep(4200);
});
await scenario("settled machine (control)", async (p) => {
  await p.locator('.dots__dot[data-section="ask"]').click({ force: true });
  await p.waitForSelector(".rag.is-booting", { timeout: 30000 }); await p.waitForSelector(".rag:not(.is-booting) .a2-prompt input", { timeout: 30000 }); await sleep(1500);
});
await b.close();
