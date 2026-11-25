// Hammer every transition: each one started while the section it leaves (or
// lands on) is in the middle of something, at several moments, with a probe
// sampling every frame for (a) overlay text on top of live text, (b) the
// section's own text showing through a scene that should hide it, (c) classes
// a scene set by hand that disappeared mid-scene, (d) anything left stuck.
//   node hammer.mjs <baseURL> <outDir> [filter]
import { createRequire } from "module";
import fs from "fs";
import { execFileSync } from "child_process";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const [, , BASE = "http://localhost:4187/", OUT = "hammer", FILTER = ""] = process.argv;
fs.mkdirSync(`${OUT}/film`, { recursive: true });
const browser = await pw.chromium.launch({ headless: true, channel: "chrome" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["top", "craft", "ask", "work", "contact"];
const SETTLE = 9000;
let pass = 0, fail = 0;
const failures = [];

/* installed in the page: samples every animation frame until stopped */
const PROBE = () => {
  const vis = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity < 0.15 || cs.visibility === "hidden" || cs.display === "none") return false; } return true; };
  const clipShown = (el) => { const cp = getComputedStyle(el).clipPath; return !cp || cp === "none" || !/inset\(0(px)? 100%/.test(cp); };
  /* an element's rect as actually seen: cut by every scrolling/clipping box above it */
  const clipped = (el) => {
    let r = el.getBoundingClientRect(); r = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = el.parentElement; a && !a.classList.contains("a2m__screen"); a = a.parentElement) {
      const o = getComputedStyle(a); if (o.overflowY === "visible" && o.overflowX === "visible") continue;
      const b = a.getBoundingClientRect();
      r = { left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) };
    }
    return { ...r, width: r.right - r.left, height: r.bottom - r.top };
  };
  let speech0 = null;
  const log = { speechMoved: [], stacked: [], kbTextUnderClip: 0, departingLostUnderClip: 0, ragClassLost: [], frames: 0, overlayFrames: 0 };
  let lastRag = "";
  const tick = () => {
    if (!window.__probeOn) { window.__probe = log; return; }
    log.frames++;
    const clip = document.querySelector(".transition.is-on");
    const ho = document.querySelector(".handoff.is-on");
    if (clip || ho) log.overlayFrames++;
    const sp = document.querySelector(".a2-speech, [data-scroll-main]");
    if (ho && sp) { if (speech0 === null) speech0 = sp.scrollTop; else if (Math.abs(sp.scrollTop - speech0) > 1 && log.speechMoved.length < 3) log.speechMoved.push(`${Math.round(speech0)} -> ${Math.round(sp.scrollTop)}`); }
    if (!ho) speech0 = null;
    /* (a) the handoff's text over live session text on the glass */
    if (ho) {
      const glass = document.querySelector(".a2m__screen")?.getBoundingClientRect();
      const session = glass ? [...document.querySelectorAll(".a2-boot > *, .a2-boot li, .a2-perf *, .a2-prompt")]
        .filter((e) => (e.children.length === 0 || e.tagName === "LI" || e.classList.contains("a2-prompt")) && (e.innerText || "").trim() && vis(e) && clipShown(e))
        .map((e) => ({ t: e.innerText.trim().slice(0, 22), r: clipped(e) }))
        .filter(({ r }) => r && r.width > 0 && r.height > 2 && r.bottom > glass.top + 2 && r.top < glass.bottom - 2) : [];
      const over = [...document.querySelectorAll(".handoff.is-on .handoff__cmd, .handoff.is-on .handoff__line.is-in")]
        .filter((e) => vis(e) && (e.innerText || "").trim()).map((e) => ({ t: e.innerText.trim().replace(/\s+/g, " ").slice(0, 16), r: e.getBoundingClientRect() }));
      for (const o of over) for (const s of session) {
        const ix = Math.min(o.r.right, s.r.right) - Math.max(o.r.left, s.r.left);
        const iy = Math.min(o.r.bottom, s.r.bottom) - Math.max(o.r.top, s.r.top);
        if (ix > 4 && iy > 6) { const k = `"${o.t}" on "${s.t}"`; if (!log.stacked.includes(k) && log.stacked.length < 6) log.stacked.push(k); }
      }
    }
    /* (b)/(c) under the clip the keyboard section's own text must stay hidden */
    if (clip) {
      const kb = document.querySelector(".panel--void");
      if (kb && !kb.classList.contains("is-departing")) log.departingLostUnderClip++;
    }
    /* (c) the handoff's classes on .rag must not vanish while it plays */
    const rag = document.querySelector(".rag")?.className || "";
    if (ho && /is-continuing|is-handoff/.test(lastRag) && !/is-continuing|is-handoff/.test(rag) && !document.querySelector(".handoff.is-out")) log.ragClassLost.push(`${lastRag.trim()} -> ${rag.trim()}`);
    lastRag = rag;
    requestAnimationFrame(tick);
  };
  window.__probeOn = true; requestAnimationFrame(tick);
};
const stopProbe = (p) => p.evaluate(async () => { window.__probeOn = false; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return window.__probe; });

const state = (p) => p.evaluate(() => {
  const de = document.documentElement;
  const dots = [...document.querySelectorAll(".dots__dot")];
  const idx = dots.findIndex((d) => d.classList.contains("is-on"));
  const top = document.querySelectorAll(".panel")[idx]?.offsetTop ?? -1;
  const cls = (s) => document.querySelector(s)?.className || "";
  return {
    idx, aligned: Math.abs(scrollY - top) < 3, y: Math.round(scrollY), top,
    clip: !!document.querySelector(".transition.is-on"), handoff: !!document.querySelector(".handoff.is-on"),
    rag: cls(".rag"), wx: cls(".wx"), kb: cls(".panel--void"),
    vars: ["--handoff-scroll", "--handoff-scroll-screen"].filter((v) => de.style.getPropertyValue(v)),
    optin: !!document.querySelector(".a2-optin"), shred: !!document.querySelector(".shred"),
    rows: [...document.querySelectorAll(".wx__list > li")].every((li) => +getComputedStyle(li).opacity > 0.9),
    fallback: !!document.querySelector('[role="alert"]'),
    stageDark: de.classList.contains("stage-dark"),
    kbLit: document.querySelector(".panel--void")?.classList.contains("is-lit"),
    prompt: !!document.querySelector(".a2-prompt input"),
    cutClasses: [...de.classList].filter((c) => c.startsWith("cut-")),
    irisUp: (() => { const e = document.querySelector(".cut-iris"); if (!e) return false; const cs = getComputedStyle(e); return cs.display !== "none" && +cs.opacity > 0.05; })(),
    notesLeft: (() => { const e = document.querySelector(".cut-board"); if (!e) return 0; const cs = getComputedStyle(e); return cs.display === "none" ? 0 : e.children.length; })(),
  };
});
function problemsOf(s, want) {
  const p = [];
  if (want !== null && s.idx !== want) p.push(`dot ${NAMES[s.idx]} != ${NAMES[want]}`);
  if (!s.aligned) p.push(`scroll ${s.y} not at panel top ${s.top}`);
  if (s.clip) p.push("clip overlay stuck on");
  if (s.handoff) p.push("handoff overlay stuck on");
  if (/is-continuing|is-scrolled|is-handoff|is-cleared/.test(s.rag)) p.push(`rag stuck: ${s.rag.trim()}`);
  if (/is-lifting/.test(s.wx)) p.push("index stuck lifting");
  if (/is-departing/.test(s.kb)) p.push("keyboard stuck departing");
  if (s.vars.length) p.push("leftover " + s.vars.join(","));
  if (s.idx === 3 && !s.rows) p.push("project titles not visible");
  if (s.idx !== 1 && s.stageDark) p.push("page left blacked out (stage-dark)");
  if (s.idx === 1 && !s.kbLit) p.push("keyboard dark");
  if (s.idx === 2 && !s.prompt) p.push("machine has no prompt");
  if (s.fallback) p.push("SafetyNet fallback showing");
  const stray = s.cutClasses.filter((c) => !(s.idx === 0 && c === "cut-bulb")); // the bulb stays lit on the hero by design
  if (stray.length) p.push("cut classes left on <html>: " + stray.join(" "));
  if (s.irisUp) p.push("iris still covering the screen");
  if (s.notesLeft) p.push(`${s.notesLeft} sticky notes left on screen`);
  return p;
}

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.route(/huggingface\.co|raw\.githubusercontent\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  p.__errs = [];
  p.on("pageerror", (e) => p.__errs.push(e.message.slice(0, 120)));
  await p.goto(BASE, { waitUntil: "load" }); await sleep(2500);
  return p;
}
const dot = (p, i) => p.locator(`.dots__dot[aria-label="${NAMES[i]}"]`).click({ force: true });
async function film(p, name, ms, every = 250) {
  const files = [];
  const g = name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  for (let t = 0; t < ms; t += every) { const f = `${OUT}/film/${g}-${String(t).padStart(5, "0")}.jpg`; await p.screenshot({ path: f, type: "jpeg", quality: 60 }); files.push(f); await sleep(every); }
  try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", `${OUT}/film/${g}-*.jpg`, "-vf", "scale=480:-2,tile=6x" + Math.ceil(files.length / 6), "-frames:v", "1", `${OUT}/strip-${g}.jpg`]); } catch {}
  files.forEach((f) => fs.unlinkSync(f));
}

/* one scenario: set up, start the move (with the probe running), check */
const [SK, SN] = (process.env.SHARD || "0/1").split("/").map(Number);
let seq = -1;
async function hit(name, { setup, move, want, wait = SETTLE + 3000, filmMs = 0, extra }) {
  if (FILTER && !name.includes(FILTER)) return;
  if (++seq % SN !== SK) return;
  const p = await fresh();
  try {
    await setup(p);
    await p.evaluate(PROBE);
    await move(p);
    if (filmMs) await film(p, name, filmMs);
    await sleep(Math.max(0, wait - filmMs));
    const pr = (await stopProbe(p)) || { stacked: [], speechMoved: [], departingLostUnderClip: 0, ragClassLost: [], frames: 0, overlayFrames: 0 }; // a reload wipes the probe
    const s = await state(p);
    const probs = problemsOf(s, want);
    if (pr.stacked.length) probs.push("STACKED: " + pr.stacked.join("; "));
    if (pr.speechMoved.length) probs.push("answer scrolled under the overlay: " + pr.speechMoved.join(", "));
    if (pr.departingLostUnderClip > 2) probs.push(`keyboard text showing under the clip for ${pr.departingLostUnderClip} frames (is-departing lost)`);
    if (pr.ragClassLost.length) probs.push("handoff class wiped mid-scene: " + pr.ragClassLost.slice(0, 2).join(" | "));
    if (extra) probs.push(...(await extra(p, s)));
    // still answers
    const dir = s.idx < 4 ? "ArrowDown" : "ArrowUp";
    if (s.idx === 2) await outFlick(1)(p); else await p.keyboard.press(dir);
    await sleep(SETTLE);
    if ((await state(p)).idx === s.idx) probs.push(`nav dead (${s.idx === 2 ? "wheel outside the glass" : dir} did nothing)`);
    if (p.__errs.length) probs.push("pageerror: " + [...new Set(p.__errs)].join(" | "));
    probs.length ? (fail++, failures.push({ name, probs })) : pass++;
    console.log(`${probs.length ? "FAIL" : "ok  "} ${name} -> ${NAMES[s.idx]} (overlay ${pr.overlayFrames}/${pr.frames} frames)${probs.length ? "\n      - " + probs.join("\n      - ") : ""}`);
  } catch (e) {
    fail++; failures.push({ name, probs: ["script error " + String(e).slice(0, 160)] });
    console.log(`FAIL ${name}\n      - script error ${String(e).slice(0, 160)}`);
  }
  await p.context().close();
}

const key = (k) => async (p) => p.keyboard.press(k);
/* Since dc45ec8 the wheel on the machine's screen only scrolls its text, and
   arrows read a long answer on before the page turns: leaving the machine is
   a wheel OUTSIDE the glass (bottom-right corner, clear of the cards). */
const outPoint = (p) => { const v = p.viewportSize(); return [Math.round(v.width * 0.93), Math.round(v.height * 0.9)]; };
const outFlick = (dir) => async (p) => { const [x, y] = outPoint(p); await p.mouse.move(x, y); for (const v of [40, 120, 240]) { await p.mouse.wheel(0, dir * v); await sleep(10); } };
const glassCenter = (p) => p.evaluate(() => { const r = document.querySelector(".a2m__screen").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const LONG_Q = "tell me about axle";
const toCraft = async (p) => { await p.keyboard.press("ArrowDown"); await sleep(5000); };
const toAskByClip = async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); };
/* the arrival clip still fading holds the nav (by design); a real visitor's
   key in that window is ignored, so setups wait it out before pressing */
const clipGone = (p) => p.waitForFunction(() => !document.querySelector(".transition.is-on"), null, { timeout: 15000 });
const machineReady = async (p) => { await p.waitForSelector(".rag.is-booting", { timeout: 30000 }).catch(() => {}); await p.waitForSelector(".rag:not(.is-booting) .a2-prompt input", { timeout: 30000 }); };
const toAskSettled = async (p) => { await dot(p, 2); await machineReady(p); await sleep(800); };
const toWork = async (p) => { await toAskSettled(p); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); };
const ask = async (p, q) => { const i = p.locator(".a2-prompt input"); await i.fill(q); await i.press("Enter"); };

/* ---- 1 -> 2: the clip, leaving the keyboard in every state ---- */
for (const ms of [0, 300, 900, 1500]) {
  await hit(`kb->machine: leave the keyboard ${ms} ms after the iris lifts (intro still standing up)`, { setup: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(2800 + ms); }, move: key("ArrowDown"), want: 2 });
}
await hit("kb->machine: leave while a key's caption is showing", { setup: async (p) => { await toCraft(p); await p.mouse.move(900, 500); await sleep(300); await p.mouse.move(980, 560); await sleep(600); }, move: key("ArrowDown"), want: 2, filmMs: 4000 });

/* ---- 2 -> 1: the reverse clip, leaving the machine in every state ---- */
for (const [label, setup] of [
  ["machine still warming (tube off)", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-crt--off", { timeout: 20000 }); await clipGone(p); }],
  ["boot menu typing", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(300); }],
  ["answer mid-scan", async (p) => { await toAskSettled(p); await ask(p, "tell me about axle"); await sleep(1500); }],
  ["opt-in open", async (p) => { await toAskSettled(p); await p.locator(".a2-llm").first().click(); await p.waitForSelector(".a2-optin"); }],
  ["note shredding", async (p) => { await toAskSettled(p); await p.locator(".feed textarea").fill("a fact"); await p.locator(".feed button[type=submit]").click(); await sleep(200); }],
]) {
  await hit(`machine->kb (reverse clip): leave with ${label}`, { setup, move: outFlick(-1), want: 1, filmMs: label === "boot menu typing" ? 4500 : 0 });
}

/* ---- 2 -> 3: the handoff, leaving the machine in every state ---- */
for (const [label, setup] of [
  ["tube just off", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-crt--off", { timeout: 20000 }); await clipGone(p); await sleep(200); }],
  ["tube warming", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-crt--bloom", { timeout: 20000 }); await clipGone(p); await sleep(200); }],
  ["menu typing, early", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(100); }],
  ["menu typing, late", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(1100); }],
  ["dot-jump boot", async (p) => { await dot(p, 2); await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(500); }],
  ["answer: tearing", async (p) => { await toAskSettled(p); await ask(p, "what security work has he done"); await sleep(300); }],
  ["answer: scanning", async (p) => { await toAskSettled(p); await ask(p, "what security work has he done"); await sleep(1500); }],
  ["answer: fusing", async (p) => { await toAskSettled(p); await ask(p, "what security work has he done"); await sleep(2800); }],
  ["answer: just landed", async (p) => { await toAskSettled(p); await ask(p, "what security work has he done"); await sleep(3700); }],
  ["answer: settled", async (p) => { await toAskSettled(p); await ask(p, "what security work has he done"); await sleep(7000); }],
  ["question typed, not sent", async (p) => { await toAskSettled(p); await p.locator(".a2-prompt input").fill("half a quest"); }],
  ["opt-in open", async (p) => { await toAskSettled(p); await p.locator(".a2-llm").first().click(); await p.waitForSelector(".a2-optin"); }],
  ["LLM switched on (download failing)", async (p) => { await toAskSettled(p); await p.locator(".a2-llm").first().click(); await p.waitForSelector(".a2-optin"); await p.getByRole("button", { name: /TURN IT ON/ }).click(); await sleep(1500); }],
  ["note shredding", async (p) => { await toAskSettled(p); await p.locator(".feed textarea").fill("Brian likes trains."); await p.locator(".feed button[type=submit]").click(); await sleep(250); }],
  ["note just ingested", async (p) => { await toAskSettled(p); await p.locator(".feed textarea").fill("Brian likes trains."); await p.locator(".feed button[type=submit]").click(); await sleep(2600); }],
]) {
  const filmIt = ["menu typing, early", "answer: scanning", "answer: just landed", "note just ingested"].includes(label);
  await hit(`machine->work (handoff): leave with ${label}`, { setup, move: outFlick(1), want: 3, filmMs: filmIt ? 5500 : 0 });
}

/* ---- the machine's screen as a scroll zone (dc45ec8) ---- */
await hit("zone: wheel spun over the glass during the handoff (long answer)", { setup: async (p) => { await toAskSettled(p); await ask(p, LONG_Q); await sleep(7000); }, move: async (p) => { const g = await glassCenter(p); await outFlick(1)(p); await sleep(250); await p.mouse.move(g[0], g[1]); for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, i % 3 ? 120 : -120); await sleep(30); } }, want: 3, filmMs: 0 });
await hit("zone: ArrowDown held during the handoff (long answer)", { setup: async (p) => { await toAskSettled(p); await ask(p, LONG_Q); await sleep(7000); }, move: async (p) => { await outFlick(1)(p); await sleep(200); for (let i = 0; i < 25; i++) { await p.keyboard.press(i % 4 ? "ArrowDown" : "ArrowUp"); await sleep(70); } }, want: null });
await hit("zone: wheel over the glass during the scene back up (long answer)", { setup: async (p) => { await toAskSettled(p); await ask(p, LONG_Q); await sleep(7000); await outFlick(1)(p); await sleep(SETTLE); }, move: async (p) => { await p.keyboard.press("ArrowUp"); await sleep(150); const g = await glassCenter(p); await p.mouse.move(g[0], g[1]); for (let i = 0; i < 50; i++) { await p.mouse.wheel(0, i % 2 ? 120 : -120); await sleep(30); } }, want: 2 });
await hit("zone: wheel over the glass while the boot types, then leave", { setup: async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); const g = await glassCenter(p); await p.mouse.move(g[0], g[1]); for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 150); await sleep(40); } await sleep(300); }, move: outFlick(1), want: 3 });
await hit("zone: wheel on the glass edge as the handoff starts", { setup: async (p) => { await toAskSettled(p); await ask(p, LONG_Q); await sleep(7000); }, move: async (p) => { const r = await p.evaluate(() => { const b = document.querySelector(".a2m__screen").getBoundingClientRect(); return [b.right, b.bottom]; }); await outFlick(1)(p); for (let i = 0; i < 30; i++) { await p.mouse.move(r[0] + (i % 2 ? -2 : 2), r[1] - 40); await p.mouse.wheel(0, 120); await sleep(25); } }, want: 3 });

/* ---- 3 -> 2: the scene back up, and the machine it lands on ---- */
for (const [label, setup] of [
  ["index settled", toWork],
  ["index still drawing in (left 300 ms after landing)", async (p) => { await toAskSettled(p); await p.keyboard.press("ArrowDown"); await sleep(5200); }],
  ["a project hovered (reel playing)", async (p) => { await toWork(p); await p.locator(".wx__list > li").nth(2).hover(); await sleep(800); }],
  ["left the machine mid-answer, came back", async (p) => { await toAskSettled(p); await ask(p, "tell me about axle"); await sleep(1200); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); }],
  ["left the machine mid-boot, came back", async (p) => { await toCraft(p); await p.keyboard.press("ArrowDown"); await p.waitForSelector(".a2-boot--typing", { timeout: 20000 }); await sleep(200); await p.keyboard.press("ArrowDown"); await sleep(SETTLE); }],
]) {
  await hit(`work->machine (scene back up): ${label}`, { setup, move: key("ArrowUp"), want: 2, filmMs: label.startsWith("left the machine mid-answer") ? 5000 : 0 });
}

/* ---- plain moves with busy neighbours ---- */
await hit("work->contact: leave while the index is still drawing in", { setup: async (p) => { await toAskSettled(p); await p.keyboard.press("ArrowDown"); await sleep(5000); }, move: key("ArrowDown"), want: 4 });
await hit("contact->work: straight back", { setup: async (p) => { await dot(p, 4); await sleep(SETTLE); }, move: key("ArrowUp"), want: 3 });
await hit("top->craft->top: back up before the keyboard has stood up", { setup: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(2400); }, move: key("ArrowUp"), want: 0 });
await hit("craft->top: hero letters re-rise, keyboard released", { setup: toCraft, move: key("ArrowUp"), want: 0, filmMs: 3000 });

/* ---- the 2D cuts: hero <-> keyboard iris, work <-> contact notes ---- */
await hit("hero->kb iris: from a fresh load, hero letters still rising", { setup: async () => {}, move: key("ArrowDown"), want: 1, filmMs: 3500 });
await hit("hero->kb iris: with a hero letter hovered (morph showing)", { setup: async (p) => { await sleep(2500); const g = p.locator(".hx__glyph--name").first(); await g.hover({ force: true }).catch(() => {}); await sleep(500); }, move: key("ArrowDown"), want: 1 });
await hit("hero->kb iris: by progress dot", { setup: async (p) => { await sleep(1500); }, move: async (p) => dot(p, 1), want: 1 });
await hit("kb->hero iris: board still lying flat", { setup: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(2400); }, move: key("ArrowUp"), want: 0, filmMs: 3000 });
await hit("kb->hero iris: board mid-rise", { setup: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(3600); }, move: key("ArrowUp"), want: 0 });
await hit("kb->hero iris: board standing, key caption up", { setup: async (p) => { await toCraft(p); await p.mouse.move(980, 560); await sleep(600); }, move: key("ArrowUp"), want: 0 });
for (const ms of [100, 500, 1000, 1600, 2300]) {
  await hit(`hero->kb iris: Up pressed ${ms} ms in (nav locked)`, { setup: async () => {}, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(ms); await p.keyboard.press("ArrowUp"); }, want: null, wait: SETTLE + 3000 });
  await hit(`hero->kb iris: wheel spun ${ms} ms in`, { setup: async () => {}, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(ms); await p.mouse.move(960, 540); for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, i % 2 ? 120 : -120); await sleep(12); } }, want: null, wait: SETTLE + 3000 });
}
await hit("hero->kb iris: resized to 21:9 mid-iris", { setup: async () => {}, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(500); await p.setViewportSize({ width: 3440, height: 1440 }); await sleep(800); await p.setViewportSize({ width: 1920, height: 1080 }); }, want: 1 });
await hit("hero->kb iris: Motion switched off mid-iris", { setup: async () => {}, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(400); await p.locator(".nav [aria-pressed], [aria-label*='ransitions'], .nav__sound, .nav__switch").first().click({ force: true }).catch(() => {}); }, want: 1 });
await hit("hero->kb iris: tab hidden mid-iris (frozen 4 s)", { setup: async () => {}, move: async (p) => { const cdp = await p.context().newCDPSession(p); await p.keyboard.press("ArrowDown"); await sleep(500); await cdp.send("Page.setWebLifecycleState", { state: "frozen" }); await sleep(4000); await cdp.send("Page.setWebLifecycleState", { state: "active" }); }, want: 1, wait: SETTLE + 4000 });
await hit("hero->kb iris: reload mid-iris", { setup: async () => {}, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(700); await p.reload({ waitUntil: "load" }); await sleep(3000); }, want: null });
await hit("hero->kb->hero->kb: iris both ways back to back", { setup: async () => {}, move: async (p) => { for (const k of ["ArrowDown", "ArrowUp", "ArrowDown"]) { await p.keyboard.press(k); await sleep(2400); } }, want: 1, wait: SETTLE + 4000 });
await hit("work->contact notes: index still drawing in", { setup: async (p) => { await toAskSettled(p); await p.keyboard.press("ArrowDown"); await sleep(5200); }, move: key("ArrowDown"), want: 4, filmMs: 2500 });
await hit("work->contact notes: a project hovered", { setup: async (p) => { await toWork(p); await p.locator(".wx__list > li").nth(3).hover(); await sleep(600); }, move: key("ArrowDown"), want: 4 });
await hit("contact->work notes: straight back", { setup: async (p) => { await dot(p, 4); await sleep(SETTLE); }, move: key("ArrowUp"), want: 3, filmMs: 2500 });
for (const ms of [80, 300, 700]) {
  await hit(`work->contact notes: Up ${ms} ms in`, { setup: toWork, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(ms); await p.keyboard.press("ArrowUp"); }, want: null });
}
await hit("work->contact notes: resized mid-slap", { setup: toWork, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(250); await p.setViewportSize({ width: 1024, height: 768 }); await sleep(600); await p.setViewportSize({ width: 1920, height: 1080 }); }, want: 4 });
await hit("work->contact notes: reload mid-slap", { setup: toWork, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(300); await p.reload({ waitUntil: "load" }); await sleep(3500); }, want: null });
await hit("End from the hero (dot jump past every cut)", { setup: async () => {}, move: key("End"), want: 4 });
await hit("Home from contact", { setup: async (p) => { await dot(p, 4); await sleep(SETTLE); }, move: key("Home"), want: 0 });

/* ---- reversals inside every scene ---- */
for (const ms of [200, 600, 1200, 2000, 3000]) {
  await hit(`reverse ${ms} ms into kb->machine`, { setup: toCraft, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(ms); await p.keyboard.press("ArrowUp"); }, want: null, wait: SETTLE + 6000 });
  await hit(`reverse ${ms} ms into machine->kb`, { setup: toAskSettled, move: async (p) => { await p.keyboard.press("ArrowUp"); await sleep(ms); await p.keyboard.press("ArrowDown"); }, want: null, wait: SETTLE + 6000 });
  await hit(`reverse ${ms} ms into machine->work`, { setup: toAskSettled, move: async (p) => { await p.keyboard.press("ArrowDown"); await sleep(ms); await p.keyboard.press("ArrowUp"); }, want: null, wait: SETTLE + 6000 });
  await hit(`reverse ${ms} ms into work->machine`, { setup: toWork, move: async (p) => { await p.keyboard.press("ArrowUp"); await sleep(ms); await p.keyboard.press("ArrowDown"); }, want: null, wait: SETTLE + 6000 });
}

await browser.close();
fs.writeFileSync(`${OUT}/hammer-${SK}.json`, JSON.stringify(failures, null, 2));
console.log(`\nhammer: ${pass}/${pass + fail} passed`);
