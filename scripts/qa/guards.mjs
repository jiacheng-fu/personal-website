import { createRequire } from "module";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const { chromium } = require("playwright-core");
const URL = process.argv[2];
const b = await chromium.launch({ headless: true, channel: "chrome" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["top", "craft", "ask", "work", "contact"];
const p = await (await b.newContext({ viewport: { width: 1512, height: 860 } })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const st = () => p.evaluate(() => { const i = [...document.querySelectorAll(".dots__dot")].findIndex((d) => d.classList.contains("is-on")); const t = document.querySelectorAll(".panel")[i]?.offsetTop; return { i, y: Math.round(scrollY), t, ok: Math.abs(scrollY - t) < 3, fallback: !!document.querySelector('[role="alert"]') }; });
const dot = (i) => p.locator(`.dots__dot[aria-label="${NAMES[i]}"]`).click({ force: true });
await p.goto(URL, { waitUntil: "load" }); await sleep(2500);
console.log("load:", JSON.stringify(await st()));
// dot click while a scroll glide is in flight (work -> contact is a plain 850ms glide)
await dot(3); await sleep(9000);
await p.keyboard.press("ArrowDown"); await sleep(200); await dot(1); await sleep(9000);
let s = await st(); console.log(`dot click mid-glide: landed ${NAMES[s.i]} aligned=${s.ok} (want contact: the click is ignored, not a fight)`);
// key during the kb->machine clip's fade-out window
await dot(1); await sleep(9000);
await p.keyboard.press("ArrowDown");
const t0 = Date.now();
await p.waitForFunction(() => document.querySelector('.dots__dot[aria-label="ask"]').classList.contains("is-on"), null, { timeout: 15000 });
await sleep(150); await p.keyboard.press("ArrowDown"); // lands while the clip overlay is still fading
await sleep(9000);
s = await st(); console.log(`key during clip fade: on ${NAMES[s.i]} aligned=${s.ok} (want ask: no handoff started over the clip)`);
// resize during a glide
await dot(3); await sleep(9000);
await p.keyboard.press("ArrowDown"); await sleep(300); await p.setViewportSize({ width: 1200, height: 700 }); await sleep(3000);
s = await st(); console.log(`resize mid-glide: on ${NAMES[s.i]} y=${s.y} panel=${s.t} aligned=${s.ok}`);
// reload lands consistent, safety net invisible
await p.reload({ waitUntil: "load" }); await sleep(3000);
s = await st(); console.log(`reload: on ${NAMES[s.i]} y=${s.y} aligned=${s.ok} fallback shown=${s.fallback}`);
console.log("page errors:", errs.length ? errs : "none");
await b.close();
