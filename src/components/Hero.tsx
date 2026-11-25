import { useEffect, useRef, useState, type CSSProperties } from "react";
import { profile } from "../data/content";
import { PHOTO, createEruption, type Eruption, type Platform } from "../lib/eruption";
import HeroDoodles from "./HeroDoodles";
import "./Hero.css";

/* ---------------------------------------------------------------------------
   Hero — Brian, with ideas coming out of his head (2026-11-25)

   A photo of Brian, full bleed. His name sits BEHIND his head: the photo,
   then the name, then his head cut out of the same photo and laid back on
   top, so the head crops the middle letters like a magazine cover. Between
   the photo and the name, his tools erupt out of his hair as bare logos
   (lib/eruption.ts) - on arrival for a few seconds, and again for as long as
   the visitor keeps clicking.

   Picked from the prototypes in scripts/hero-demos.ts: photo 1, full colour,
   Inter Tight 200. The Swiss spec-sheet hero this replaced is parked in
   media/abandoned-hero/ (Hero-swiss.*.snapshot).

   Everything inside the frame is placed in the PHOTO's pixels (1672x941):
   the frame is the photo, cover-fitted and anchored to the bottom so the face
   is never what gets cropped, and an SVG with the photo's viewBox puts the
   name exactly where the head is at any window size.
   --------------------------------------------------------------------------- */

/** Where the name's baseline sits relative to the crown, in cap heights
 *  (positive = below it, so the head covers the letters). Brian, 2026-11-25:
 *  "a bit higher" (0.46 -> 0.28), then "it needs to clear my head" (-0.08),
 *  then "even higher so it's not as blocked with the doodles" (-0.55), then
 *  "even higher" again (-0.8: the name's top sits just under the top rail). */
const NAME_DROP = -0.8;
/** the name's width as a fraction of the photo ... */
const NAME_WIDTH = 0.86;
/** ... but never wider than this much of what is actually on screen, which
 *  is what binds on a portrait phone, where the photo is cropped to the head */
const NAME_FIT = 0.92;
/** Inter Tight's cap height, as a fraction of its size */
const CAP = 0.727;
/** the marker colour of the doodles (Brian: "doodle in yellow") */
const DOODLE = "#ffd93b";
/** the name has the stage to itself for this long before the eruption */
const ERUPT_AFTER_MS = 900;

type Layout = {
  fs: number;
  base: number;
  letters: { ch: string; x: number; x1: number; delay: number }[];
};

/* Where a logo can sit on each letter, as fractions of the letter's advance
   box: the full top bar of B R F, the single stems of I, the two stems of N
   and U, the apex of A. Inter Tight 200 is thin, so a stem top is a ledge
   for balancing on, not a shelf. */
const LEDGES: Record<string, [number, number][]> = {
  B: [[0.08, 0.72]],
  R: [[0.08, 0.74]],
  I: [[0.32, 0.68]],
  A: [[0.42, 0.58]],
  N: [[0.1, 0.24], [0.76, 0.9]],
  F: [[0.1, 0.92]],
  U: [[0.1, 0.24], [0.76, 0.9]],
};

export default function Hero({ active }: { active: boolean }) {
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const probe = useRef<SVGTextElement>(null);
  const spray = useRef<HTMLDivElement>(null);
  const engine = useRef<Eruption | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  /* logos that have cleared his hair come out in front of him (play mode) */
  const front = useRef<HTMLDivElement>(null);
  const ledges = useRef<Platform[]>([]);
  const name = profile.name.toUpperCase();

  /* Lay the name out from the font's real metrics: fit its width, then hang
     its baseline off the crown of the head. Measured once the face has
     loaded (a fallback face would measure wrong), and again on resize,
     because the on-screen fit changes with the window's shape. */
  useEffect(() => {
    let dead = false;
    const measure = () => {
      const p = probe.current;
      const f = frame.current;
      const sec = section.current;
      if (dead || !p || !f || !sec) return;
      p.setAttribute("font-size", "100");
      const w100 = p.getComputedTextLength();
      if (!w100) return;
      const s = f.clientWidth / PHOTO.w;
      const target = Math.min(PHOTO.w * NAME_WIDTH, (sec.clientWidth * NAME_FIT) / s);
      const fs = (100 * target) / w100;
      p.setAttribute("font-size", String(fs));
      const letters: Layout["letters"] = [];
      for (let i = 0; i < name.length; i++) {
        if (name[i] === " ") continue;
        const x = p.getStartPositionOfChar(i).x;
        const x1 = p.getEndPositionOfChar(i).x;
        /* nearest the head rises first, as if it is coming out of it */
        const d = Math.abs(x + fs * 0.3 - PHOTO.crownX) / PHOTO.w;
        letters.push({ ch: name[i], x, x1, delay: 0.2 + d * 1.1 });
      }
      const base = PHOTO.crownY + fs * CAP * NAME_DROP;
      ledges.current = letters.flatMap((l) =>
        (LEDGES[l.ch] ?? [[0.1, 0.9]]).map(([a, b]) => ({
          x0: l.x + (l.x1 - l.x) * a,
          x1: l.x + (l.x1 - l.x) * b,
          y: base - fs * CAP,
        })),
      );
      setLayout({ fs, base, letters });
    };
    document.fonts.load('200 100px "Inter Tight"').then(measure, measure);
    window.addEventListener("resize", measure);
    return () => {
      dead = true;
      window.removeEventListener("resize", measure);
    };
  }, [name]);

  /* The eruption engine lives as long as the hero does. Play mode: the
     logos come down onto the letters and his hair, and the cursor knocks
     them about (Brian's pick, 2026-11-25). */
  useEffect(() => {
    if (!spray.current || !front.current) return;
    const e = createEruption(spray.current, { front: front.current, platforms: () => ledges.current });
    engine.current = e;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, []);

  /* Arriving on the hero erupts; leaving stops throwing. Not under reduced
     motion, and not while a clean plate is being rendered for a clip. */
  const still = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.className.includes("is-framing-hero");
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!active || still()) {
      e.stop();
      return;
    }
    const t = window.setTimeout(() => e.arrive(), ERUPT_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  /* A click anywhere on the hero keeps it erupting - except on a link. */
  const onPointerDown = (ev: React.PointerEvent) => {
    if (!active || still()) return;
    if ((ev.target as HTMLElement).closest("a, button")) return;
    engine.current?.extend();
  };

  const cap = layout ? layout.fs * CAP : 0;

  return (
    <section ref={section} className={`hx ${active ? "is-in" : ""}`} onPointerDown={onPointerDown}>
      {/* the only real heading on the page; the drawn name is decoration */}
      <h1 className="hx__sr">{profile.name}</h1>

      <div className="hx__frame" ref={frame}>
        <img
          className="hx__layer hx__photo"
          src="/hero/background1.webp"
          width={PHOTO.w}
          height={PHOTO.h}
          alt=""
          draggable={false}
        />

        {/* the logos: behind the name, coming out from behind the head */}
        <div className="hx__layer hx__spray" ref={spray} aria-hidden="true" />

        <svg
          className="hx__layer hx__name"
          viewBox={`0 0 ${PHOTO.w} ${PHOTO.h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {/* the slot each letter rises out of: nothing below the baseline */}
            <clipPath id="hx-slot">
              <rect x={0} y={0} width={PHOTO.w} height={layout ? layout.base + layout.fs * 0.03 : PHOTO.h} />
            </clipPath>
          </defs>
          {/* measures the name; never seen */}
          <text ref={probe} className="hx__letter hx__probe" x={PHOTO.w / 2} y={PHOTO.h / 2} textAnchor="middle">
            {name}
          </text>
          {layout && (
            <g clipPath="url(#hx-slot)">
              {layout.letters.map((l, i) => (
                <text
                  key={`${i}${l.ch}`}
                  className="hx__letter"
                  x={l.x}
                  y={layout.base}
                  fontSize={layout.fs}
                  style={{ "--d": `${l.delay.toFixed(3)}s`, "--rise": `${(cap * 1.08).toFixed(1)}px` } as CSSProperties}
                >
                  {l.ch}
                </text>
              ))}
            </g>
          )}
        </svg>

        {/* his head, cut from the same photo, back on top of the name */}
        <img
          className="hx__layer hx__head"
          src="/hero/background1-head.webp"
          width={PHOTO.w}
          height={PHOTO.h}
          alt=""
          draggable={false}
        />

        {/* marker on the print, over everything */}
        <HeroDoodles color={DOODLE} />

        {/* logos that have cleared his hair come out in front */}
        <div className="hx__layer hx__front" ref={front} aria-hidden="true" />
      </div>

      {/* In the nav's own row, where its "Brian Fu" mark sits on every other
          section - the mark is hidden on the hero (App.css), because the
          name is already the size of the screen. Brian, 2026-11-25. */}
      <p className="hx__role">{profile.role}</p>

      <div className="hx__rail hx__rail--top">
        <span>{profile.location}</span>
      </div>
    </section>
  );
}
