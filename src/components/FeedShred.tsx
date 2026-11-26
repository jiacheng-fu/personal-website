import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import "./FeedShred.css";
import { JS_ANIM } from "../lib/motionJs";

/* ---------------------------------------------------------------------------
   Feeding the machine, through a shredder

   The note is cut into strips, the strips separate and curl, and then they are
   thrown at the machine and swallowed by it - which knocks the machine.

   Three things make it read as impact rather than dissolve:

   1. The strips stop at the machine's EDGE, not at the middle of its screen.
      Flying to the centre meant they spent the whole trip drawn on top of the
      machine, which looks like an overlay, not like paper going in.

   2. The layer is CLIPPED at that edge. A strip crossing the line is cut off
      rather than faded out, so it is eaten by the machine exactly the way
      paper disappears into a slot. Nothing ever overlaps.

   3. The machine is jolted when they land. Nothing else on the page moves, so
      a 500 ms damped rock is enough to sell the hit.

   The cut itself: a live <textarea> cannot be sliced, so at submit the note is
   replaced in place by a static replica, and N identical copies of that
   replica are each clipped to one vertical band with `clip-path: inset()`.
   Identical copies are what keep the text aligned across the cuts. The clip is
   set once and never animated - only transform moves.
   --------------------------------------------------------------------------- */

const STRIPS = 18;
/** Total flight. Short on purpose: this is a throw, not a drift. */
const DURATION = 0.82;
/** Fraction of the flight spent being cut, before the throw begins. */
const CUT = 0.4;
/** When the leading strips reach the machine, as a fraction of DURATION. */
const IMPACT = 0.9;
/** Length of the machine's tumble. Long, because it is meant to read as a
 *  heavy object nearly going over and then settling - not a shiver. */
const TUMBLE_MS = 1383;

/* Deterministic jitter. Math.random() would re-roll on every React render and
   make strips twitch mid-flight; this is stable for a given index. */
const wobble = (i: number, salt: number) => {
  const n = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1; // -1..1
};

type Geom = {
  /** Distance from the note's left edge to the machine's near edge. */
  clipW: number;
  /** The note's own width, which each strip keeps. */
  paperW: number;
  paperH: number;
  /** Travel, measured from the strip's right edge / vertical middle. */
  dx: number;
  dy: number;
};

export default function FeedShred({
  text,
  onDone,
}: {
  text: string;
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geom | null>(null);

  /* Measured before paint. Everything here scales with the viewport - the note
     is `min(250px, 38vw)` and the machine is scaled to fit - so a hard-coded
     offset would only be right at one width. */
  useLayoutEffect(() => {
    if (reduce) return;
    const feed = host.current?.parentElement;
    const machine = document.querySelector(".a2m__svg");
    if (!feed || !machine) return;

    const f = feed.getBoundingClientRect();
    const m = machine.getBoundingClientRect();

    /* The collision plane is the machine's VISIBLE near edge, which is not the
       same as its box: the SVG's viewBox is wider than the drawing, and the
       leftmost painted pixel (the corner of the keyboard base) sits about 5.5%
       of the width inside it. Cutting at the box edge left the strips
       disappearing into ~30px of empty paper before they ever reached the
       machine. Kept as a fraction so it holds at any scale. */
    const plane = m.left + m.width * 0.058;
    setGeom({
      clipW: Math.max(40, plane - f.left),
      paperW: f.width,
      paperH: f.height,
      dx: plane - f.right,
      dy: m.top + m.height * 0.46 - (f.top + f.height / 2),
    });
  }, [reduce]);

  /* The jolt lives on `.a2m`, which carries no transform of its own - unlike
     `.a2m__stage`, which is already driven by the section and would fight an
     animation. Applied by class from here rather than by prop so the machine
     component does not need to know the shredder exists. */
  useEffect(() => {
    if (reduce || !geom) return;
    const machine = document.querySelector(".a2m") as HTMLElement | null;

    /* The tumble has to pivot on the MACHINE's feet, but the class sits on
       `.a2m`, which is the whole scene box - its own 50% 100% is empty paper
       well below and beside the machine, and rotating about that would swing
       the machine sideways instead of tipping it.

       `.a2m` is the right element to carry it even so: `.a2m__stage` already
       has a transform the section drives, and the SVG and the CRT overlay are
       separate siblings, so rotating either one alone would tear the screen
       off the case. So the class goes on `.a2m` and the ORIGIN is measured
       onto it as a pair of custom properties. */
    const drawing = document.querySelector(".a2m__svg");
    if (machine && drawing) {
      const a = machine.getBoundingClientRect();
      const d = drawing.getBoundingClientRect();
      /* BOTH bottom corners of the base, because a tipping object pivots on
         the corner it is falling towards - never on its middle. Rotating about
         the centre drove the leading corner down through the table.

         The corners of the DRAWING, not of the SVG box: the viewBox is wider
         than the machine, so its own edges are empty paper. */
      const px = (x: number) => `${((x - a.left) / a.width) * 100}%`;
      machine.style.setProperty("--tip-l", px(d.left + d.width * 0.06));
      machine.style.setProperty("--tip-r", px(d.left + d.width * 0.96));
      machine.style.setProperty("--tip-y", `${((d.bottom - a.top) / a.height) * 100}%`);
    }

    let fired = false;
    const hit = window.setTimeout(() => {
      fired = true;
      machine?.classList.add("is-jolted");
      /* Deliberately NOT cleared on unmount. This component dies the instant
         the last strip lands - a hair after the hit - so tying the jolt to its
         lifetime cut a 560 ms rock down to about 80 ms of nothing. The jolt
         belongs to the machine now and takes itself off. */
      window.setTimeout(() => machine?.classList.remove("is-jolted"), TUMBLE_MS + 60);
    }, DURATION * IMPACT * 1000);
    return () => {
      window.clearTimeout(hit);
      // only undo a jolt that never got to happen
      if (!fired) machine?.classList.remove("is-jolted");
    };
  }, [reduce, geom]);

  /* Reduced motion gets no theatre - the note is simply taken. The timeout
     still fires so the corpus is fed either way. */
  useEffect(() => {
    if (!reduce) return;
    const t = window.setTimeout(onDone, 260);
    return () => window.clearTimeout(t);
  }, [reduce, onDone]);

  if (reduce) {
    return (
      <div className="shred shred--plain" aria-hidden>
        <Paper text={text} />
      </div>
    );
  }

  return (
    <div
      className="shred"
      ref={host}
      aria-hidden
      /* Width is the run-up to the machine, and overflow is hidden: a strip
         that crosses the near edge is cut off there. This is what makes them
         go INTO the machine instead of on top of it. */
      style={geom ? { width: geom.clipW, height: geom.paperH * 2.4 } : undefined}
    >
      {geom &&
        Array.from({ length: STRIPS }, (_, i) => {
          const from = (i / STRIPS) * 100;
          const to = 100 - ((i + 1) / STRIPS) * 100;
          // middle strips are pulled in first; the ends trail
          const centre = Math.abs(i - (STRIPS - 1) / 2) / ((STRIPS - 1) / 2);
          const lead = 0.05 * (1 - centre);

          return (
            <motion.div
              {...JS_ANIM}
              key={i}
              className="shred__strip"
              style={{
                width: geom.paperW,
                height: geom.paperH,
                // Set once - animating a clip-path repaints every frame.
                clipPath: `inset(0 ${to}% 0 ${from}%)`,
              }}
              initial={{ x: 0, y: 0, rotate: 0, rotateX: 0, scaleX: 1 }}
              animate={{
                /* cut and curl · recoil · thrown */
                x: [0, wobble(i, 1) * 4 - 7, geom.dx],
                y: [0, 15 + wobble(i, 2) * 9, geom.dy + wobble(i, 5) * 10],
                rotate: [0, wobble(i, 3) * 5, wobble(i, 3) * 9],
                rotateX: [0, 32 + wobble(i, 4) * 14, 4],
                // squeezed edge-on as they are drawn in
                scaleX: [1, 1, 0.42],
              }}
              transition={{
                duration: DURATION,
                times: [0, CUT, 1],
                // settle out of the cut, then accelerate into the machine
                ease: ["easeOut", "easeIn"],
                delay: lead,
              }}
              onAnimationComplete={i === STRIPS - 1 ? onDone : undefined}
            >
              <Paper text={text} />
            </motion.div>
          );
        })}
    </div>
  );
}

/* The static stand-in for the note. Deliberately NOT the real form: same box,
   same paper, same ruled lines, but plain text that can be clipped. */
function Paper({ text }: { text: string }) {
  return (
    <div className="shred__paper">
      <p className="shred__label">Teach it something</p>
      <p className="shred__text">{text}</p>
    </div>
  );
}
