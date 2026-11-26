/* ---------------------------------------------------------------------------
   npm run seam:check

   The keyboard -> machine clip must hand over to the live page with no
   positional jump. This plays the REAL clip in a headless Chrome (never a
   visible window), screenshots its held last frame and then the landed
   machine, and finds the offset between the two by searching for the shift
   that best lines up the machine's case (the glass is skipped: it is black
   in the clip and lit in the page, by design). It fails if they are more
   than 1px apart.

   Why it exists: the "shift" was fixed once against a page with no
   scrollbar, then came back on 2026-11-25 when Brian's Mac started showing
   classic scrollbars (macOS does with a mouse plugged in; Windows always
   does). The clip overlay excluded the 15px bar and the machine placement
   included it - clip 7-8px off. So every case is run with a scrollbar
   forced ON as well as off. A screenshot of the real thing is the test,
   not the code: see docs/transition-kb-machine.md s16 and s20.

   And the way back (2026-11-26): the machine -> keyboard clip ends on a
   held frame of the board, then fades to the live one. It was 2-3px off
   there - Brian's "slight shift" scrolling back up - and nothing checked it,
   because only the forward seam had a guard. Each case now also plays the
   reverse clip and compares its held last frame with the live board.

   Starts its own Vite server; needs Google Chrome installed. ~2 minutes.
   --------------------------------------------------------------------------- */

import { createServer } from "vite";
import { chromium } from "playwright-core";

const TOLERANCE_PX = 1;
/* [width, height, forced classic scrollbar] - 16:9, a MacBook window, a
   wide window and a 16:10 one, the last three with the bar */
const CASES = [
  [1600, 900, false],
  [1600, 900, true],
  [1512, 860, true],
  [1800, 1000, true],
  [1440, 900, true],
];
/* a classic 15px bar, the way Windows and mouse-attached macOS draw one; it
   overrides the site's own scrollbar hiding on purpose, so the measurement
   fix is tested on its own */
const BAR_CSS =
  "html{overflow-y:scroll!important;scrollbar-width:auto!important}" +
  "html::-webkit-scrollbar{display:block!important;width:15px!important;background:#ddd}" +
  "html::-webkit-scrollbar-thumb{background:#999}";

const server = await createServer({ logLevel: "error", server: { port: 5299, strictPort: false } });
await server.listen();
const base = (server.resolvedUrls?.local?.[0] ?? "http://localhost:5299/").replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, channel: "chrome", ignoreDefaultArgs: ["--hide-scrollbars"] });

/** best integer shift lining up two screenshots over a rect (minus `skip`) */
const align = (page, A, C, R, skip) =>
  page.evaluate(
    async ([A, C, R, S]) => {
      const gray = async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data;
        const out = new Float32Array(img.width * img.height);
        for (let i = 0; i < out.length; i++) out[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
        return { px: out, W: img.width };
      };
      const a = await gray(A);
      const c = await gray(C);
      const pts = [];
      for (let y = Math.ceil(R.y); y < R.y + R.h; y += 2)
        for (let x = Math.ceil(R.x); x < R.x + R.w; x += 2) {
          if (S && x > S.x - 6 && x < S.x + S.w + 6 && y > S.y - 6 && y < S.y + S.h + 6) continue;
          pts.push(y * c.W + x);
        }
      let best = { dx: 0, dy: 0, e: Infinity };
      for (let dy = -24; dy <= 24; dy++)
        for (let dx = -24; dx <= 24; dx++) {
          let e = 0;
          for (const i of pts) e += Math.abs(c.px[i] - a.px[i + dy * a.W + dx]);
          e /= pts.length;
          if (e < best.e) best = { dx, dy, e };
        }
      return best;
    },
    [A.toString("base64"), C.toString("base64"), R, skip ?? null],
  );

/** mean luminance of a screenshot over a rect (minus `skip`), 0..255 */
const lumOf = (page, A, R, skip) =>
  page.evaluate(
    async ([A, R, S]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + A;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let sum = 0;
      let n = 0;
      for (let y = Math.ceil(R.y); y < R.y + R.h; y += 2)
        for (let x = Math.ceil(R.x); x < R.x + R.w; x += 2) {
          if (S && x > S.x - 8 && x < S.x + S.w + 8 && y > S.y - 8 && y < S.y + S.h + 8) continue;
          const i = (y * img.width + x) * 4;
          sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          n++;
        }
      return sum / n;
    },
    [A.toString("base64"), R, skip ?? null],
  );
/* the clip's colour at each end must stay within this of the live page's
   (the old brightness patch drifted 9% out over three months unnoticed) */
const LUM_TOLERANCE = 0.04;

let failed = 0;
try {
  for (const [w, h, bar] of CASES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    if (bar)
      await page.addInitScript((css) => {
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = css;
          document.head.append(st);
        });
      }, BAR_CSS);
    /* wipe=off: the clip's own keyboard, unmasked - the live board shows
       through it in normal playback (TransitionPlayer WIPE_X), which would
       hide exactly the register this checks */
    await page.goto(`${base}/?rag=off&wipe=off`);
    await page.waitForTimeout(1500);
    const scrollbar = await page.evaluate(() => innerWidth - document.documentElement.clientWidth);
    await page.click('button[aria-label="craft"]');
    await page.waitForTimeout(4500);
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      () => {
        /* ENDED, not "within 20 ms of the end": a capture that starts in the
           last instant of playback can catch the video layer with no frame
           painted (a blank overlay, measured 2026-11-25). Once it has ended,
           the overlay holds the last frame until App hides it (~260 ms). */
        const v = document.querySelector(".transition video");
        return v && v.ended;
      },
      null,
      { timeout: 20000, polling: "raf" },
    );
    const clip = await page.screenshot({ type: "png" });
    await page.waitForTimeout(2500);
    const live = await page.screenshot({ type: "png" });

    const r = await page.evaluate(
      async ([A, C]) => {
        const rect = (sel) => {
          const e = document.querySelector(sel).getBoundingClientRect();
          return { x: e.left, y: e.top, w: e.width, h: e.height };
        };
        const S = rect(".a2m__stage");
        const G = rect(".a2m__screen");
        const gray = async (b64) => {
          const img = new Image();
          img.src = "data:image/png;base64," + b64;
          await img.decode();
          const cv = document.createElement("canvas");
          cv.width = img.width;
          cv.height = img.height;
          const g = cv.getContext("2d");
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, img.width, img.height).data;
          const out = new Float32Array(img.width * img.height);
          for (let i = 0; i < out.length; i++) out[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
          return { px: out, W: img.width };
        };
        const a = await gray(A);
        const c = await gray(C);
        const pts = [];
        for (let y = Math.ceil(S.y) + 4; y < S.y + S.h - 4; y += 2)
          for (let x = Math.ceil(S.x) + 4; x < S.x + S.w - 4; x += 2) {
            if (x > G.x - 6 && x < G.x + G.w + 6 && y > G.y - 6 && y < G.y + G.h + 6) continue;
            pts.push(y * c.W + x);
          }
        let best = { dx: 0, dy: 0, e: Infinity };
        for (let dy = -24; dy <= 24; dy++)
          for (let dx = -24; dx <= 24; dx++) {
            let e = 0;
            for (const i of pts) e += Math.abs(c.px[i] - a.px[i + dy * a.W + dx]);
            e /= pts.length;
            if (e < best.e) best = { dx, dy, e };
          }
        return best;
      },
      [clip.toString("base64"), live.toString("base64")],
    );
    const ok = Math.abs(r.dx) <= TOLERANCE_PX && Math.abs(r.dy) <= TOLERANCE_PX;
    if (!ok) failed++;
    const box = await page.evaluate(() => {
      const rect = (sel) => {
        const e = document.querySelector(sel).getBoundingClientRect();
        return { x: e.left, y: e.top, w: e.width, h: e.height };
      };
      return { stage: rect(".a2m__stage"), glass: rect(".a2m__screen") };
    });
    const lumClip = await lumOf(page, clip, box.stage, box.glass);
    const lumLive = await lumOf(page, live, box.stage, box.glass);
    const okLum = Math.abs(lumClip / lumLive - 1) <= LUM_TOLERANCE;
    if (!okLum) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${w}x${h} ${bar ? "scrollbar " + scrollbar + "px" : "no scrollbar"}`.padEnd(34) +
        `clip vs machine: dx ${r.dx}, dy ${r.dy}` +
        `   ${okLum ? "" : "FAIL "}luminance ${lumClip.toFixed(1)} vs ${lumLive.toFixed(1)}`,
    );

    /* the way back: the reverse clip's held last frame vs the live board it
       fades to, over the board's middle (the copy is hidden: the clip has none) */
    await page.waitForTimeout(3500);
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(
      () => {
        const v = document.querySelector(".transition video");
        return v && v.ended && v.currentSrc.includes("kb-machine-rev");
      },
      null,
      { timeout: 20000, polling: "raf" },
    );
    const held = await page.screenshot({ type: "png" });
    await page.addStyleTag({
      content: ".panel--void .section__label,.panel--void .field-note,.panel--void .kb__caption,.kb-swipehint,.nav,.dots{visibility:hidden!important}",
    });
    await page.waitForTimeout(2500);
    const board = await page.screenshot({ type: "png" });
    const boardRect = { x: w * 0.15, y: h * 0.12, w: w * 0.7, h: h * 0.76 };
    const back = await align(page, board, held, boardRect);
    const okBack = Math.abs(back.dx) <= TOLERANCE_PX && Math.abs(back.dy) <= TOLERANCE_PX;
    if (!okBack) failed++;
    const lumHeld = await lumOf(page, held, boardRect);
    const lumBoard = await lumOf(page, board, boardRect);
    const okBackLum = Math.abs(lumHeld / lumBoard - 1) <= LUM_TOLERANCE;
    if (!okBackLum) failed++;
    console.log(
      `${okBack && okBackLum ? "ok  " : "FAIL"}`.padEnd(34) +
        `   back: clip vs board: dx ${back.dx}, dy ${back.dy}` +
        `   ${okBackLum ? "" : "FAIL "}luminance ${lumHeld.toFixed(1)} vs ${lumBoard.toFixed(1)}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(failed ? `\n${failed} check(s) failed: shift over ${TOLERANCE_PX}px or luminance over ${LUM_TOLERANCE * 100}%` : "\nseamless in every case");
process.exit(failed ? 1 : 0);
