# Site QA suites (Playwright, headless Chrome)

Run against a built preview (`npm run build && npx vite preview --port 4173`),
or a dev server for `hmr2.mjs`. Each prints `ok` / `FAIL` lines and a summary.

| script | what it hammers |
| --- | --- |
| `hammer.mjs <url> <outDir> [filter]` | every transition started mid-something (boot, answer, opt-in, shred, reel, iris, notes), reversals inside each scene, resize/reload/hidden tab mid-cut; per-frame probe for stacked text, wiped classes, leftovers. `SHARD=k/n` to split. |
| `fast.mjs <engine> <url> <outDir> fast\|optin\|reload` | wheel spins, flicks, huge deltas, held keys, Tab, native scroll, pinch, phone swipes; every exit from the LLM opt-in; reloads mid-transition, Back/Forward |
| `ratio.mjs <engine> <url> <outDir> sweep\|live\|boxed\|storm [k/n]` | 28 window sizes through all sections (clip auto-toggle, layout, screenshots), live resizes across the thresholds, the ultrawide 16:9 frame, resize storms |
| `qa.mjs <engine> <url> <outDir> [suites]` | the original transition suite: core, input, reverse, jumps, motionoff, optin, reload, touch, reduced, frozen, resize, fuzz, soak |
| `stack.mjs <url> <outDir>` | machine -> projects started while the glass is still changing; flags overlay text on live text |
| `hmr2.mjs <devUrl> <projectDir> <outDir>` | dev only: saving files mid-transition / with the opt-in up / in quick succession |
| `tab.mjs`, `cards.mjs`, `heroname.mjs`, `short.mjs` | one-off probes: Tab focus vs the nav, machine cards vs the glass, the hero name per window size, short screens |

They `require` playwright-core from this repo and use the system Chrome
(`channel: "chrome"`). The model download is blocked in the suites that touch
the LLM switch, so nothing large is fetched.
