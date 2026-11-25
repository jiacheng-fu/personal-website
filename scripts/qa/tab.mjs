import { createRequire } from "module";
const require = createRequire("/Users/brianfu/Desktop/Personal Website/package.json");
const pw = require("playwright-core");
const b = await pw.chromium.launch({ headless: true, channel: "chrome" });
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await p.goto(process.argv[2], { waitUntil: "load" }); await new Promise(r => setTimeout(r, 3000));
const look = () => p.evaluate(() => { const i = [...document.querySelectorAll(".dots__dot")].findIndex((d) => d.classList.contains("is-on")); const a = document.activeElement; const sec = a?.closest(".panel")?.id || "(outside panels)"; return `dot ${["top","craft","ask","work","contact"][i]}, scrollY ${Math.round(scrollY)} (panel tops 0/1080/2160/3240/4320), focus ${a?.tagName}.${String(a?.className || "").split(" ")[0]} in ${sec}`; });
for (let i = 1; i <= 30; i++) { await p.keyboard.press("Tab"); await new Promise(r => setTimeout(r, 250)); const l = await look(); if (i <= 4 || i % 3 === 0) console.log(`Tab ${String(i).padStart(2)}: ${l}`); }
await b.close();
