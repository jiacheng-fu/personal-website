// Window size / aspect ratio QA.
//   node ratio.mjs <engine> <baseURL> <outDir> <suite> [shard k/n]
// suites: sweep (every size, down+up, clip expectations, layout, screenshots)
//         live   (resizes across the thresholds mid-visit and mid-transition)
//         boxed  (the ultrawide prompt, both answers, reload, resizes while boxed)
//         storm  (resize storms on every section)
import { createRequire } from "module";
import fs from "fs";
import { execFileSync } from "child_process";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const [, , ENGINE = "chromium", BASE = "http://localhost:4183/", OUT = ".", SUITE = "sweep", SHARD = "0/1"] = process.argv;
const [K, N] = SHARD.split("/").map(Number);
const NAMES = ["top", "craft", "ask", "work", "contact"];
const SHOTS = `${OUT}/shots`;
fs.mkdirSync(SHOTS, { recursive: true });
const browser = ENGINE === "chromium" ? await pw.chromium.launch({ headless: true, channel: "chrome" }) : await pw[ENGINE].launch({ headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let errors = [];
const SETTLE = 9000;
const CUT = 5000;

async function fresh(w, h, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...extra });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/.test(m.text())) errors.push("console: " + m.text().slice(0, 160)); });
  await page.goto(BASE, { waitUntil: "load" });
  await sleep(2500);
  return page;
}

/* everything about the page we assert on, in one evaluate */
const state = (page) => page.evaluate(() => {
  const de = document.documentElement;
  const vw = de.clientWidth, vh = de.clientHeight;
  const dots = [...document.querySelectorAll(".dots__dot")];
  const idx = dots.findIndex((d) => d.classList.contains("is-on"));
  const panels = [...document.querySelectorAll(".panel")];
  const top = panels[idx]?.offsetTop ?? -1;
  const cls = (s) => document.querySelector(s)?.className || "";
  const boxed = de.classList.contains("is-boxed");
  const fw = boxed ? Math.min(vw, Math.round(vh * 16 / 9)) : vw;
  const fl = boxed ? Math.round((vw - fw) / 2) : 0;
  const allowed = fw >= 720 && fw / vh >= 1.45 && fw / vh <= 2.05;
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };

  /* text the visitor cannot see because it is off the screen (or out of the frame) */
  const off = [];
  const panel = panels[idx];
  if (panel) {
    const tw = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    while (tw.nextNode() && off.length < 6) {
      const t = tw.currentNode; const txt = t.textContent.trim(); if (!txt) continue;
      const el = t.parentElement; if (!el || el.closest(".visually-hidden, .sr-only, svg")) continue; // svg text: em box > glyphs; screenshots cover it
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue;
      let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) o *= +getComputedStyle(e).opacity; if (o < 0.05) continue;
      const rg = document.createRange(); rg.selectNodeContents(t); const b = rg.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      // visible area of the panel = the viewport (or the frame)
      if (b.left < fl - 2 || b.right > fl + fw + 2 || b.top < -2 || b.bottom > vh + 2)
        off.push(`"${txt.slice(0, 28)}" @${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
  }
  return {
    vw, vh, boxed, fw, fl, allowed, idx,
    aligned: Math.abs(window.scrollY - top) < 3, scrollY: Math.round(window.scrollY), top,
    clip: document.querySelector(".transition")?.classList.contains("is-on") || false,
    handoff: document.querySelector(".handoff")?.classList.contains("is-on") || false,
    rag: cls(".rag"), wx: cls(".wx"), kb: cls(".panel--void"),
    vars: ["--handoff-scroll", "--handoff-scroll-screen"].filter((v) => de.style.getPropertyValue(v)),
    prompt: !!document.querySelector(".framechoice"),
    sideways: de.scrollWidth > vw + 1 ? de.scrollWidth : 0,
    rowsVisible: [...document.querySelectorAll(".wx__list > li")].every((li) => +getComputedStyle(li).opacity > 0.9),
    glass: r(".a2m__screen"), app: r(".app"), dotsR: r(".dots"), canvas: r(".panel--void canvas"),
    frameVars: ["--frame-left", "--frame-w", "--frame-h"].map((v) => de.style.getPropertyValue(v)).join(" "),
    off,
  };
});

/* what is wrong with the page right now, given the section we expect */
function problemsOf(s, expectIdx) {
  const p = [];
  if (expectIdx !== null && s.idx !== expectIdx) p.push(`dot ${NAMES[s.idx]} != ${NAMES[expectIdx]}`);
  if (!s.aligned) p.push(`scroll ${s.scrollY} not at panel top ${s.top}`);
  if (s.clip) p.push("clip overlay still on");
  if (s.handoff) p.push("handoff overlay still on");
  if (/is-continuing|is-scrolled|is-handoff/.test(s.rag)) p.push(`rag stuck: ${s.rag}`);
  if (/is-lifting/.test(s.wx)) p.push("index stuck lifting");
  if (/is-departing/.test(s.kb)) p.push("keyboard stuck departing");
  if (s.vars.length) p.push(`leftover ${s.vars.join(",")}`);
  if (s.idx === 3 && !s.rowsVisible) p.push("project titles not visible");
  if (s.sideways) p.push(`page scrolls sideways (${s.sideways} > ${s.vw})`);
  if (s.idx === 2 && s.glass) {
    const g = s.glass;
    if (g.l < s.fl - 2 || g.r > s.fl + s.fw + 2 || g.t < -2 || g.b > s.vh + 2) p.push(`machine glass off screen ${JSON.stringify(g)} in ${s.fw}x${s.vh}`);
    if (g.w < 120) p.push(`machine glass tiny (${g.w}px)`);
  }
  if (s.off.length) p.push(`off-screen text: ${s.off.join("; ")}`);
  return p;
}

async function watchStart(p) {
  await p.evaluate(() => {
    window.__seen = { clip: false, handoff: false };
    clearInterval(window.__seenT);
    window.__seenT = setInterval(() => {
      if (document.querySelector(".transition.is-on")) window.__seen.clip = true;
      if (document.querySelector(".handoff.is-on")) window.__seen.handoff = true;
    }, 25);
  });
}
const watchEnd = (p) => p.evaluate(() => { clearInterval(window.__seenT); return window.__seen; });

function report(name, problems) {
  const errs = errors.splice(0);
  problems = [...problems, ...errs.map((e) => "ERR " + e)];
  results.push({ engine: ENGINE, suite: SUITE, name, ok: !problems.length, problems });
  console.log(`${problems.length ? "FAIL" : "ok  "} [${ENGINE}] ${name}${problems.length ? "\n      - " + problems.join("\n      - ") : ""}`);
}

async function live(p) {
  const s = await state(p);
  const dir = s.idx < 4 ? "ArrowDown" : "ArrowUp";
  await p.keyboard.press(dir); await sleep(SETTLE);
  const a = (await state(p)).idx;
  if (a === s.idx) return [`nav did not answer ${dir} (stuck lock?)`];
  await p.keyboard.press(dir === "ArrowDown" ? "ArrowUp" : "ArrowDown"); await sleep(SETTLE);
  return [];
}

const slugOf = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
function montage(slug, files) {
  // each section scaled to 560 wide, side by side - one strip per window size
  const args = [];
  files.forEach((f) => args.push("-i", f));
  const sc = files.map((_, i) => `[${i}]scale=560:-2[s${i}]`).join(";");
  const st = files.map((_, i) => `[s${i}]`).join("") + `hstack=inputs=${files.length}`;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args, "-filter_complex", `${sc};${st}`, "-frames:v", "1", `${OUT}/strip-${slug}.png`]);
  } catch (e) { console.log("montage failed", slug, String(e).slice(0, 200)); }
}

/* ---- sweep ------------------------------------------------------------- */
const SIZES = [
  // name, w, h, context extras
  ["16:9 1920x1080", 1920, 1080],
  ["16:9 2560x1440", 2560, 1440],
  ["Chrome window on a 1440p monitor 2560x1305", 2560, 1305],
  ["Chrome window on a 1080p monitor 1920x969", 1920, 969],
  ["4K 3840x2160", 3840, 2160],
  ["16:9 1280x720", 1280, 720],
  ["1366x768 laptop", 1366, 768],
  ["MacBook 14 1512x982", 1512, 982],
  ["MacBook window 1512x860", 1512, 860],
  ["16:10 1440x900", 1440, 900],
  ["4:3 iPad landscape 1024x768", 1024, 768, { isMobile: true, hasTouch: true }],
  ["iPad portrait 768x1024", 768, 1024, { isMobile: true, hasTouch: true }],
  ["phone portrait 390x844", 390, 844, { isMobile: true, hasTouch: true }],
  ["phone landscape 844x390", 844, 390, { isMobile: true, hasTouch: true }],
  ["big phone landscape 932x430", 932, 430, { isMobile: true, hasTouch: true }],
  ["half-width window on 16:9 960x1080", 960, 1080],
  ["tall narrow window 900x1400", 900, 1400],
  ["tiny 640x400", 640, 400],
  ["edge 720x480 (clips on)", 720, 480],
  ["edge 719x480 (clips off)", 719, 480],
  ["edge aspect 1.45 1450x1000", 1450, 1000],
  ["edge aspect 1.44 1440x1000", 1440, 1000],
  ["edge aspect 2.05 2050x1000", 2050, 1000],
  ["edge aspect 2.06 2060x1000", 2060, 1000],
  ["short wide window 1920x700", 1920, 700],
  ["21:9 ultrawide 3440x1440 (hard cuts)", 3440, 1440],
  ["32:9 super ultrawide 5120x1440 (hard cuts)", 5120, 1440],
  ["devtools docked: 1920x560", 1920, 560],
];

async function sweep(name, w, h, extra = {}) {
  const p = await fresh(w, h, extra);
  const slug = slugOf(name);
  const probs = [];
  let s = await state(p);
  const wantPrompt = !extra.hasTouch && s.vw >= 720 && s.vw / s.vh > 2.05 && Math.round(s.vh * 16 / 9) >= 720;
  const info = [`layout ${s.vw}x${s.vh} aspect ${(s.vw / s.vh).toFixed(3)} clips ${s.allowed ? "ON" : "off"}${s.prompt ? ", ultrawide prompt shown" : ""}`];
  if (s.prompt !== wantPrompt) probs.push(`ultrawide prompt ${s.prompt ? "shown" : "missing"} (aspect ${(s.vw / s.vh).toFixed(2)})`);
  if (s.prompt) { await p.getByRole("button", { name: /Full width/ }).click(); await sleep(400); s = await state(p); }
  const files = [];
  const snap = async (i) => { const f = `${SHOTS}/${slug}-${i}-${NAMES[i]}.png`; await p.screenshot({ path: f }); files[i] = f; };
  await snap(0);
  probs.push(...problemsOf(await state(p), 0).map((x) => `top: ${x}`));
  const seenLog = [];
  for (let i = 1; i <= 4; i++) {
    await watchStart(p);
    await p.keyboard.press("ArrowDown");
    await sleep(s.allowed ? SETTLE : CUT);
    const seen = await watchEnd(p);
    seenLog.push(`${NAMES[i - 1]}->${NAMES[i]}:${seen.clip ? "clip" : seen.handoff ? "handoff" : "cut"}`);
    if (i === 2 && seen.clip !== s.allowed) probs.push(`craft->ask: clip ${seen.clip ? "played" : "did not play"} (clips ${s.allowed ? "on" : "off"})`);
    if (i === 3 && seen.handoff !== s.allowed) probs.push(`ask->work: handoff ${seen.handoff ? "played" : "did not play"} (clips ${s.allowed ? "on" : "off"})`);
    await snap(i);
    probs.push(...problemsOf(await state(p), i).map((x) => `${NAMES[i]}: ${x}`));
  }
  for (let i = 3; i >= 0; i--) {
    await watchStart(p);
    await p.keyboard.press("ArrowUp");
    await sleep(s.allowed ? SETTLE : CUT);
    const seen = await watchEnd(p);
    seenLog.push(`${NAMES[i + 1]}->${NAMES[i]}:${seen.clip ? "clip" : seen.handoff ? "handoff" : "cut"}`);
    if (i === 2 && seen.handoff !== s.allowed) probs.push(`work->ask: handoff ${seen.handoff ? "played" : "did not play"}`);
    if (i === 1 && seen.clip !== s.allowed) probs.push(`ask->craft: clip ${seen.clip ? "played" : "did not play"}`);
    probs.push(...problemsOf(await state(p), i).map((x) => `${NAMES[i]} (up): ${x}`));
  }
  montage(slug, files);
  console.log(`      ${name}: ${info.join(" ")} | ${seenLog.join(" ")}`);
  report(`sweep ${name}`, probs);
  await p.context().close();
}

/* ---- live resizes ------------------------------------------------------ */
const size = (p, w, h) => p.setViewportSize({ width: w, height: h });
async function step(p, name, expectIdx, opts = {}) {
  const s = await state(p);
  const probs = problemsOf(s, expectIdx);
  if (opts.allowed !== undefined && s.allowed !== opts.allowed) probs.push(`clips ${s.allowed ? "on" : "off"}, expected ${opts.allowed ? "on" : "off"}`);
  if (opts.shot) await p.screenshot({ path: `${SHOTS}/live-${slugOf(name)}.png` });
  if (opts.live) probs.push(...(await live(p)));
  report(name, probs);
  return s;
}
async function move(p, key, expectSeen) {
  await watchStart(p);
  await p.keyboard.press(key);
  await sleep(expectSeen === "cut" ? CUT : SETTLE);
  const seen = await watchEnd(p);
  return seen.clip ? "clip" : seen.handoff ? "handoff" : "cut";
}

async function liveSuite() {
  /* A. moving the window between monitors / snapping it, one section at a time */
  {
    const p = await fresh(1920, 1080);
    let got = await move(p, "ArrowDown", "cut");
    await step(p, "A1 16:9: down to craft", 1);
    await size(p, 3440, 1440); await sleep(1500);
    await step(p, "A2 resized to 21:9 on craft (no prompt mid-visit, clips off)", 1, { allowed: false, shot: true });
    got = await move(p, "ArrowDown", "cut");
    await step(p, `A3 21:9: down to ask (${got}, want cut)`, 2, { shot: true });
    if (got !== "cut") report("A3b 21:9 must be a hard cut", [`got ${got}`]);
    await size(p, 1920, 1080); await sleep(1500);
    await step(p, "A4 back to 16:9 on ask: machine re-placed on screen", 2, { allowed: true, shot: true });
    got = await move(p, "ArrowDown", "handoff");
    await step(p, `A5 16:9: down to work (${got}, want handoff)`, 3);
    if (got !== "handoff") report("A5b 16:9 handoff must play", [`got ${got}`]);
    await size(p, 390, 844); await sleep(1500);
    await step(p, "A6 squeezed to phone width on work", 3, { allowed: false, shot: true });
    got = await move(p, "ArrowUp", "cut");
    await step(p, `A7 phone width: up to ask (${got}, want cut)`, 2, { shot: true });
    await size(p, 2560, 1440); await sleep(1500);
    await step(p, "A8 1440p on ask", 2, { allowed: true, shot: true });
    got = await move(p, "ArrowUp", "clip");
    await step(p, `A9 1440p: up to craft (${got}, want clip)`, 1, { shot: true });
    if (got !== "clip") report("A9b 1440p reverse clip must play", [`got ${got}`]);
    await size(p, 1024, 768); await sleep(1500);
    got = await move(p, "ArrowDown", "cut");
    await step(p, `A10 4:3: down to ask (${got}, want cut)`, 2, { shot: true, live: true });
    await p.context().close();
  }
  /* B. resizes ACROSS a threshold in the middle of each transition */
  const mid = async (label, setup, keyName, at, w, h, expectIdx) => {
    const p = await fresh(1920, 1080);
    await setup(p);
    await p.keyboard.press(keyName); await sleep(at);
    await size(p, w, h);
    await sleep(SETTLE + 3000);
    await step(p, `B ${label}`, expectIdx, { shot: true, live: true });
    await p.context().close();
  };
  const toCraft = async (p) => { await p.keyboard.press("ArrowDown"); await sleep(CUT); };
  const toAsk = async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); };
  const toWork = async (p) => { await toAsk(p); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); };
  await mid("kb->machine clip, 600ms in, window goes 21:9", toCraft, "ArrowDown", 600, 3440, 1440, 2);
  await mid("kb->machine clip, 1500ms in, window goes portrait", toCraft, "ArrowDown", 1500, 800, 1200, 2);
  await mid("kb->machine clip, 200ms in (before it plays), window goes tiny", toCraft, "ArrowDown", 200, 640, 400, 2);
  await mid("machine->work handoff, 800ms in, window goes 21:9", toAsk, "ArrowDown", 800, 3440, 1440, 3);
  await mid("machine->work handoff, 2000ms in, window goes portrait", toAsk, "ArrowDown", 2000, 700, 1000, 3);
  await mid("work->machine runBack, 600ms in, window goes phone", toWork, "ArrowUp", 600, 390, 844, 2);
  await mid("work->machine runBack, 1800ms in, window goes 4:3", toWork, "ArrowUp", 1800, 1024, 768, 2);
  await mid("machine->kb reverse clip, 400ms in, window goes 21:9", toAsk, "ArrowUp", 400, 3440, 1440, 1);
  await mid("machine->kb reverse clip, 1500ms in, window goes 1080p->4K", toAsk, "ArrowUp", 1500, 3840, 2160, 1);
  /* C. the other way: start where clips are off, become 16:9 mid-move */
  {
    const p = await fresh(1024, 768);
    await p.keyboard.press("ArrowDown"); await sleep(CUT);
    await p.keyboard.press("ArrowDown"); await sleep(300); await size(p, 1920, 1080); await sleep(SETTLE);
    await step(p, "C1 4:3 hard cut craft->ask, window becomes 16:9 300ms in", 2, { shot: true });
    const got = await move(p, "ArrowDown", "handoff");
    await step(p, `C2 now 16:9: ask->work (${got}, want handoff)`, 3, { live: true });
    await p.context().close();
  }
  /* D. reload at a ratio where clips are off, on each section */
  {
    const p = await fresh(3440, 1440);
    if (await p.locator(".framechoice").count()) await p.getByRole("button", { name: /Full width/ }).click();
    for (const b of [2, 3, 4]) {
      await p.locator(`.dots__dot[aria-label="${NAMES[b]}"]`).click({ force: true }); await sleep(CUT + 2000);
      await p.reload({ waitUntil: "load" }); await sleep(4000);
      const s = await step(p, `D reload on ${NAMES[b]} at 21:9 (full width) comes back to ${NAMES[b]}`, b, { shot: true });
      if (s.prompt) report(`D prompt came back after reload on ${NAMES[b]}`, ["prompt shown again"]);
    }
    await p.context().close();
  }
}

/* ---- boxed ------------------------------------------------------------- */
async function boxedSuite() {
  for (const [w, h] of [[3440, 1440], [5120, 1440]]) {
    const p = await fresh(w, h);
    const tag = `${w}x${h}`;
    report(`boxed ${tag}: prompt shown on load`, (await p.locator(".framechoice").count()) ? [] : ["no prompt"]);
    // nav before answering: what does a key do with the prompt up?
    await p.keyboard.press("ArrowDown"); await sleep(CUT);
    const pre = await state(p);
    console.log(`      ${tag}: ArrowDown with the prompt open -> section ${NAMES[pre.idx]}, prompt still ${pre.prompt ? "up" : "gone"}`);
    await p.screenshot({ path: `${SHOTS}/boxed-${tag}-prompt-after-key.png` });
    await p.keyboard.press("ArrowUp"); await sleep(CUT);
    await p.getByRole("button", { name: /16:9 frame/ }).click(); await sleep(800);
    let s = await state(p);
    const fw = Math.min(w, Math.round(h * 16 / 9)), fl = Math.round((w - fw) / 2);
    const bp = [];
    if (!s.boxed) bp.push("not boxed");
    if (!s.allowed) bp.push("clips not allowed in the 16:9 frame");
    if (!s.app || Math.abs(s.app.l - fl) > 2 || Math.abs(s.app.w - fw) > 2) bp.push(`app box ${JSON.stringify(s.app)} want left ${fl} width ${fw}`);
    if (s.dotsR && (s.dotsR.r > fl + fw + 1)) bp.push(`dots outside the frame ${JSON.stringify(s.dotsR)}`);
    if (s.canvas && (s.canvas.l < fl - 2 || s.canvas.r > fl + fw + 2)) bp.push(`keyboard canvas spills out of the frame ${JSON.stringify(s.canvas)}`);
    await p.screenshot({ path: `${SHOTS}/boxed-${tag}-0-top.png` });
    report(`boxed ${tag}: frame is ${fw}x${h} at ${fl}`, bp);
    const files = [`${SHOTS}/boxed-${tag}-0-top.png`];
    for (let i = 1; i <= 4; i++) {
      // overlay must draw inside the frame while it plays
      const ov = p.evaluate(() => new Promise((res) => {
        const t0 = performance.now(); const out = [];
        const tick = () => {
          for (const sel of [".transition.is-on", ".handoff.is-on"]) {
            const e = document.querySelector(sel); if (e) { const b = e.getBoundingClientRect(); out.push(`${sel}:${Math.round(b.left)}+${Math.round(b.width)}`); }
          }
          if (performance.now() - t0 < 6000) requestAnimationFrame(tick); else res([...new Set(out)]);
        };
        tick();
      }));
      await sleep(50);
      await p.keyboard.press("ArrowDown");
      const boxes = await ov;
      await sleep(SETTLE - 6000);
      const f = `${SHOTS}/boxed-${tag}-${i}-${NAMES[i]}.png`; await p.screenshot({ path: f }); files.push(f);
      const probs = problemsOf(await state(p), i);
      const clipBoxes = boxes.filter((b) => b.startsWith(".transition"));
      if (i === 2 && !clipBoxes.length) probs.push("kb->machine clip did not play in the frame");
      for (const b of clipBoxes) { const [, l, wd] = b.match(/:(-?\d+)\+(\d+)/); if (Math.abs(+l - fl) > 2 || Math.abs(+wd - fw) > 2) probs.push(`clip overlay at ${l}+${wd}, frame is ${fl}+${fw}`); }
      if (i === 3 && !boxes.some((b) => b.startsWith(".handoff"))) probs.push("handoff did not play");
      report(`boxed ${tag}: down into ${NAMES[i]} (${boxes.join(" ") || "no overlay"})`, probs);
    }
    montage(`boxed-${tag}`, files);
    for (let i = 3; i >= 0; i--) { await p.keyboard.press("ArrowUp"); await sleep(SETTLE); report(`boxed ${tag}: up into ${NAMES[i]}`, problemsOf(await state(p), i)); }
    // reload keeps the frame and does not ask again
    await p.locator('.dots__dot[aria-label="work"]').click({ force: true }); await sleep(SETTLE);
    await p.reload({ waitUntil: "load" }); await sleep(4000);
    s = await state(p);
    const rp = problemsOf(s, 3);
    if (!s.boxed) rp.push("frame lost on reload"); if (s.prompt) rp.push("asked again on reload");
    report(`boxed ${tag}: reload on work keeps the frame, no prompt, back on work`, rp);
    // resizes while boxed
    for (const [rw, rh, want] of [[1920, 1080, true], [1080, 1920, false], [5120, 1440, true], [1280, 1024, false], [3440, 1440, true]]) {
      await size(p, rw, rh); await sleep(1800);
      const st = await state(p);
      const q = problemsOf(st, 3);
      if (st.allowed !== want) q.push(`clips ${st.allowed ? "on" : "off"} want ${want ? "on" : "off"}`);
      const efw = Math.min(rw, Math.round(rh * 16 / 9));
      if (!st.app || Math.abs(st.app.w - efw) > 2) q.push(`app width ${st.app?.w} want ${efw}`);
      report(`boxed ${tag}: resized to ${rw}x${rh} on work (frame ${efw})`, q);
    }
    await p.screenshot({ path: `${SHOTS}/boxed-${tag}-after-resizes.png` });
    await p.context().close();
  }
  // answering "full width" at 21:9: no clips, no frame, and a reload does not ask again
  const p = await fresh(3440, 1440);
  await p.getByRole("button", { name: /Full width/ }).click(); await sleep(500);
  await p.reload({ waitUntil: "load" }); await sleep(3500);
  const s = await state(p);
  report("full width at 21:9: reload does not ask again, not boxed", [...(s.prompt ? ["asked again"] : []), ...(s.boxed ? ["boxed"] : [])]);
  await p.context().close();
}

/* ---- storms ------------------------------------------------------------ */
async function stormSuite() {
  const SZ = [[1920, 1080], [3440, 1440], [390, 844], [1024, 768], [2560, 1305], [800, 1200], [1440, 900], [5120, 1440], [700, 400], [1512, 860]];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const p = await fresh(1920, 1080);
  for (let target = 0; target <= 4; target++) {
    if (target) { await size(p, 1920, 1080); await sleep(600); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); }
    for (let i = 0; i < 18; i++) { const [w, h] = SZ[Math.floor(rnd() * SZ.length)]; await size(p, w, h); await sleep(40 + Math.floor(rnd() * 140)); }
    await size(p, 1920, 1080); await sleep(3000);
    await step(p, `storm on ${NAMES[target]}: 18 resizes in ~2 s, back to 16:9`, target, { shot: true });
  }
  // storm DURING moves: resize while pressing keys
  const p2 = await fresh(1920, 1080);
  const acts = [];
  for (let i = 0; i < 30; i++) {
    const r = rnd();
    if (r < 0.35) { acts.push("D"); await p2.keyboard.press("ArrowDown"); }
    else if (r < 0.6) { acts.push("U"); await p2.keyboard.press("ArrowUp"); }
    else { const [w, h] = SZ[Math.floor(rnd() * SZ.length)]; acts.push(`${w}x${h}`); await size(p2, w, h); }
    await sleep(Math.floor(rnd() * 1800));
  }
  await size(p2, 1920, 1080); await sleep(SETTLE + 4000);
  await step(p2, "storm: 30 random keys and resizes", null, { shot: true, live: true });
  if (!results.at(-1).ok) console.log("      actions: " + acts.join(" "));
  await p.context().close(); await p2.context().close();
}

if (SUITE === "sweep") { for (let i = 0; i < SIZES.length; i++) if (i % N === K) await sweep(...SIZES[i]); }
if (SUITE === "live") await liveSuite();
if (SUITE === "boxed") await boxedSuite();
if (SUITE === "storm") await stormSuite();
await browser.close();
const bad = results.filter((r) => !r.ok);
fs.writeFileSync(`${OUT}/ratio-${SUITE}-${ENGINE}-${K}.json`, JSON.stringify(results, null, 2));
console.log(`\n[${ENGINE} ${SUITE} ${SHARD}] ${results.length - bad.length}/${results.length} passed`);
