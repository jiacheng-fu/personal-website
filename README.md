# Personal Website
**Live: https://brianfu.vercel.app**

Portfolio site. React + TypeScript + Vite, deployed on Vercel.

The background is a hand-written WebGL fragment shader: domain-warped fBm (noise
of noise) with a cosine palette, warping toward the pointer. The palette phase
offsets are kept tight on purpose - spreading them sends the channels out of step
and produces a full-spectrum rainbow that competes with the type.

Project rows track their own scroll progress through a spring rather than firing
a single whileInView tween, so they keep easing as you scroll instead of snapping
once. All motion is gated behind `useReducedMotion` and a `prefers-reduced-motion`
block.

    npm install && npm run dev

An animated, generative personal site — built as much to *be* a piece of work as to describe one.

A custom WebGL fragment shader paints a flowing, iridescent field that warps toward your cursor, with Framer Motion driving orchestrated reveals, a custom cursor, and scroll-triggered choreography on top.

## Stack

- **Vite** + **React** + **TypeScript**
- **Framer Motion** (`motion`) — reveals & micro-interactions
- **Raw WebGL / GLSL** — the generative background (no 3D library)
- Type: `Instrument Serif` × `JetBrains Mono`

## Develop

```bash
npm install
npm run dev      # start the dev server on :5173 and open the tab in Chrome
npm run stop     # stop it and close that tab again
npm run restart  # same as dev
npm run build    # typecheck + production build
npm run preview  # preview the production build
npm run dev:vite # bare `vite`, no launcher
```

`npm run dev` goes through `dev.cjs`, which frees port 5173 before starting and
passes `--strictPort`. Plain `vite` does not fail when a dev server from an
earlier session is still running - it prints "Port 5173 is in use, trying
another one" and moves to 5174, so the URL changes between sessions and an open
tab quietly points at a server that no longer exists. (One had been running here
for over a day.) The launcher only ever kills a process whose command line is
THIS project's vite; anything else holding the port is reported and left alone.

Add `-- --no-open` / `-- --no-close`, or set `DEV_OPEN=0`, to leave the browser
alone. Tab handling is macOS + Chrome; elsewhere opening falls back to the
default browser and closing is skipped.

## Customize

- **Your content** lives in [`src/data/content.ts`](src/data/content.ts) — name, tagline, projects, stack.
- **The look** (colors, fonts) is in CSS variables at the top of [`src/index.css`](src/index.css).
- **The shader** is in [`src/components/ShaderBackground.tsx`](src/components/ShaderBackground.tsx).

Respects `prefers-reduced-motion` and falls back to a static gradient if WebGL is unavailable.
