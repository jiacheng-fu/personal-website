// Development: saving a file while the site is open, in awkward moments.
//   node hmr2.mjs <devURL> <projectCopyDir> <outDir>
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const { chromium } = require("playwright-core");
const [, , URL, W, OUT] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, channel: "chrome" });
const NAMES = ["top", "craft", "ask", "work", "contact"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const look = (p) => p.evaluate(() => {
  const i = [...document.querySelectorAll(".dots__dot")].findIndex((d) => d.classList.contains("is-on"));
  const t = document.querySelectorAll(".panel")[i]?.offsetTop;
  return {
    i, aligned: Math.abs(scrollY - t) < 3, y: Math.round(scrollY),
    kbLit: document.querySelector(".panel--void")?.classList.contains("is-lit"),
    glass: (document.querySelector(".a2m__screen")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 28),
    prompt: !!document.querySelector(".a2-prompt input"),
    rows: [...document.querySelectorAll(".wx__list > li")].every((li) => +getComputedStyle(li).opacity > 0.9),
    fallback: !!document.querySelector('[role="alert"]'),
    optin: !!document.querySelector(".a2-optin"),
    clip: !!document.querySelector(".transition.is-on"), handoff: !!document.querySelector(".handoff.is-on"),
    rag: document.querySelector(".rag")?.className || "",
  };
});
/* a save that changes nothing: what an editor does on Cmd+S */
async function save(rel) {
  const path = `${W}/${rel}`; const orig = fs.readFileSync(path, "utf8");
  fs.writeFileSync(path, orig + (rel.endsWith(".css") ? `\n/* probe ${Date.now()} */\n` : `\n// probe ${Date.now()}\n`));
  return () => fs.writeFileSync(path, orig);
}
async function run(name, target, act, expect = target, more = () => []) {
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
  await p.goto(URL, { waitUntil: "load" }); await sleep(3500);
  if (target > 0) { await p.locator(`.dots__dot[data-section="${NAMES[target]}"]`).click({ force: true }); await sleep(9000); }
  const undo = await act(p);
  await sleep(9000);
  if (undo) { undo(); await sleep(9000); }
  const r = await look(p);
  const probs = [];
  if (expect !== null && r.i !== expect) probs.push(`dot ${NAMES[r.i]} want ${NAMES[expect]}`);
  if (!r.aligned) probs.push(`not aligned (y ${r.y})`);
  if (r.fallback) probs.push("SafetyNet fallback showing");
  if (r.clip || r.handoff) probs.push("overlay stuck on");
  if (/is-continuing|is-handoff|is-scrolled/.test(r.rag)) probs.push("rag stuck " + r.rag);
  if (r.i === 1 && !r.kbLit) probs.push("keyboard dark");
  if (r.i === 2 && !r.prompt) probs.push(`machine not live, glass "${r.glass}"`);
  if (r.i === 3 && !r.rows) probs.push("project titles invisible");
  probs.push(...more(r));
  // still answers?
  const dir = r.i < 4 ? "ArrowDown" : "ArrowUp";
  await p.keyboard.press(dir); await sleep(9000);
  if ((await look(p)).i === r.i) probs.push("nav dead after the save");
  if (errs.length) probs.push("pageerror: " + [...new Set(errs)].join(" | "));
  await p.screenshot({ path: `${OUT}/hmr2-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png` });
  probs.length ? fail++ : pass++;
  console.log(`${probs.length ? "FAIL" : "ok  "} ${name} -> ${NAMES[r.i]}${probs.length ? "\n      - " + probs.join("\n      - ") : ""}`);
  await ctx.close();
}

await run("H1 save RagSection.tsx on the machine", 2, () => save("src/components/RagSection.tsx"));
await run("H2 save App.css on work", 3, () => save("src/App.css"));
await run("H3 save WorkIndex.css on work", 3, () => save("src/components/WorkIndex.css"));
await run("H4 save useSectionNav.ts 1 s into the kb->machine clip", 1, async (p) => { await p.keyboard.press("ArrowDown"); await sleep(1000); return save("src/hooks/useSectionNav.ts"); }, null);
await run("H5 save App.tsx 1.5 s into the machine->work handoff", 2, async (p) => { await p.waitForSelector(".a2-prompt input", { timeout: 60000 }); await p.keyboard.press("ArrowDown"); await sleep(1500); return save("src/App.tsx"); }, null);
await run("H6 three saves 300 ms apart on contact", 4, async () => { const u1 = await save("src/components/Hero.tsx"); await sleep(300); u1(); await sleep(300); const u2 = await save("src/components/Hero.tsx"); await sleep(300); return u2; });
await run("H7 save with the LLM opt-in up", 2, async (p) => { await p.waitForSelector(".a2-prompt input", { timeout: 60000 }); await sleep(1000); await p.locator(".a2-llm").first().click(); await p.waitForSelector(".a2-optin"); return save("src/components/RagSection.tsx"); }, 2, (r) => (r.optin ? ["opt-in still up after the reload"] : []));
await run("H8 save Keyboard3D.tsx on the keyboard", 1, () => save("src/components/Keyboard3D.tsx"));
await run("H9 save Hero.tsx on the hero", 0, () => save("src/components/Hero.tsx"));
await b.close();
console.log(`\nhmr2: ${pass}/${pass + fail} passed`);
