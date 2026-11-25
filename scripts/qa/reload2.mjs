import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const { chromium } = require("playwright-core");
const [, , URL, W] = process.argv;
const b = await chromium.launch({ headless: true, channel: "chrome" });
const NAMES = ["top", "craft", "ask", "work", "contact"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const look = (p) => p.evaluate(() => {
  const i = [...document.querySelectorAll(".dots__dot")].findIndex((d) => d.classList.contains("is-on"));
  const t = document.querySelectorAll(".panel")[i]?.offsetTop;
  return {
    i, aligned: Math.abs(scrollY - t) < 3,
    kbLit: document.querySelector(".panel--void")?.classList.contains("is-lit"),
    glass: (document.querySelector(".a2m__screen")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 28),
    rows: [...document.querySelectorAll(".wx__list > li")].every((li) => +getComputedStyle(li).opacity > 0.9),
    fallback: !!document.querySelector('[role="alert"]'),
  };
});
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message.slice(0, 90)));
await p.goto(URL, { waitUntil: "load" }); await sleep(3000);
for (const s of [1, 2, 3, 4]) {
  await p.locator(`.dots__dot[aria-label="${NAMES[s]}"]`).click({ force: true }); await sleep(9000);
  await p.reload({ waitUntil: "load" }); await sleep(7000);
  const r = await look(p);
  const live = s === 1 ? r.kbLit : s === 2 ? /ARCHIVE|ASK|FU/.test(r.glass) : s === 3 ? r.rows : true;
  console.log(`reload on ${NAMES[s].padEnd(7)} -> back on ${NAMES[r.i].padEnd(7)} aligned=${r.aligned} section live=${live} ${s === 2 ? `glass="${r.glass}"` : ""}${r.fallback ? " FALLBACK SHOWN" : ""}`);
}
const p2 = await ctx.newPage(); await p2.goto(URL, { waitUntil: "load" }); await sleep(3000);
console.log(`new tab -> starts on ${NAMES[(await look(p2)).i]}`); await p2.close();
const p3 = await ctx.newPage(); await p3.goto(URL + "?frame=kb", { waitUntil: "load" }); await sleep(4000);
console.log(`?frame=kb plate -> on ${NAMES[(await look(p3)).i]} (want craft)`); await p3.close();
if (W) {
  await p.locator('.dots__dot[aria-label="ask"]').click({ force: true }); await sleep(9000);
  const f = `${W}/src/components/WorkIndex.tsx`; const orig = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, orig + `\n// save probe ${Date.now()}\n`); await sleep(8000); fs.writeFileSync(f, orig); await sleep(8000);
  const r = await look(p);
  console.log(`file saved while on ask -> on ${NAMES[r.i]} aligned=${r.aligned} glass="${r.glass}"${r.fallback ? " FALLBACK" : ""}`);
}
console.log("page errors:", errs.length ? [...new Set(errs)] : "none");
await b.close();
