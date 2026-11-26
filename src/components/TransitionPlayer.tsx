import { forwardRef, useImperativeHandle, useRef } from "react";
import { setClipBusy } from "../lib/transitions";
import { boardPlacement } from "../lib/boardState";

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
  /** Resolves once the primed clip can play through (or is already playable). */
  whenReady: (src: string) => Promise<void>;
  /** Play a clip full-screen. Forward: reveal under the first motion, resolve
   *  at ended. Reverse (instantReveal): cover instantly, then hide+resolve
   *  hideBeforeEndS before the static tail, under the board's stand-up. */
  play: (
    src: string,
    opts?: {
      hideBeforeEndS?: number;
      instantReveal?: boolean;
      seamAtEnd?: boolean;
      /** element playback rate; defaults to PLAYBACK_RATE */
      rate?: number;
    },
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

/* ---- playback rate --------------------------------------------------------
   The master is cut at 2.5x (docs/transition-kb-machine.md s14): 4.52 s at
   60 fps with every frame unique. Brian wants it quicker still (2026-10-20:
   "like 1.5-2x faster"), so the element plays it at 2x - 2.26 s. That is
   the one speed in his range that keeps the cadence even: 120 unique fps on
   a 60 Hz panel drops exactly every other frame, and a 120 Hz panel shows
   every one. 1.5x would be 90 fps on 60 Hz, a hold-1/hold-2 pattern - the
   judder s11 was about.

   Done on the element rather than in the build so the footage keeps all of
   its frames and the speed is one number. The seam ramps below run in wall
   time but are ARMED in clip time, so their wall durations are divided by
   the rate to keep covering the same footage (s19). */
const PLAYBACK_RATE = 2;

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
   instead of cancelling it - measured -0.39 px right, +8.40 px wrong.
   2026-11-26: -1.329 -> -1.54. The live board had come to sit ~2px higher
   than the clip's keyboard frames (0.2% of the height, at 1536x864, 1600x900
   and 1920x1080 alike), at BOTH ends that show it: the forward cut (masked -
   the board is moving by then) and the reverse clip's held last frame, where
   it was the "slight shift" going back up from the machine (Brian, on a 16:9
   monitor). One constant, so both directions move together. */
const SEAM_DY_PCT = -1.54;

/* The give-back is itself motion, so what matters is its RATE. At 0.55 s the
   old correction unwound at ~11 px/s, plainly visible - it turned one jump
   into a short drift, which is why the shift kept "getting smaller" without
   going away. Over 1.8 s it is ~3 px/s, under the threshold for spotting
   drift on a board that is tumbling behind a wipe, and it finishes inside
   clip A (2.0 s at 2.5x). Linear: any easing puts a fast segment somewhere,
   and a fast segment is the thing being avoided. */
/* ---- colour ---------------------------------------------------------------
   A grade for each END of the clip, and the clip carries it from one to the
   other as it plays: the keyboard end matched to the live board, the machine
   end to the live machine. Fitted 2026-11-26 from real screenshots at
   1600x900 (clip frames with no filter vs the live page, pixel-aligned),
   as CSS filter functions so the grade can be transitioned (an SVG matrix
   could not).

   It replaced brightness(1.07) at the keyboard end only. That was measured in
   August against the whole frame, when the clip was ~7% darker; since then
   the board itself had come out BRIGHTER than live (luminance 103 vs 102),
   while the void around it stayed darker (4.2 vs 6.8, the page's spotlight
   glow). The flat boost pushed the board to 110 - mean error 13.8 against no
   correction's 9.1, the "color grading slightly off" at the seams (Brian).

       keyboard, whole frame   error  board 9.39 (none 9.12, old 13.84)
                                      void  1.73 (none 3.33, old  3.38)
                               board luminance 100.2 vs live 101.5
       machine case            error  3.76 (none 6.95); the clip's beige
                               was cooler and lighter than the live one

   The rest of the keyboard's difference is not colour (the best possible
   colour map takes it only from 9.1 to 8.6): it is the footage's softer
   legends and highlights. */
const GRADE_KB = "brightness(0.960) contrast(0.968) saturate(1.066)";
const GRADE_MACHINE = "brightness(0.932) contrast(1.141) saturate(1.065)";

const SEAM_RAMP_S = 1.8;
const SEAM_EASE = "linear";
const SEAM_EASE_IN = "linear";


/* ---- the correction follows the live board -----------------------------
   SEAM_* map the clip's keyboard onto the live board AS IT WAS PLACED when
   they were measured: the standing board's box, as fractions of its canvas,
   was N_REF (2026-11-26; the same at every 16:9 size, with or without a
   scrollbar), and the canvas was exactly the clip's cover box. Anything
   that has moved the live board since - a change to its pose or camera fit,
   a canvas measured wrong, a surface laid out differently on some device -
   used to show as a few pixels of shift at the seams, found by eye each time
   and fixed by re-tuning SEAM_DY_PCT (2026-11-26: 2px, the way back up from
   the machine). Now the board is asked where it is (lib/boardState.ts), and
   the clip is fitted from where the reference board would be onto where the
   live one is. With nothing moved that is the identity; the constants only
   go stale if the VIDEO is re-rendered. */
const N_REF = { x0: 0.23762, y0: 0.06059, x1: 0.78747, y1: 0.95091 };
/* a measurement this far from the reference is not the board having moved,
   it is something not laid out yet: ignore it, keep the calibrated fit */
const FOLLOW_LIMIT = 0.12;

/** The seam correction as one matrix (transform-origin 0 0): the calibrated
 *  clip -> reference-board fit, then reference board -> live board. */
function seamTransform(v: HTMLVideoElement): string {
  const r = v.getBoundingClientRect();
  const o = coverOrigin(v);
  const cw = Math.max(r.width, (r.height * 16) / 9);
  const ch = Math.max(r.height, (r.width * 9) / 16);
  const sx = SEAM_SCALE_X;
  const sy = SEAM_SCALE_Y;
  const ty = (SEAM_DY_PCT / 100) * r.height;
  /* calibrated: p' = O + S(p - O) + (0, ty) */
  let kx = 1;
  let ky = 1;
  let lx = 0;
  let ly = 0;
  let ix = 0;
  let iy = 0;
  const b = boardPlacement();
  if (b) {
    const ideal = { x: o.x + N_REF.x0 * cw, y: o.y + N_REF.y0 * ch, w: (N_REF.x1 - N_REF.x0) * cw, h: (N_REF.y1 - N_REF.y0) * ch };
    const live = {
      x: b.canvas.x - r.left + b.n.x0 * b.canvas.w,
      y: b.canvas.y - r.top + b.n.y0 * b.canvas.h,
      w: (b.n.x1 - b.n.x0) * b.canvas.w,
      h: (b.n.y1 - b.n.y0) * b.canvas.h,
    };
    const fx = live.w / ideal.w;
    const fy = live.h / ideal.h;
    const off = Math.max(Math.abs(live.x - ideal.x), Math.abs(live.y - ideal.y)) / Math.min(r.width, r.height);
    if (Math.abs(fx - 1) < FOLLOW_LIMIT && Math.abs(fy - 1) < FOLLOW_LIMIT && off < FOLLOW_LIMIT) {
      kx = fx;
      ky = fy;
      lx = live.x;
      ly = live.y;
      ix = ideal.x;
      iy = ideal.y;
    }
  }
  /* then: p'' = L + K(p' - I)  =>  p'' = K S p + L + K(O - S O + T - I) */
  const a = kx * sx;
  const d = ky * sy;
  const e = lx + kx * (o.x - sx * o.x - ix);
  const f = ly + ky * (o.y - sy * o.y + ty - iy);
  return `matrix(${a}, 0, 0, ${d}, ${e}, ${f})`;
}

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
    whenReady(src) {
      const v = video.current;
      return new Promise<void>((resolve) => {
        if (!v) return resolve();
        const ok = () => v.src.endsWith(src) && v.readyState >= 4;
        if (ok()) return resolve();
        const check = () => {
          if (!ok()) return;
          v.removeEventListener("canplaythrough", check);
          v.removeEventListener("progress", check);
          resolve();
        };
        v.addEventListener("canplaythrough", check);
        v.addEventListener("progress", check);
      });
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
      const rate = opts?.rate ?? PLAYBACK_RATE;
      /* wall seconds the ramp takes to cover SEAM_RAMP_S of footage */
      const rampS = SEAM_RAMP_S / rate;
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
        /* after load(): the load algorithm resets playbackRate to the
           element default, so setting it earlier would not survive */
        v.playbackRate = rate;
        v.play().catch(finish);

        /* the clip's wall-clock length: the grade travels across all of it */
        const gradeS = Math.max(0.1, (v.duration || 4.5) / rate);
        if (instantReveal) {
          /* reverse: it opens on the machine, in the machine's grade */
          v.style.transition = "none";
          v.style.filter = GRADE_MACHINE;
          void v.offsetWidth;
          v.style.transition = `filter ${gradeS}s linear`;
          v.style.filter = GRADE_KB;
        }
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
            v.style.transformOrigin = "0 0";
            /* the filter's own transition (machine -> keyboard grade, set
               at the start) is left running: it is listed with the same
               duration, and its value is not touched */
            v.style.transition =
              `transform ${rampS}s ${SEAM_EASE_IN}, filter ${gradeS}s linear`;
            v.style.transform = seamTransform(v);
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
            v.style.transformOrigin = "0 0";
            v.style.transition = "none";
            v.style.transform = seamTransform(v);
            v.style.filter = GRADE_KB;
            const prev = h.style.transition;
            h.style.transition = "none";
            h.classList.add("is-on");
            void h.offsetWidth;
            h.style.transition = prev;
            /* second frame: let the corrected transform commit before the
               ramp is armed, or the browser collapses both into one step */
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const left = Math.max(0.1, ((v.duration || 4.5) - v.currentTime) / rate);
                v.style.transition =
                  `transform ${rampS}s ${SEAM_EASE}, filter ${left}s linear`;
                v.style.transform = "none";
                v.style.filter = GRADE_MACHINE;
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
