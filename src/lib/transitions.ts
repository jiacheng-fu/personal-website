/* Section-transition clips: the page-wide switch, the aspect policy, and
 * the "frame" the whole site is laid out in.
 *
 * The clips are 16:9. Policy (Brian, 2026-08-26):
 *   16:9, 16:10 and similar  -> one 16:9 surface anchored to the viewport
 *                               centre and cropped; no bars, no stretching.
 *                               Page and clip share the anchor, so cuts are
 *                               pixel-exact.
 *   extreme (portrait, square) -> no clips; the ordinary layouts, hard cuts.
 *   ultrawide (21:9 and wider) -> the visitor chooses on first load: hard
 *                               cuts, or a letterboxed 16:9 frame with black
 *                               bars at the sides in which everything plays.
 * Session memory only, like sound. */

let enabled = true;

/* Is a clip on screen right now?
   The Qwen3 preload downloads weights and compiles GPU shaders, which
   contends with video decode and the compositor for exactly the resources a
   clip needs. Starting that mid-transition drops frames, and dropped frames
   in a clip that is meant to line up with the live page read as a jump.
   TransitionPlayer raises this for the length of a clip; the preload waits
   it out. */
let clipBusy = false;
export function setClipBusy(on: boolean) {
  clipBusy = on;
}
export function isClipBusy() {
  return clipBusy;
}

/* Hard lock on section changes.

   `clipBusy` above is only about preloading. This one stops the NAV: while a
   transition is playing, a wheel, a key or a progress dot must not start
   another one. The nav's own `busy` flag only lasts until the gate's promise
   resolves, which is not the same thing - a transition can still be finishing
   after it has handed the page over, and a gesture landing in that window
   skipped a section and left the half-played scene running against a page
   that had moved on.

   Anything that animates across a boundary should hold this for as long as it
   is actually on screen, not just for the part that covers the jump. */
let navLocked = false;
export function setNavLocked(on: boolean) {
  navLocked = on;
}
export function isNavLocked() {
  return navLocked;
}

export function transitionsEnabled() {
  return enabled;
}
export function toggleTransitions(): boolean {
  enabled = !enabled;
  return enabled;
}

/* ---- the frame -------------------------------------------------------- */

export type Frame = { left: number; top: number; w: number; h: number };

const BOX_KEY = "frame16x9";
const REF_ASPECT = 16 / 9;

export function isBoxed() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("is-boxed");
}

/** The box the page actually lays out in - what `position: fixed; inset: 0`
 *  fills, and so exactly the box the clip overlay draws into. NOT innerWidth:
 *  that counts a classic scrollbar (Windows always, macOS with a mouse
 *  plugged in, in Chrome, Firefox and Safari alike), the page and the
 *  overlay do not, and the 15px between them was the "shift" at the end of
 *  the keyboard->machine clip (measured 2026-11-25: clip 7-8px left of the
 *  machine, plus a scale miss on wide windows). */
function layoutViewport() {
  const el = document.documentElement;
  return { vw: el.clientWidth || window.innerWidth, vh: el.clientHeight || window.innerHeight };
}

/** Where the site is drawn: the whole viewport, or the centred 16:9 box. */
export function viewportFrame(): Frame {
  const { vw, vh } = layoutViewport();
  if (isBoxed()) {
    const w = Math.min(vw, Math.round(vh * REF_ASPECT));
    return { left: Math.round((vw - w) / 2), top: 0, w, h: vh };
  }
  return { left: 0, top: 0, w: vw, h: vh };
}

function applyFrameVars() {
  const f = viewportFrame();
  const s = document.documentElement.style;
  s.setProperty("--frame-left", `${f.left}px`);
  s.setProperty("--frame-w", `${f.w}px`);
  s.setProperty("--frame-h", `${f.h}px`);
  /* The keyboard renders on a 16:9 surface that COVERS the frame, so when the
     frame is taller than 16:9 that surface is wider than the screen and hangs
     off both edges by this much. Anything positioned inside it (the caption)
     would otherwise be pushed off with it - `right: 3rem` measured from a box
     whose right edge is already 139px past the viewport puts the text 91px
     into nowhere. Published so that CSS can pin to the SCREEN edge instead. */
  const surfaceW = Math.max(f.w, (f.h * 16) / 9);
  s.setProperty("--frame-overhang-x", `${Math.max(0, (surfaceW - f.w) / 2)}px`);
}

export function setBoxed(on: boolean) {
  document.documentElement.classList.toggle("is-boxed", on);
  try {
    sessionStorage.setItem(BOX_KEY, on ? "1" : "0");
  } catch {
    /* private mode etc. - the choice just won't persist across reloads */
  }
  applyFrameVars();
  window.dispatchEvent(new Event("resize"));
}

/** Restore a stored choice and keep the frame vars current. Call once. */
export function initFrame() {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(BOX_KEY);
  } catch {
    /* ignore */
  }
  if (stored === "1") document.documentElement.classList.add("is-boxed");
  applyFrameVars();

  /* Keeping --frame-w/--frame-h honest is harder than a `resize` listener.
     Three things go wrong on macOS:

       1. Entering fullscreen does not reliably fire `resize` at all (the same
          note is already in useSectionNav: "Fullscreen does not always emit a
          plain resize; these do.").
       2. The fullscreen transition is ANIMATED, so anything that samples a
          frame or two after the event reads a size the window is still
          moving through.
       3. In macOS fullscreen Chrome keeps its toolbar and AUTO-HIDES it, so
          the viewport silently changes height whenever the pointer visits
          the top of the screen.

     Any of those leaves the vars describing a window that is no longer there,
     and because the keyboard's 16:9 cover surface is
     `max(--frame-w, --frame-h * 16/9)`, a stale --frame-h of 1169 against a
     real viewport of 936 blows the surface out to 2078 wide: the board
     renders ~15% too big and overhangs the right edge.

     A ResizeObserver on the root element sees every one of those, including
     mid-animation, so the vars converge on the size that actually ends up on
     screen. The events stay as belt-and-braces for anything the observer
     misses. */
  let raf = 0;
  const relayout = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(applyFrameVars);
  };
  const ro = new ResizeObserver(relayout);
  ro.observe(document.documentElement);
  window.addEventListener("resize", relayout);
  document.addEventListener("fullscreenchange", relayout);
  window.visualViewport?.addEventListener("resize", relayout);
  window.visualViewport?.addEventListener("scroll", relayout);
  return stored; // "1" | "0" | null (never asked)
}

export function isUltrawide() {
  const { vw, vh } = layoutViewport();
  return vw >= 720 && vw / vh > 2.05;
}

/** May a clip play right now? Wide enough, aspect in the 16:9 family, motion
 *  not reduced, switch on. The boxed frame is 16:9 by construction. */
export function transitionAllowed() {
  if (!enabled) return false;
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const f = viewportFrame();
  if (f.w < 720) return false;
  const aspect = f.w / f.h;
  return aspect >= 1.45 && aspect <= 2.05;
}

/* bump CLIP_VERSION whenever the files change, so no browser or CDN serves
   an older cut under the same URL */
const CLIP_VERSION = "22";
export const CLIPS = {
  kbToMachine: `/transitions/kb-machine.mp4?v=${CLIP_VERSION}`,
  machineToKb: `/transitions/kb-machine-rev.mp4?v=${CLIP_VERSION}`,
} as const;
