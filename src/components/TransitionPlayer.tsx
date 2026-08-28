import { forwardRef, useImperativeHandle, useRef } from "react";
import { setClipBusy } from "../lib/transitions";

/* ---------------------------------------------------------------------------
   Full-screen clip player for section transitions.

   The nav's gate calls play(src) and waits on the promise; the clip covers
   the page, and when it ends the promise resolves so the nav can land on the
   next section INSTANTLY underneath it. The overlay is then held on its last
   frame until the page calls hide() - after the new section has rendered in
   the state the clip ended on - so there is never a frame of the wrong
   section showing. A short fade on each end hides the small drift between
   a generated first frame and the live page.
   --------------------------------------------------------------------------- */

export type TransitionHandle = {
  /** Load a clip so it is ready to play the moment it is needed. */
  prime: (src: string) => void;
  /** Play a clip full-screen. Forward: reveal under the first motion, resolve
   *  at ended. Reverse (instantReveal): cover instantly, then hide+resolve
   *  hideBeforeEndS before the static tail, under the board's stand-up. */
  play: (
    src: string,
    opts?: { hideBeforeEndS?: number; instantReveal?: boolean; seamAtEnd?: boolean },
  ) => Promise<void>;
  /** Fade the held last frame away. */
  hide: () => void;
};

/** Clip time of the forward hard cut: within the clip's opening frames,
 *  which are pixel-identical to the live board (measured 0/0). Must be
 *  BEFORE the model's opening settle (~0.13 s in) - after it, the board
 *  sits ~6 px off and the cut shows. */
/* Ceiling on how long the clip may be considered on screen. Longer than any
   clip plus its fade; exists only so a missed hide() cannot leave the nav
   locked. */
const CLIP_BUSY_FAILSAFE = 15000;

const REVEAL_AT_S = 0.05;

/* ---- seam correction -----------------------------------------------------
   MEASURED against the LIVE keyboard (a real screenshot of the running page
   at 1800x1042), not against public/shots/transition-kb-start.png. That
   distinction is the whole story:

   The plate was captured in `?frame=kb`, and in that mode the R3F canvas does
   NOT fill its container - it sits TOP-LEFT ANCHORED at 98.4% of it
   (1822.9x1025.4 inside 1852.4x1042). In normal browsing the canvas fills the
   container exactly (verified stable over 9 s). So the plate - and therefore
   the Higgsfield clip built from it - has the whole scene drawn ~1.6% small
   and pushed up-left. Every earlier calibration compared the clip to that
   plate, agreed with it, and was wrong about the page.

   Because both the canvas and this video are cover-mapped into the same 16:9
   box, the fix is a scale about that box's TOP-LEFT corner - which is where
   the shrunken canvas was anchored. That makes it viewport-independent.

   Measured from real screenshots, live board vs clip frame 0 at 1800x1042:
       raw                    dx +15.78  dy +3.36   w 1.0196  h 1.0363
       uniform 1.0162         dx  +0.50  dy -0.39   w 1.0013  h 1.0195
       1.0162 x / 1.0360 y    dx  +0.39  dy +0.02   w 1.0013  h 1.0000

   Correcting the whole clip would drag its END out of register with the
   machine, so this is applied at the cut and ramped off (see SEAM_RAMP_S). */
const SEAM_SCALE_X = 1.0162;
/* Y is larger because two errors stack on that axis: the same 1.62% canvas
   shrink, PLUS the model drawing the board ~2% shorter than the page does
   (live spans y 136..868, the clip 143..861 - symmetric about the centroid,
   so a real size difference, not noise). Correcting them separately is a 2%
   vertical stretch of the clip, invisible on this content and worth it: with
   a single uniform scale the board still ends up 2% short. */
const SEAM_SCALE_Y = 1.0360;
/* Percentage of frame height, so it scales with the viewport.
   NEGATIVE: scaling about the frame's TOP edge already carries the board
   down by (scale x its distance from that edge), so the residual is taken
   back OFF that, not added to it. With the wrong sign it doubles the error
   instead of cancelling it - measured -0.39 px right, +8.40 px wrong. */
const SEAM_DY_PCT = -1.329;

/* The give-back is itself motion, so what matters is its RATE. At 0.55 s the
   old correction unwound at ~11 px/s, plainly visible - it turned one jump
   into a short drift, which is why the shift kept "getting smaller" without
   going away. Over 1.8 s it is ~3 px/s, under the threshold for spotting
   drift on a board that is tumbling behind a wipe, and it finishes inside
   clip A (2.0 s at 2.5x). Linear: any easing puts a fast segment somewhere,
   and a fast segment is the thing being avoided. */
/* ---- lighting -------------------------------------------------------------
   Brian, once the position lined up: "the difference I see is a slight
   lighting difference from the live into the video". Measured over the board
   area of real screenshots, the clip is ~7% darker than the live WebGL frame
   and its highlights are rolled off - Higgsfield's render is flatter than the
   real lamp:

       mean luminance      live 29.61   clip 27.69   (ratio 1.0694)
       brightest bucket    live  1.21%  clip  0.40%  of pixels

   brightness(1.07) puts both back:

       mean luminance      live 29.61   clip 29.57   (ratio 1.0014)
       brightest bucket    live  1.21%  clip  1.20%

   Ramped off exactly like the geometry, and for the same reason: correcting
   the whole clip would push the machine at the END too bright to match the
   live section it lands on. */
const SEAM_BRIGHTNESS = 1.07;

const SEAM_RAMP_S = 1.8;
const SEAM_EASE = "linear";
const SEAM_EASE_IN = "linear";


/** Where the cover-fitted 16:9 image's top-left corner sits inside the video
 *  element. The element is the viewport; the image overflows whichever axis
 *  cover had to grow, so this is negative on that axis. */
function coverOrigin(v: HTMLVideoElement) {
  const r = v.getBoundingClientRect();
  const coverW = (r.height * 16) / 9;
  if (coverW >= r.width) return { x: (r.width - coverW) / 2, y: 0 };
  const coverH = (r.width * 9) / 16;
  return { x: 0, y: (r.height - coverH) / 2 };
}

const TransitionPlayer = forwardRef<TransitionHandle>(function TransitionPlayer(_, ref) {
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    prime(src) {
      const v = video.current;
      if (!v) return;
      v.style.transition = "none";
      v.style.transform = "none";
      v.style.filter = "none";
      if (!v.src.endsWith(src)) {
        v.src = src;
        v.load();
      }
    },
    play(src, opts) {
      const v = video.current;
      const h = host.current;
      if (!v || !h) return Promise.resolve();
      if (!v.src.endsWith(src)) {
        v.src = src;
        v.load();
      }
      const hideBeforeEndS = opts?.hideBeforeEndS ?? 0;
      const instantReveal = opts?.instantReveal ?? false;
      const seamAtEnd = opts?.seamAtEnd ?? false;
      let seamArmed = false;
      /* Held for the whole visible transition: the nav blocks scroll input
         while this is true, so a second gesture cannot start the next move
         while this one is still playing out. Cleared by hide(); the failsafe
         guarantees it cannot be left set and strand the page. */
      setClipBusy(true);
      window.setTimeout(() => setClipBusy(false), CLIP_BUSY_FAILSAFE);
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          /* NOT setClipBusy(false) here. `finish` fires when the footage
             ends, but the overlay is still on screen for the fade and the
             landed section is still arriving underneath it - the transition
             is not over yet, and the nav must stay locked. hide() releases
             it, with the failsafe below in case hide never comes. */
          v.removeEventListener("ended", finish);
          v.removeEventListener("error", finish);
          resolve();
        };
        v.addEventListener("ended", finish);
        v.addEventListener("error", finish);
        v.currentTime = 0;
        v.play().catch(finish);

        if (instantReveal) {
          /* Reverse: cover NOW with no fade, so the machine we are leaving is
             hidden in a single frame (App blacks its glass to match the clip's
             dark-screen first frame) rather than cross-dissolving to it. */
          const prev = h.style.transition;
          h.style.transition = "none";
          h.classList.add("is-on");
          void h.offsetWidth;
          h.style.transition = prev;
        }

        const tick = () => {
          if (done) return;
          const dur = v.duration || 999;
          if (seamAtEnd && !seamArmed && v.duration && v.currentTime >= dur - SEAM_RAMP_S) {
            /* Reverse: the clip ENDS on the keyboard, so the correction has
               to be ramped IN rather than out - arriving exactly as the last
               frame lands, so the frame we hold matches the live board. */
            seamArmed = true;
            const o = coverOrigin(v);
            v.style.transformOrigin = `${o.x}px ${o.y}px`;
            v.style.transition =
              `transform ${SEAM_RAMP_S}s ${SEAM_EASE_IN}, filter ${SEAM_RAMP_S}s ${SEAM_EASE_IN}`;
            v.style.transform = `translateY(${SEAM_DY_PCT}%) scale(${SEAM_SCALE_X}, ${SEAM_SCALE_Y})`;
            v.style.filter = `brightness(${SEAM_BRIGHTNESS})`;
          }
          if (hideBeforeEndS > 0) {
            /* Reverse: hide + land BEFORE the clip's static K tail, so the
               swap to the live (sharp) board happens under the stand-up. */
            if (v.currentTime >= dur - hideBeforeEndS) {
              h.classList.remove("is-on");
              finish();
              return;
            }
          } else if (v.currentTime >= REVEAL_AT_S && !h.classList.contains("is-on")) {
            /* Forward: a HARD cut on the frames that match the live page. A
               fade here blends the static live board with the clip's moving
               one, and that half-transparent overlap is what reads as a
               lurch - the instant cut is the invisible one. The seam
               correction below makes the two boards actually coincide. */
            const o = coverOrigin(v);
            v.style.transformOrigin = `${o.x}px ${o.y}px`;
            v.style.transition = "none";
            v.style.transform = `translateY(${SEAM_DY_PCT}%) scale(${SEAM_SCALE_X}, ${SEAM_SCALE_Y})`;
            v.style.filter = `brightness(${SEAM_BRIGHTNESS})`;
            const prev = h.style.transition;
            h.style.transition = "none";
            h.classList.add("is-on");
            void h.offsetWidth;
            h.style.transition = prev;
            /* second frame: let the corrected transform commit before the
               ramp is armed, or the browser collapses both into one step */
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                v.style.transition =
                  `transform ${SEAM_RAMP_S}s ${SEAM_EASE}, filter ${SEAM_RAMP_S}s ${SEAM_EASE}`;
                v.style.transform = "none";
                v.style.filter = "none";
              });
            });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        /* a clip that never plays must not lock the page: 12 s is longer than
           any transition clip we ship */
        window.setTimeout(finish, 12000);
      });
    },
    hide() {
      const h = host.current;
      const v = video.current;
      if (!h) return;
      h.classList.remove("is-on");
      window.setTimeout(() => v?.pause(), 300);
      /* the overlay is dismissed once its fade is done - that is the end of
         the transition, and where the nav becomes free again */
      window.setTimeout(() => setClipBusy(false), 420);
    },
  }));

  return (
    <div className="transition" ref={host} aria-hidden>
      <video ref={video} muted playsInline preload="auto" />
    </div>
  );
});

export default TransitionPlayer;
