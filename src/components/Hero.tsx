import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { profile } from "../data/content";
import "./Hero.css";

/* three + r3f is ~215KB gzipped, more than the rest of the site together. It
   is split out and only fetched when the board is actually going to be shown,
   so the type, the rails and the annotation - the things that are legible in
   the first paint - do not wait on a renderer. */
const Keyboard3D = lazy(() => import("./Keyboard3D"));

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The hero object. WebGL when it can be had, the photograph when it cannot -
 *  the composition depends on SOMETHING crossing the letters, so the fallback
 *  is a real picture rather than empty space. */
function KeyboardBoard() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setOk(!reduce && webglAvailable());
  }, []);

  if (ok === null) return <div className="hx__boardHold" aria-hidden="true" />;
  if (!ok) return <HeroStill />;

  return (
    <Suspense fallback={<div className="hx__boardHold" aria-hidden="true" />}>
      <Keyboard3D daylight active instant />
    </Suspense>
  );
}

function HeroStill() {
  return (
    <img
      className="hx__art"
      src="/hero/hero-object.webp"
      width={1500}
      height={1628}
      alt=""
      draggable={false}
    />
  );
}

/* ---------------------------------------------------------------------------
   Hero — Swiss editorial / industrial spec sheet

   A composition, not a stack. Three things carry it:

     1  the name, set enormous and cropped by the viewport, used as architecture
     2  the object IN FRONT of it, occluding letters
     3  technical annotation - mono metadata, leader lines, ticks, a crosshair

   The scale contrast between 1 and 3 is the whole effect: a name at ~19vw
   against labels at 11px is what makes this read as a specification sheet
   rather than a heading with a subtitle underneath it.

   DEPTH
   Every layer sits on its own plane and moves a different amount with the
   pointer - ground barely at all, type a little, the object most, because it
   is nearest. That difference is the parallax; matching amounts would just be
   the whole page sliding. The object also takes a fractional rotation, which
   is what stops it reading as a sticker on glass.

   Written as two custom properties from inside a rAF: this fires on every
   mousemove and re-rendering the tree at that rate is how a hero starts
   dropping frames. Nothing here is React state, so moving the mouse renders
   nothing.
   --------------------------------------------------------------------------- */

/** Where each layer actually SITS, in px along Z.
 *
 *  Not offsets - depths. The scene is a real perspective space that tilts
 *  toward the pointer, and the differential motion falls out of the
 *  projection: things nearer the viewer sweep further across the frame than
 *  things behind them, and they do it with the slight shear that flat
 *  translation can never fake. Sliding each layer by a hand-picked number of
 *  pixels is what made the earlier version read as cut-out paper.
 *
 *  The object is furthest forward because it is the thing being held out. */
const Z = {
  grid: -190,
  type: -55,
  guide: 30,
  object: 120,
  note: 45,
};

/** How far the scene tilts, in degrees at the extremes. Small on purpose: past
 *  a few degrees the type starts to look like it is lying down. */
const TILT = 4.2;

/* The right-hand column. Real work, not pseudo-technical filler. */
const SPEC: [string, string][] = [
  ["FOCUS", "Compilers · Backends"],
  ["ALSO", "Application security"],
  ["STACK", "TypeScript · Python · C++"],
  ["SCHOOL", "Texas A&M · CS"],
];

export default function Hero({
  active,
  onWork,
}: {
  active: boolean;
  /** Jump to the work section. An editorial link, not a button. */
  onWork?: () => void;
}) {
  const stage = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty("--px", (e.clientX / window.innerWidth - 0.5).toFixed(4));
        el.style.setProperty("--py", (e.clientY / window.innerHeight - 0.5).toFixed(4));
      });
    };
    const rest = () => {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", rest);
    window.addEventListener("blur", rest);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", rest);
      window.removeEventListener("blur", rest);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const [first, last] = profile.name.split(" ");

  return (
    <section
      ref={stage}
      className={`hx ${active ? "is-in" : ""}`}
      style={
        {
          "--z-grid": `${Z.grid}px`,
          "--z-type-d": `${Z.type}px`,
          "--z-guide-d": `${Z.guide}px`,
          "--z-object-d": `${Z.object}px`,
          "--z-note-d": `${Z.note}px`,
          "--tilt": `${TILT}deg`,
        } as React.CSSProperties
      }
    >
      {/* Everything lives inside one 3D space. `.hx` owns the perspective and
          the clipping; the scene owns the rotation and preserve-3d - they
          cannot be the same element, because overflow:hidden flattens a
          preserve-3d subtree. */}
      <div className="hx__scene">
      {/* plane 0 — the grid, made just visible enough to feel */}
      <div className="hx__columns" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} />
        ))}
      </div>

      {/* ----------------------------- top rail ---------------------------- */}
      <div className="hx__rail hx__rail--top">
        <span className="hx__idx">01 /</span>
        <span className="hx__label">{profile.role}</span>
        <span className="hx__rule" aria-hidden="true" />
        <span className="hx__label hx__label--end">{profile.location}</span>
      </div>

      {/* plane 1 — the name. The only real heading on the page, so there is
          nothing here for a screen reader to hear twice. */}
      <h1 className="hx__display">
        <span className="hx__word">{first}</span>
        <span className="hx__word">{last}</span>
      </h1>

      {/* planes 2 + 3 — guides behind, object in front, both occluding type */}
      <div className="hx__objectWrap">
        <svg
          className="hx__guides"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect className="hx__box" x="4" y="10" width="92" height="86" fill="none" />
          <circle className="hx__node" cx="4" cy="10" r="1" />
          <circle className="hx__node" cx="96" cy="10" r="1" />
          <path className="hx__tick" d="M50 3v9M45.5 7.5h9" fill="none" />
        </svg>

        {/* The foreground subject: the REAL board, the same component the
            keyboard section runs, in daylight instead of a black studio. It
            is live here - keys press, legends light, the whole thing is
            hoverable - which is the point of merging the two sections. */}
        <div className="hx__board">
          <KeyboardBoard />
        </div>
      </div>

      {/* plane 4 — editorial columns */}
      <div className="hx__col hx__col--left">
        <span className="hx__idx">01/</span>
        <p className="hx__caption">
          I build things where correctness is checkable — compilers, backends,
          and the security boundaries in between.
        </p>
      </div>

      <div className="hx__col hx__col--right">
        <span className="hx__idx">02/</span>
        <dl className="hx__spec">
          {SPEC.map(([k, v]) => (
            <div className="hx__specRow" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* --------------------------- bottom rail --------------------------- */}
      <div className="hx__rail hx__rail--bottom">
        <span className="hx__status">
          <i className="hx__dot" aria-hidden="true" />
          Open to 2027 internships
        </span>
        <span className="hx__rule" aria-hidden="true" />
        <a
          className="hx__cta"
          href="#work"
          data-cursor="hover"
          onClick={(e) => {
            if (!onWork) return;
            e.preventDefault();
            onWork();
          }}
        >
          Selected work
          <svg className="hx__arrow" viewBox="0 0 46 8" aria-hidden="true">
            <path
              d="M0 4h42M38 1l4 3-4 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="square"
            />
          </svg>
        </a>
      </div>

        {/* measurement scale down the left edge */}
        <div className="hx__ticks" aria-hidden="true">
          {Array.from({ length: 17 }, (_, i) => (
            <span key={i} className={i % 4 === 0 ? "is-major" : ""} />
          ))}
        </div>
      </div>
    </section>
  );
}
