// Transition QA, any engine:  node qa.mjs <chromium|webkit|firefox> <baseURL> <outDir> [suites...]
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const [, , ENGINE = "chromium", BASE = "http://localhost:4180/", OUT = ".", ...ONLY] = process.argv;
const want = (s) => !ONLY.length || ONLY.includes(s);
const NAMES = ["top", "craft", "ask", "work", "contact"];
const launch = ENGINE === "chromium" ? () => pw.chromium.launch({ headless: true, channel: "chrome" }) : () => pw[ENGINE].launch({ headless: true });
const browser = await launch();
const results = []; let errors = []; let seed = 1337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE = 9000;
async function fresh(w = 1512, h = 860, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...extra });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/.test(m.text())) errors.push("console: " + m.text().slice(0, 160)); });
  await page.goto(BASE, { waitUntil: "load" });
  await sleep(2500);
  return page;
}
async function state(page) {
  return page.evaluate(() => {
    const dots = [...document.querySelectorAll(".dots__dot")];
    const idx = dots.findIndex((d) => d.classList.contains("is-on"));
    const panels = [...document.querySelectorAll(".panel")];
    const top = panels[idx]?.offsetTop ?? -1;
    const cls = (s) => document.querySelector(s)?.className || "";
    const root = document.documentElement;
    return {
      idx, aligned: Math.abs(window.scrollY - top) < 3, scrollY: Math.round(window.scrollY), top,
      clip: document.querySelector(".transition")?.classList.contains("is-on") || false,
      handoff: document.querySelector(".handoff")?.classList.contains("is-on") || false,
      rag: cls(".rag"), wx: cls(".wx"), kb: cls(".panel--void"),
      vars: ["--handoff-scroll", "--handoff-scroll-screen"].filter((v) => root.style.getPropertyValue(v)),
      optin: !!document.querySelector(".a2-optin"),
      workRowsVisible: [...document.querySelectorAll(".wx__list > li")].every((li) => +getComputedStyle(li).opacity > 0.9),
    };
  });
}
async function check(name, page, expectIdx, more = {}, opts = {}) {
  const s = { ...(await state(page)), ...(opts.extra || {}) };
  const problems = [];
  if (expectIdx !== null && s.idx !== expectIdx) problems.push(`dot ${NAMES[s.idx]} != expected ${NAMES[expectIdx]}`);
  if (!s.aligned) problems.push(`scroll ${s.scrollY} not at panel top ${s.top}`);
  if (s.clip) problems.push("clip overlay still on");
  if (s.handoff) problems.push("handoff overlay still on");
  if (/is-continuing|is-scrolled|is-handoff/.test(s.rag)) problems.push(`rag stuck: ${s.rag}`);
  if (/is-lifting/.test(s.wx)) problems.push("index stuck lifting");
  if (/is-departing/.test(s.kb)) problems.push("keyboard stuck departing");
  if (s.vars.length) problems.push(`leftover ${s.vars.join(",")}`);
  if (s.idx === 3 && !s.workRowsVisible) problems.push("project titles not visible");
  for (const [k, v] of Object.entries(more)) if (s[k] !== v) problems.push(`${k}=${s[k]} (want ${v})`);
  // liveness: the nav must still answer
  if (!opts.noLive && s.idx >= 0) {
    const dir = s.idx < 4 ? "ArrowDown" : "ArrowUp";
    await page.keyboard.press(dir); await sleep(SETTLE);
    const after = (await state(page)).idx;
    if (after === s.idx) problems.push(`nav did not answer ${dir} (stuck lock?)`);
    else { await page.keyboard.press(dir === "ArrowDown" ? "ArrowUp" : "ArrowDown"); await sleep(SETTLE); }
  }
  const errs = errors.splice(0);
  if (errs.length) problems.push(...errs.map((e) => "ERR " + e));
  results.push({ engine: ENGINE, name, ok: !problems.length, problems });
  console.log(`${problems.length ? "FAIL" : "ok  "} [${ENGINE}] ${name}${problems.length ? "\n      - " + problems.join("\n      - ") : ""}`);
}
const key = async (p, k, n = 1, gap = 0) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); if (gap) await sleep(gap); } };
const dot = (p, i) => p.locator(`.dots__dot[aria-label="${NAMES[i]}"]`).click({ force: true });
async function flick(p, dir, ms = 1300) { { const v = p.viewportSize(); await p.mouse.move(Math.round(v.width * 0.93), Math.round(v.height * 0.9)); } const t0 = Date.now(); let d = 140; while (Date.now() - t0 < ms) { await p.mouse.wheel(0, dir * Math.max(1, Math.round(d))); d *= 0.93; await sleep(16); } }

const codecs = await (await fresh(400, 300)).evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'));
console.log(`[${ENGINE}] H.264 mp4 support: "${codecs}"`);

if (want("core")) {
  const p = await fresh();
  for (let i = 1; i <= 4; i++) { await key(p, "ArrowDown"); await sleep(SETTLE); await check(`down into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  for (let i = 3; i >= 0; i--) { await key(p, "ArrowUp"); await sleep(SETTLE); await check(`up into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  await p.context().close();
}
if (want("input")) {
  const p = await fresh();
  for (let i = 1; i <= 4; i++) { await key(p, "ArrowDown", 12, 60); await sleep(SETTLE); await check(`key spam into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  for (let i = 3; i >= 0; i--) { await flick(p, -1); await sleep(SETTLE); await check(`one flick up into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  await p.context().close();
}
if (want("reverse")) {
  const p = await fresh();
  await key(p, "ArrowDown"); await sleep(SETTLE);
  for (const d of [150, 400, 900, 1600]) { await key(p, "ArrowDown"); await sleep(d); await key(p, "ArrowUp"); await sleep(SETTLE + 2000); await check(`reverse ${d}ms into kb->machine`, p, null); }
  await dot(p, 2); await sleep(SETTLE);
  for (const d of [300, 1200, 2500, 3600]) { const s0 = (await state(p)).idx; if (s0 !== 2) { await dot(p, 2); await sleep(SETTLE); } await key(p, "ArrowDown"); await sleep(d); await key(p, "ArrowUp"); await sleep(SETTLE + 4000); await check(`reverse ${d}ms into machine->projects`, p, null); }
  await p.context().close();
}
if (want("jumps")) {
  const p = await fresh();
  for (const b of [3, 0, 4, 1, 4, 2, 0, 2, 4, 1, 3, 1]) { await dot(p, b); await sleep(SETTLE); await check(`dot jump to ${NAMES[b]}`, p, b, {}, { noLive: true }); }
  await p.context().close();
}
if (want("motionoff")) {
  const p = await fresh();
  await p.locator(".nav__sound, [aria-label*='ransitions'], .nav [aria-pressed]").first().click(); await sleep(500);
  for (let i = 1; i <= 4; i++) { await key(p, "ArrowDown"); await sleep(4000); await check(`motion off: into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  await p.context().close();
}
if (want("optin")) {
  const p = await fresh();
  await dot(p, 2); await p.waitForSelector(".a2-prompt input", { timeout: 60000 }); await sleep(2500);
  await p.locator(".a2-llm").first().click(); await p.waitForSelector(".a2-optin"); await sleep(400);
  await key(p, "ArrowDown"); await sleep(SETTLE); await check("opt-in open -> down", p, 3, {}, { noLive: true });
  await key(p, "ArrowUp"); await sleep(SETTLE + 2000); await check("back up: opt-in dismissed", p, 2, { optin: false }, { noLive: true });
  await p.context().close();
}
if (want("reload")) {
  const p = await fresh();
  for (const b of [2, 3, 4]) { await dot(p, b); await sleep(SETTLE); await p.reload({ waitUntil: "load" }); await sleep(3500); await check(`reload on ${NAMES[b]} comes back to ${NAMES[b]}`, p, b); }
  await p.context().close();
}
if (want("touch") && ENGINE === "chromium") {
  const p = await fresh(390, 844, { isMobile: true, hasTouch: true });
  const cdp = await p.context().newCDPSession(p);
  const swipe = async (dy) => {
    const x = 195, y0 = 520, steps = 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - (dy * i) / steps }] }); await sleep(12); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  for (let i = 1; i <= 4; i++) { await swipe(220); await sleep(SETTLE); await check(`touch swipe up into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  for (let i = 3; i >= 0; i--) { await swipe(-220); await sleep(SETTLE); await check(`touch swipe down into ${NAMES[i]}`, p, i, {}, { noLive: true }); }
  await swipe(20); await sleep(3000); await check("tiny swipe does not move", p, 0, {}, { noLive: true });
  await p.context().close();
}
if (want("reduced")) {
  const p = await fresh(1512, 860, { reducedMotion: "reduce" });
  const info = await p.evaluate(async () => {
    const panels = [...document.querySelectorAll(".panel")];
    const out = [];
    for (const pnl of panels) { window.scrollTo(0, pnl.offsetTop); await new Promise((r) => setTimeout(r, 600)); out.push({ id: pnl.id, h: pnl.offsetHeight, text: (pnl.innerText || "").trim().length }); }
    const rows = [...document.querySelectorAll(".wx__list > li")].map((li) => +getComputedStyle(li).opacity);
    return { out, rowsMin: Math.min(...rows) };
  });
  const prob = info.out.filter((x) => x.text < 5 && x.id !== "craft").map((x) => `${x.id} looks empty`);
  if (info.rowsMin < 0.9) prob.push(`project rows invisible (opacity ${info.rowsMin})`);
  await p.mouse.move(700, 400); await p.mouse.wheel(0, 400); await sleep(800);
  const y = await p.evaluate(() => scrollY);
  console.log(`      reduced motion: sections ${info.out.map((x) => `${x.id}:${x.text}ch`).join(" ")}, native wheel scrolled to ${y}`);
  const errs = errors.splice(0); prob.push(...errs);
  results.push({ engine: ENGINE, name: "reduced motion: all content visible", ok: !prob.length, problems: prob });
  console.log(`${prob.length ? "FAIL" : "ok  "} [${ENGINE}] reduced motion: all content visible${prob.length ? "\n      - " + prob.join("\n      - ") : ""}`);
  await p.context().close();
}
if (want("frozen") && ENGINE === "chromium") {
  const p = await fresh();
  const cdp = await p.context().newCDPSession(p);
  await dot(p, 1); await sleep(SETTLE);
  await key(p, "ArrowDown"); await sleep(700);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" }); await sleep(5000);
  await cdp.send("Page.setWebLifecycleState", { state: "active" }); await sleep(SETTLE + 3000);
  await check("tab frozen mid kb->machine clip", p, null);
  await dot(p, 2); await sleep(SETTLE);
  await key(p, "ArrowDown"); await sleep(1500);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" }); await sleep(5000);
  await cdp.send("Page.setWebLifecycleState", { state: "active" }); await sleep(SETTLE + 4000);
  await check("tab frozen mid machine->projects handoff", p, null);
  await p.context().close();
}
if (want("resize")) {
  const p = await fresh();
  await dot(p, 1); await sleep(SETTLE);
  await key(p, "ArrowDown"); await sleep(900); await p.setViewportSize({ width: 1100, height: 760 }); await sleep(SETTLE + 2000);
  await check("resize mid kb->machine clip", p, null);
  await dot(p, 2); await sleep(SETTLE);
  await key(p, "ArrowDown"); await sleep(1500); await p.setViewportSize({ width: 1920, height: 1080 }); await sleep(SETTLE + 3000);
  await check("resize mid machine->projects handoff", p, null);
  await p.setViewportSize({ width: 844, height: 390 }); await sleep(3000);
  await check("rotate to landscape phone on projects", p, null);
  await p.context().close();
}
if (want("fuzz")) {
  for (let round = 1; round <= 3; round++) {
    const p = await fresh();
    const acts = [];
    for (let i = 0; i < 35; i++) {
      const r = rnd(); const d = Math.floor(rnd() * 2600);
      if (r < 0.25) { acts.push(`Down+${d}`); await key(p, "ArrowDown"); }
      else if (r < 0.45) { acts.push(`Up+${d}`); await key(p, "ArrowUp"); }
      else if (r < 0.6) { acts.push(`flick${r < 0.52 ? "Up" : "Down"}+${d}`); await flick(p, r < 0.52 ? -1 : 1, 600); }
      else if (r < 0.8) { const b = Math.floor(rnd() * 5); acts.push(`dot${b}+${d}`); await dot(p, b); }
      else if (r < 0.9) { acts.push(`Space+${d}`); await key(p, "Space"); }
      else { acts.push(`motion+${d}`); await p.locator(".nav__sound, [aria-label*='ransitions'], .nav [aria-pressed]").first().click({ force: true }).catch(() => {}); }
      await sleep(d);
    }
    await sleep(SETTLE + 4000);
    await check(`fuzz round ${round} (35 random actions)`, p, null);
    if (!results.at(-1).ok) console.log(`      actions: ${acts.join(" ")}`);
    await p.context().close();
  }
}
if (want("soak") && ENGINE === "chromium") {
  const p = await fresh();
  const snap = () => p.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1 }));
  const a = await snap();
  for (let c = 0; c < 6; c++) { for (let i = 0; i < 4; i++) { await key(p, "ArrowDown"); await sleep(6500); } for (let i = 0; i < 4; i++) { await key(p, "ArrowUp"); await sleep(6500); } }
  await sleep(3000);
  const cdp = await p.context().newCDPSession(p); await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  await sleep(1000);
  const b = await snap();
  console.log(`      soak: DOM nodes ${a.nodes} -> ${b.nodes}, JS heap ${a.heap} MB -> ${b.heap} MB over 6 full cycles`);
  const prob = [];
  if (b.nodes > a.nodes * 1.25 + 50) prob.push(`DOM grew ${a.nodes} -> ${b.nodes}`);
  if (a.heap > 0 && b.heap > a.heap * 1.6 + 30) prob.push(`heap grew ${a.heap} -> ${b.heap} MB`);
  results.push({ engine: ENGINE, name: "soak: no runaway growth", ok: !prob.length, problems: prob });
  console.log(`${prob.length ? "FAIL" : "ok  "} [${ENGINE}] soak: no runaway growth${prob.length ? "\n      - " + prob.join("\n      - ") : ""}`);
  await check("soak: state after 6 cycles", p, 0, {}, { noLive: false });
  await p.context().close();
}
await browser.close();
const bad = results.filter((r) => !r.ok);
fs.writeFileSync(`${OUT}/results-${ENGINE}.json`, JSON.stringify(results, null, 2));
console.log(`\n[${ENGINE}] ${results.length - bad.length}/${results.length} passed`);
