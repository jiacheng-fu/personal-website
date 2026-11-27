/* The live page at the clip's resolution, for composite.py: the keyboard at
   rest (board supersampled, copy hidden), the machine with its screen off
   (the ?frame=off plate - exactly how the clip ends), and the same page with
   the machine hidden (for its matte). Needs the dev server running.
   usage: node scripts/bake-transition/capture.mjs [http://127.0.0.1:5173] */
import { chromium } from "playwright-core";
import { mkdirSync } from "fs";
const BASE = process.argv[2] || "http://127.0.0.1:5173";
const OUT = process.env.BAKE_WORK || "node_modules/.cache/bake";
mkdirSync(OUT, { recursive: true });
const hide = ".panel--void .section__label,.panel--void .field-note,.panel--void .kb__caption,.kb-swipehint,.nav,.dots,.cursor{visibility:hidden!important}";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
let page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
await page.goto(`${BASE}/?rag=off&dpr=2`); await page.waitForTimeout(1500);
await page.click('.dots__dot[data-section="craft"]'); await page.waitForTimeout(6000);
await page.addStyleTag({ content: hide }); await page.waitForTimeout(500);
const fill = await page.evaluate(() => { const c = document.querySelector(".panel--void canvas").getBoundingClientRect(); return c.width; });
if (Math.abs(fill - 2560) > 1) throw new Error(`keyboard canvas ${fill}px wide, not 2560: the board would be baked mis-sized`);
await page.screenshot({ path: `${OUT}/ref-kb.png` });
await page.close();
page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
await page.goto(`${BASE}/?frame=off`); await page.waitForTimeout(4000);
await page.addStyleTag({ content: hide }); await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ref-machine.png` });
await page.addStyleTag({ content: ".a2m{visibility:hidden!important}" }); await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ref-paper.png` });
await browser.close();
console.log("captured into", OUT);
