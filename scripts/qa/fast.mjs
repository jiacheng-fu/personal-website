// Fast input, the LLM opt-in under every kind of exit, and reload edge cases.
//   node fast.mjs <engine> <baseURL> <outDir> <suite...>   suites: fast optin reload
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const [, , ENGINE = "chromium", BASE = "http://localhost:4184/", OUT = ".", ...ONLY] = process.argv;
const want = (s) => !ONLY.length || ONLY.includes(s);
const NAMES = ["top", "craft", "ask", "work", "contact"];
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const browser = ENGINE === "chromium" ? await pw.chromium.launch({ headless: true, channel: "chrome" }) : await pw[ENGINE].launch({ headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE = 9000;
const results = [];
let errors = [];
let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

async function fresh(w = 1920, h = 1080, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...extra });
  // never fetch the model: the opt-in is tested up to a failed download
  await ctx.route(/huggingface\.co|hf\.co|raw\.githubusercontent\.com|cdn-lfs/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR|ERR_FAILED|huggingface|github/i.test(m.text())) errors.push("console: " + m.text().slice(0, 160)); });
  await page.goto(BASE, { waitUntil: "load" });
  await sleep(2500);
  return page;
}
const state = (page) => page.evaluate(() => {
  const de = document.documentElement;
  const dots = [...document.querySelectorAll(".dots__dot")];
  const idx = dots.findIndex((d) => d.classList.contains("is-on"));
  const panels = [...document.querySelectorAll(".panel")];
  const top = panels[idx]?.offsetTop ?? -1;
  const cls = (s) => document.querySelector(s)?.className || "";
  return {
    idx, aligned: Math.abs(window.scrollY - top) < 3, scrollY: Math.round(window.scrollY), top,
    clip: document.querySelector(".transition")?.classList.contains("is-on") || false,
    handoff: document.querySelector(".handoff")?.classList.contains("is-on") || false,
    rag: cls(".rag"), wx: cls(".wx"), kb: cls(".panel--void"),
    vars: ["--handoff-scroll", "--handoff-scroll-screen"].filter((v) => de.style.getPropertyValue(v)),
    optin: !!document.querySelector(".a2-optin"),
    shred: !!document.querySelector(".shred"),
    prompt: !!document.querySelector(".a2-prompt input"),
    fallback: !!document.querySelector('[role="alert"]'),
    rowsVisible: [...document.querySelectorAll(".wx__list > li")].every((li) => +getComputedStyle(li).opacity > 0.9),
    glass: (document.querySelector(".a2m__screen")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
    active: document.activeElement?.tagName + (document.activeElement?.className ? "." + String(document.activeElement.className).split(" ")[0] : ""),
  };
});
function problemsOf(s, expectIdx) {
  const p = [];
  if (expectIdx !== null && expectIdx !== undefined && s.idx !== expectIdx) p.push(`dot ${NAMES[s.idx]} != ${NAMES[expectIdx]}`);
  if (s.idx < 0) p.push("no section active");
  if (!s.aligned) p.push(`scroll ${s.scrollY} not at panel top ${s.top}`);
  if (s.clip) p.push("clip overlay still on");
  if (s.handoff) p.push("handoff overlay still on");
  if (/is-continuing|is-scrolled|is-handoff/.test(s.rag)) p.push(`rag stuck: ${s.rag}`);
  if (/is-lifting/.test(s.wx)) p.push("index stuck lifting");
  if (/is-departing/.test(s.kb)) p.push("keyboard stuck departing");
  if (s.vars.length) p.push(`leftover ${s.vars.join(",")}`);
  if (s.idx === 3 && !s.rowsVisible) p.push("project titles not visible");
  if (s.fallback) p.push("SafetyNet fallback is showing");
  return p;
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
async function check(name, p, expectIdx, opts = {}) {
  const s = await state(p);
  const probs = problemsOf(s, expectIdx);
  for (const [k, v] of Object.entries(opts.more || {})) if (s[k] !== v) probs.push(`${k}=${s[k]} (want ${v})`);
  if (opts.shot) await p.screenshot({ path: `${OUT}/shots/${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 70)}.png` });
  if (opts.live !== false) probs.push(...(await live(p)));
  const errs = errors.splice(0);
  probs.push(...errs.map((e) => "ERR " + e));
  results.push({ engine: ENGINE, name, ok: !probs.length, problems: probs, landed: NAMES[s.idx] });
  console.log(`${probs.length ? "FAIL" : "ok  "} [${ENGINE}] ${name} -> ${NAMES[s.idx]}${opts.note ? " " + opts.note(s) : ""}${probs.length ? "\n      - " + probs.join("\n      - ") : ""}`);
  return s;
}
function info(line) { console.log(`      ${line}`); }
const dot = (p, i) => p.locator(`.dots__dot[data-section="${NAMES[i]}"]`).click({ force: true });
const goto = async (p, i) => { await dot(p, i); await sleep(SETTLE); };
const center = (p) => { const v = p.viewportSize(); return p.mouse.move(Math.round(v.width * 0.93), Math.round(v.height * 0.9)); }; // off the machine's screen (a scroll zone since dc45ec8)
/* a mouse wheel spun hard: same-size notches, very fast */
async function spin(p, dy, ms, gap = 8) { await center(p); const t0 = Date.now(); while (Date.now() - t0 < ms) { await p.mouse.wheel(0, dy); await sleep(gap); } }
/* a trackpad flick: a fast ramp-up then a long momentum tail */
async function flick(p, dir, peak = 260, ms = 1400) {
  await center(p);
  for (const v of [30, 90, 180, peak]) { await p.mouse.wheel(0, dir * v); await sleep(8); }
  const t0 = Date.now(); let d = peak;
  while (Date.now() - t0 < ms) { await p.mouse.wheel(0, dir * Math.max(1, Math.round(d))); d *= 0.95; await sleep(12); }
}
async function bootMachine(p) {
  await goto(p, 2);
  await p.waitForSelector(".a2-prompt input", { timeout: 60000 }); await sleep(1500);
}
async function openOptin(p, via = "status") {
  await bootMachine(p);
  if (via === "card") await p.locator(".brain__switch").click();
  else await p.locator(".a2-llm").first().click();
  await p.waitForSelector(".a2-optin", { timeout: 5000 }); await sleep(400);
}

/* ======================================================================== */
if (want("fast")) {
  { const p = await fresh(); await spin(p, 120, 3000); await sleep(SETTLE + 2000); await check("F1 wheel spun hard down for 3 s from the top", p, null, { note: () => "(one spin = one move)" }); await p.context().close(); }
  { const p = await fresh(); await goto(p, 4); await spin(p, -120, 3000); await sleep(SETTLE + 2000); await check("F2 wheel spun hard up for 3 s from contact", p, null); await p.context().close(); }
  { const p = await fresh(); await center(p); await p.mouse.wheel(0, 8000); await sleep(SETTLE); await check("F3a one huge wheel delta (+8000)", p, 1, { live: false }); await p.mouse.wheel(0, -8000); await sleep(SETTLE); await check("F3b one huge wheel delta (-8000)", p, 0); await p.context().close(); }
  { const p = await fresh(); await goto(p, 1); await center(p); for (let i = 0; i < 60; i++) { await p.mouse.wheel(0, i % 2 ? -150 : 150); await sleep(5); } await sleep(SETTLE + 3000); await check("F4 direction thrash: 60 events alternating +-150 every 5 ms", p, null); await p.context().close(); }
  for (const s of [11, 22, 33]) {
    seed = s; const p = await fresh(); const acts = [];
    for (let i = 0; i < 25; i++) { const dir = rnd() < 0.55 ? 1 : -1; const gap = 60 + Math.floor(rnd() * 340); acts.push(`${dir > 0 ? "v" : "^"}${gap}`); await flick(p, dir, 200 + Math.floor(rnd() * 400), 300 + Math.floor(rnd() * 900)); await sleep(gap); }
    await sleep(SETTLE + 4000);
    const st = await check(`F5 frantic: 25 high-velocity flicks, 60-400 ms apart (seed ${s})`, p, null);
    if (!results.at(-1).ok) info("flicks: " + acts.join(" "));
    await p.context().close();
  }
  { const p = await fresh(); await goto(p, 1); await spin(p, 120, 7000, 10); await sleep(SETTLE + 3000); await check("F6 wheel held down straight through the kb->machine clip (7 s)", p, null); await p.context().close(); }
  { const p = await fresh(); await bootMachine(p); await spin(p, 120, 8000, 10); await sleep(SETTLE + 3000); await check("F7 wheel held down straight through the machine->work handoff (8 s)", p, null); await p.context().close(); }
  { const p = await fresh(); await goto(p, 3); await spin(p, -120, 8000, 10); await sleep(SETTLE + 3000); await check("F8 wheel held up straight through the work->machine scene (8 s)", p, null); await p.context().close(); }
  { const p = await fresh(); await goto(p, 2); await center(p); for (let i = 0; i < 20; i++) { await p.mouse.wheel(400, 0); await sleep(16); } await sleep(2000); await check("F9 sideways wheel (deltaX only) does not move", p, 2, { live: false }); await p.context().close(); }
  { const p = await fresh(); await goto(p, 1); await center(p); await p.keyboard.down("Control"); for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 40); await sleep(16); } await p.keyboard.up("Control"); await sleep(SETTLE); const s = await check("F10 pinch-zoom gesture (ctrl+wheel) on the keyboard", p, 1, { live: false }); info(`pinch landed on ${NAMES[s.idx]} (from craft)`); await p.context().close(); }
  {
    const p = await fresh(); await bootMachine(p);
    const ta = p.locator(".feed textarea");
    if (await ta.count() && await ta.isVisible()) {
      const b = await ta.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 120); await sleep(30); }
      await sleep(SETTLE); await check("F11a wheel over the empty 'Teach it something' note turns the page", p, 3, { live: false, note: (s) => `scrollY ${s.scrollY}` });
      await goto(p, 2); await ta.fill("line\n".repeat(30)); await ta.evaluate((el) => (el.scrollTop = 0)); await sleep(300); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 120); await sleep(30); }
      await sleep(2500); await check("F11b wheel over the note when it is full (scrolls the note)", p, 2, { live: false });
    } else info("F11 skipped: no feed card at this size");
    await p.context().close();
  }
  { const p = await fresh(); await goto(p, 2); await p.keyboard.press("Shift+Space"); await sleep(SETTLE); const s = await check("F12 Shift+Space on the machine goes back", p, 1, { live: false }); info(`Shift+Space went to ${NAMES[s.idx]} (browsers go BACK on shift+space)`); await p.context().close(); }
  {
    const p = await fresh(); await p.keyboard.press("End"); await sleep(SETTLE); await check("F13a End from the top", p, 4, { live: false });
    await p.keyboard.press("Home"); await sleep(SETTLE); await check("F13b Home from contact", p, 0, { live: false });
    await goto(p, 1); await p.keyboard.press("ArrowDown"); await sleep(500); await p.keyboard.press("End"); await sleep(SETTLE + 2000); await check("F13c End pressed during the kb->machine clip", p, null, { live: false });
    await goto(p, 2); await p.keyboard.press("ArrowDown"); await sleep(1200); await p.keyboard.press("Home"); await sleep(SETTLE + 3000); await check("F13d Home pressed during the handoff", p, null);
    await p.context().close();
  }
  { const p = await fresh(); for (let i = 0; i < 40; i++) { await p.keyboard.press("ArrowDown"); await sleep(33); } await sleep(SETTLE + 2000); await check("F14 ArrowDown held (auto-repeat, 30/s for 1.3 s)", p, null); for (let i = 0; i < 40; i++) { await p.keyboard.press("PageUp"); await sleep(33); } await sleep(SETTLE + 2000); await check("F14b PageUp held", p, null); await p.context().close(); }
  {
    const p = await fresh(); await bootMachine(p);
    const inp = p.locator(".a2-prompt input"); await inp.click(); await inp.type("what is axle", { delay: 30 }); await sleep(500);
    const s = await check("F15 typing with spaces in the machine's prompt does not move", p, 2, { live: false });
    const v = await inp.inputValue(); if (v !== "what is axle") results.push({ engine: ENGINE, name: "F15b prompt kept the spaces", ok: false, problems: [`value "${v}"`] }), console.log(`FAIL F15b prompt value "${v}"`);
    await p.context().close();
  }
  {
    const p = await fresh(); const seen = [];
    for (let i = 1; i <= 30; i++) {
      await p.keyboard.press("Tab"); await sleep(i % 5 ? 250 : SETTLE);
      if (i % 5 === 0) { const s = await state(p); const sec = await p.evaluate(() => ["top", "craft", "ask", "work", "contact"].indexOf(document.activeElement?.closest(".panel")?.id)); seen.push(`${i}:${NAMES[s.idx]}${s.aligned ? "" : "(OFF " + s.scrollY + ")"}${sec >= 0 && sec !== s.idx ? "(focus in " + NAMES[sec] + ")" : ""}`); }
    }
    info("Tab through the page: " + seen.join(" "));
    const bad = seen.filter((x) => x.includes("OFF") || x.includes("focus in"));
    results.push({ engine: ENGINE, name: "F17 Tab through the whole page", ok: !bad.length, problems: bad }); console.log(`${bad.length ? "FAIL" : "ok  "} [${ENGINE}] F17 Tab through the whole page${bad.length ? "\n      - " + bad.join("\n      - ") : ""}`);
    await check("F17b ...the page still works after", p, null);
    await p.context().close();
  }
  { const p = await fresh(); await p.evaluate(() => window.scrollTo(0, 3000)); await sleep(SETTLE); await check("F18 a native scroll to 3000 (find-in-page) -> follows to work", p, 3); await p.evaluate(() => window.scrollTo(0, 1500)); await sleep(SETTLE); await check("F18b native scroll to 1500 -> follows to craft", p, 1); await p.context().close(); }
  if (ENGINE === "chromium") {
    const p = await fresh(390, 844, { isMobile: true, hasTouch: true });
    const cdp = await p.context().newCDPSession(p);
    const swipe = async (dy) => { const x = 195, y0 = 520; await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] }); for (let i = 1; i <= 4; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - (dy * i) / 4 }] }); await sleep(6); } await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
    for (let i = 0; i < 12; i++) { await swipe(rnd() < 0.6 ? 300 : -300); await sleep(90); }
    await sleep(SETTLE + 2000); await check("F16 phone: 12 fast swipes 90 ms apart", p, null);
    await p.context().close();
  }
}

/* ======================================================================== */
if (want("optin")) {
  { const p = await fresh(); await openOptin(p); await flick(p, 1); await sleep(SETTLE); await check("O1 opt-in up, one flick down", p, 3, { live: false, shot: true }); await flick(p, -1); await sleep(SETTLE + 2000); await check("O1b ...flick back up: opt-in gone", p, 2, { more: { optin: false }, shot: true }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await spin(p, 120, 3000); await sleep(SETTLE + 2000); await check("O2 opt-in up, wheel spun hard for 3 s", p, null, { live: false }); await goto(p, 2); await check("O2b ...back on the machine: opt-in gone", p, 2, { more: { optin: false } }); await p.context().close(); }
  {
    const p = await fresh(); await openOptin(p);
    const b = await p.locator(".a2-optin").boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (const v of [40, 120, 240, 300]) { await p.mouse.wheel(0, v); await sleep(10); }
    await sleep(SETTLE); await check("O3 wheel with the pointer ON the opt-in text stays on the machine (screen is a scroll zone)", p, 2, { live: false }); await p.context().close();
  }
  { const p = await fresh(); await openOptin(p); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); await check("O4 opt-in up, ArrowDown", p, 3, { live: false, note: (s) => `focus ${s.active}` }); await p.keyboard.press("ArrowUp"); await sleep(SETTLE + 2000); await check("O4b ...ArrowUp back: opt-in gone", p, 2, { more: { optin: false } }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await p.keyboard.press("End"); await sleep(SETTLE); await check("O5 opt-in up, End", p, 4, { live: false }); await p.keyboard.press("Home"); await sleep(SETTLE); await check("O5b ...Home", p, 0, { live: false }); await goto(p, 2); await check("O5c ...dot back to the machine: opt-in gone", p, 2, { more: { optin: false } }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await p.reload({ waitUntil: "load" }); await sleep(6000); await check("O6 reload with the opt-in up", p, 2, { more: { optin: false }, shot: true, note: (s) => `prompt ${s.prompt}` }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await p.setViewportSize({ width: 3440, height: 1440 }); await sleep(1500); await p.setViewportSize({ width: 1920, height: 1080 }); await sleep(1500); await check("O7 opt-in up, window to 21:9 and back", p, 2, { live: false, note: (s) => `opt-in still ${s.optin ? "up" : "gone"}` }); await flick(p, 1); await sleep(SETTLE); await flick(p, -1); await sleep(SETTLE + 2000); await check("O7b ...then down and back", p, 2, { more: { optin: false } }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p, "card"); await flick(p, 1); await sleep(SETTLE); await check("O8 opt-in from the 'Let it talk' card, flick down", p, 3, { live: false }); await flick(p, -1); await sleep(SETTLE + 2000); await check("O8b ...back: opt-in gone", p, 2, { more: { optin: false } }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await p.locator(".nav [aria-pressed], [aria-label*='ransitions'], .nav__sound").first().click(); await sleep(500); await flick(p, 1); await sleep(5000); await flick(p, -1); await sleep(5000); await check("O9 opt-in up, Motion switched off, down and back", p, 2, { more: { optin: false } }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await p.keyboard.press("Escape"); await sleep(600); await check("O10 Escape closes the opt-in", p, 2, { more: { optin: false } }); await p.context().close(); }
  { const p = await fresh(); await openOptin(p); await p.getByRole("button", { name: /KEEP QUOTES/ }).click(); await sleep(400); await flick(p, 1); await sleep(SETTLE); await flick(p, -1); await sleep(SETTLE + 2000); await check("O11 [KEEP QUOTES], then down and back", p, 2, { more: { optin: false } }); await p.context().close(); }
  {
    const p = await fresh(); await bootMachine(p);
    const inp = p.locator(".a2-prompt input"); await inp.click(); await inp.type("what did brian build at his internship"); await inp.press("Enter");
    await sleep(500); await flick(p, 1); await sleep(SETTLE);
    await check("O12 asked a question, flicked away while it was answering", p, 3, { live: false, shot: true });
    await flick(p, -1); await sleep(SETTLE + 4000);
    await check("O12b ...back on the machine", p, 2, { shot: true, note: (s) => `glass "${s.glass}"` });
    await p.context().close();
  }
  {
    const p = await fresh(); await bootMachine(p);
    if (await p.locator(".feed textarea").isVisible()) {
      await p.locator(".feed textarea").fill("Brian once fixed a bug at 3am."); await p.locator(".feed button[type=submit]").click();
      await sleep(250); await flick(p, 1); await sleep(SETTLE);
      await check("O13 fed a note, flicked away mid-shred", p, 3, { live: false });
      await flick(p, -1); await sleep(SETTLE + 3000);
      await check("O13b ...back: no shred left over, note card usable", p, 2, { more: { shred: false }, shot: true });
    }
    await p.context().close();
  }
  {
    const p = await fresh(); await openOptin(p);
    await p.getByRole("button", { name: /TURN IT ON/ }).click(); await sleep(1500);
    await flick(p, 1); await sleep(SETTLE);
    await check("O14 [TURN IT ON] (download blocked), flicked away while it loads", p, 3, { live: false });
    await flick(p, -1); await sleep(SETTLE + 3000);
    const s = await check("O14b ...back on the machine", p, 2, { shot: true, note: (s) => `glass "${s.glass}"` });
    const card = await p.locator(".brain__meta").innerText().catch(() => "(no card)");
    info(`LLM card says: ${card}`);
    await p.context().close();
  }
}

/* ======================================================================== */
if (want("reload")) {
  { const p = await fresh(); await goto(p, 1); await p.keyboard.press("ArrowDown"); await sleep(1000); await p.reload({ waitUntil: "load" }); await sleep(6000); await check("R1 reload in the middle of the kb->machine clip", p, null, { shot: true }); await p.context().close(); }
  { const p = await fresh(); await bootMachine(p); await p.keyboard.press("ArrowDown"); await sleep(1500); await p.reload({ waitUntil: "load" }); await sleep(6000); await check("R2 reload in the middle of the machine->work handoff", p, null, { shot: true }); await p.context().close(); }
  { const p = await fresh(); await goto(p, 3); await p.keyboard.press("ArrowUp"); await sleep(1200); await p.reload({ waitUntil: "load" }); await sleep(6000); await check("R3 reload in the middle of the work->machine scene", p, null, { shot: true }); await p.context().close(); }
  { const p = await fresh(); await goto(p, 3); for (let i = 0; i < 6; i++) { await p.reload({ waitUntil: "commit" }); await sleep(300); } await p.waitForLoadState("load"); await sleep(6000); await check("R4 reload spammed 6 times on work", p, 3, { shot: true }); await p.context().close(); }
  { const p = await fresh(); await goto(p, 3); await p.goto("about:blank"); await sleep(800); await p.goBack({ waitUntil: "load" }); await sleep(5000); await check("R5 away to another page and Back", p, 3); await p.goForward(); await sleep(800); await p.goBack({ waitUntil: "load" }); await sleep(5000); await check("R5b Forward then Back again", p, 3); await p.context().close(); }
  { const p = await fresh(); await goto(p, 1); await p.keyboard.press("ArrowDown"); await sleep(150); await p.reload({ waitUntil: "load" }); await sleep(6000); await check("R6 reload 150 ms into a move", p, null); await p.context().close(); }
  { const p = await fresh(390, 844, { isMobile: true, hasTouch: true }); await goto(p, 4); await p.reload({ waitUntil: "load" }); await sleep(4000); await check("R7 phone: reload on contact", p, 4); await p.context().close(); }
  { const p = await fresh(); await goto(p, 2); await p.setViewportSize({ width: 1024, height: 768 }); await sleep(1000); await p.reload({ waitUntil: "load" }); await sleep(5000); await check("R8 resized to 4:3 on the machine, then reload", p, 2, { shot: true }); await p.context().close(); }
  { const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); const p = await ctx.newPage(); await p.goto(BASE + "#work", { waitUntil: "load" }); await sleep(4000); await check("R9 opened with a #hash", p, null); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); const p = await ctx.newPage(); await p.goto(BASE + "?frame=nonsense", { waitUntil: "load" }); await sleep(4000); const s = await state(p); const e = errors.splice(0); info(`R10 ?frame=nonsense -> section ${NAMES[s.idx]}, fallback ${s.fallback}${e.length ? ", errors: " + e.join(" | ") : ""}`); await ctx.close(); }
  { const p = await fresh(); await goto(p, 3); const p2 = await p.context().newPage(); await p2.goto(BASE, { waitUntil: "load" }); await sleep(4000); await check("R11 a second tab starts at the top", p2, 0, { live: false }); await check("R11b ...the first tab is untouched", p, 3); await p.context().close(); }
}

await browser.close();
const bad = results.filter((r) => !r.ok);
fs.writeFileSync(`${OUT}/fast-${ENGINE}-${ONLY.join("-") || "all"}.json`, JSON.stringify(results, null, 2));
console.log(`\n[${ENGINE} ${ONLY.join(",") || "all"}] ${results.length - bad.length}/${results.length} passed`);
