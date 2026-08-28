/* ---------------------------------------------------------------------------
   TEMPORARY — debug scrubber for the section-transition clips
   ---------------------------------------------------------------------------

   Space pauses / resumes whatever transition clip is on screen, so a frame can
   be looked at properly instead of at 1.55x.

   While this is installed, Space does NOTHING else on the page: the section
   nav's Space-to-advance and the keyboard section's spacebar easter egg are
   both switched off (see the TEMP markers in useSectionNav.ts and
   Keyboard3D.tsx). That is deliberate - two handlers fighting over one key is
   worse than losing the key for a while.

   TO REMOVE, all of it:
     1. delete this file
     2. drop the installDebugPause() effect in App.tsx
     3. restore the `" ": 1` entry in useSectionNav.ts
     4. restore `code: "Space"` on the spacebar cap in Keyboard3D.tsx
     5. drop the __txDebugPaused guard in TransitionPlayer.tsx
   --------------------------------------------------------------------------- */

const VIDEO_SEL = ".transition video";
/** One frame at the clips' 30 fps, near enough for stepping by eye. */
const FRAME = 1 / 30;

declare global {
  interface Window {
    /** Read by TransitionPlayer: holds the transition open while paused. */
    __txDebugPaused?: boolean;
  }
}

export function installDebugPause(): () => void {
  const badge = document.createElement("div");
  badge.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:22px",
    "transform:translateX(-50%)",
    "z-index:99999",
    "padding:7px 14px",
    "border-radius:999px",
    "background:rgba(10,10,11,.9)",
    "color:#ece9e2",
    "font:600 11px/1 ui-monospace,'JetBrains Mono',Menlo,monospace",
    "letter-spacing:.12em",
    "text-transform:uppercase",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity .18s ease",
    "border:1px solid rgba(236,233,226,.18)",
  ].join(";");
  document.body.appendChild(badge);

  const clip = () => document.querySelector<HTMLVideoElement>(VIDEO_SEL);

  const show = (text: string, keep = true) => {
    badge.textContent = text;
    badge.style.opacity = "1";
    if (!keep) window.setTimeout(() => (badge.style.opacity = "0"), 900);
  };

  const readout = (v: HTMLVideoElement) =>
    `paused · ${v.currentTime.toFixed(2)}s / ${(v.duration || 0).toFixed(2)}s`;

  const onKey = (e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    const typing =
      !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    const v = clip();

    if (e.code === "Space") {
      /* Space is claimed here whether or not a clip is up, so it can never
         fall through to the section nav while debugging. */
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!v || !v.src) {
        show("no clip on screen", false);
        return;
      }
      if (v.paused) {
        window.__txDebugPaused = false;
        void v.play().catch(() => {});
        show("playing", false);
      } else {
        v.pause();
        window.__txDebugPaused = true;
        show(readout(v));
      }
      return;
    }

    // , and . step a frame while paused - the usual scrub keys.
    if ((e.code === "Comma" || e.code === "Period") && v && v.paused) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const d = e.code === "Comma" ? -FRAME : FRAME;
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
      show(readout(v));
    }
  };

  // Capture phase: this must see Space before anything else can act on it.
  window.addEventListener("keydown", onKey, true);

  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.__txDebugPaused = false;
    badge.remove();
  };
}
