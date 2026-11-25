import { useEffect, useRef, useState } from "react";
import { profile } from "../data/content";

/* ---------------------------------------------------------------------------
   Contact as the machine's LAST ACT: it prints you the details.

   The section used to be a headline and three text links - the only part of
   the site with no object in it, while every other section is a physical
   thing that IS the content. This continues the Apple ][ section's paper
   world: continuous tractor-feed stock rolls down out of the platen,
   sprocket holes punched down both margins, and the head types the lines in
   as you arrive. The sheet ends on a perforated tear-off edge.

   Deliberately NOT 3D. Flat vector in the same vocabulary as Apple2Front -
   three fixed light levels, ink hairlines, one soft cast shadow - so it is
   deterministic at every viewport and there is no model or lighting rig to
   look wrong. Same trick as the terminal on the machine's glass: the paper
   is drawn, the TEXT is real DOM, so the addresses stay selectable, linkable
   and readable by a screen reader.
   --------------------------------------------------------------------------- */

/* the paper family, matched to Apple2Front so the two sections are lit alike */
const PAPER = "#efe9d8";
const PAPER_DK = "#e2dac4";
const EDGE = "#cfc5a8";
const INK = "rgba(22, 21, 15, 0.38)";

type Line = { key: string; label: string; value: string; href: string; ext: boolean };

const LINES: Line[] = [
  { key: "email", label: "EMAIL", value: profile.email, href: `mailto:${profile.email}`, ext: false },
  { key: "github", label: "GITHUB", value: profile.github.replace(/^https?:\/\/(www\.)?/, ""), href: profile.github, ext: true },
  { key: "linkedin", label: "LINKEDIN", value: profile.linkedin.replace(/^https?:\/\/(www\.)?/, ""), href: profile.linkedin, ext: true },
];

/** Sprocket holes down one margin: the detail that makes the stock read as
 *  continuous-feed rather than a cut sheet. */
function Sprockets({ x, count, top, pitch }: { x: number; count: number; top: number; pitch: number }) {
  return (
    <g>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} cx={x} cy={top + i * pitch} r="5.5" fill="#d9d2bd" stroke={INK} strokeWidth="0.7" />
      ))}
    </g>
  );
}

export default function ContactSheet({
  active,
  feed,
  plate = false,
}: {
  active: boolean;
  /** 0..1: how far the stock has fed out of the platen. Undefined = at rest
   *  (fully fed). A transition clip can be pinned to any value of this, the
   *  same way Apple2Front takes `monitor` / `fall` / `blob` for its plates. */
  feed?: number;
  /** plate mode: no typing, nothing animated, chrome hidden by the caller -
   *  a clean frame to hand a generator (see docs/transition-kb-machine.md). */
  plate?: boolean;
}) {
  const reduce = useRef(false);
  const [printed, setPrinted] = useState(0); // how many lines the head has laid down
  const [tail, setTail] = useState(false); // the small print at the foot of the sheet

  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (plate) {
      setPrinted(LINES.length);
      setTail(true);
      return;
    }
    if (!active) {
      setPrinted(0);
      setTail(false);
      return;
    }
    if (reduce.current) {
      setPrinted(LINES.length);
      setTail(true);
      return;
    }
    /* One line at a time, with the pause between passes that a real head
       takes to return to the left margin. */
    const timers = LINES.map((_, i) => window.setTimeout(() => setPrinted(i + 1), 420 + i * 560));
    const t = window.setTimeout(() => setTail(true), 420 + LINES.length * 560 + 260);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(t);
    };
  }, [active, plate]);

  /* The stage is a 16:9 surface that COVERS the frame - the same geometry the
     keyboard and the machine use - so the sheet sits in exactly the same
     place at any window size. That is what lets a transition clip be pinned
     to it later: page and film share one coordinate space. */
  const fed = feed ?? 1;
  return (
    <div className="sheet">
      <div
        className="sheet__stage"
        style={fed < 1 ? { transform: `translateY(${(-(1 - fed) * 62).toFixed(2)}%)` } : undefined}
      >
      <div className="sheet__box">
        {/* ---- the paper ---- */}
        <svg className="sheet__paper" viewBox="0 0 620 460" aria-hidden preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="sheetFace" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={PAPER} />
              <stop offset="1" stopColor={PAPER_DK} />
            </linearGradient>
            <filter id="sheetShadow" x="-20%" y="-20%" width="140%" height="150%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>

          {/* cast shadow, same soft ellipse language as the machine */}
          <ellipse cx="310" cy="446" rx="250" ry="10" fill="rgba(22,21,15,0.26)" filter="url(#sheetShadow)" />

          {/* the sheet, torn along the bottom perforation */}
          <path
            d="M40 8 H580 V418
               l-13 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6
               l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6
               l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6
               l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6
               l-14 6 l-14 -6 l-14 6 l-14 -6 l-14 6 l-14 -6 Z"
            fill="url(#sheetFace)"
            stroke={INK}
            strokeWidth="1"
            strokeLinejoin="round"
          />

          {/* margin rules, then the punched holes inside them */}
          <line x1="72" y1="8" x2="72" y2="420" stroke={EDGE} strokeWidth="1" strokeDasharray="3 4" />
          <line x1="548" y1="8" x2="548" y2="420" stroke={EDGE} strokeWidth="1" strokeDasharray="3 4" />
          <Sprockets x={56} count={12} top={30} pitch={34} />
          <Sprockets x={564} count={12} top={30} pitch={34} />

          {/* the platen the stock is feeding out of, cropped by the frame top */}
          <rect x="20" y="-26" width="580" height="34" rx="9" fill="#cdc4ab" stroke={INK} strokeWidth="1" />
        </svg>

        {/* ---- what the head typed: real DOM, so it stays selectable ---- */}
        <div className="sheet__print">
          <p className="sheet__head" data-on={printed > 0}>
            &gt; PRINT CONTACT.TXT
          </p>
          <ul className="sheet__lines">
            {LINES.map((l, i) => (
              <li key={l.key} data-on={printed > i}>
                <a
                  href={l.href}
                  {...(l.ext ? { target: "_blank", rel: "noreferrer" } : {})}
                  data-cursor="hover"
                >
                  <span className="sheet__label">{l.label}</span>
                  <span className="sheet__dots" aria-hidden />
                  <span className="sheet__value">{l.value}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="sheet__tail" data-on={tail}>
            <span>&copy; 2026 {profile.name}</span>
            <span aria-hidden> · </span>
            <span>
              WebGL · no template · the skills keyboard is after{" "}
              <a href="https://github.com/Naresh-Khatri/3d-portfolio" target="_blank" rel="noreferrer" data-cursor="hover">
                Naresh Khatri&rsquo;s 3d-portfolio
              </a>{" "}
              (MIT), keycap mesh his{" "}
              · projector and screen from{" "}
              <a href="https://polyhaven.com" target="_blank" rel="noreferrer" data-cursor="hover">
                Poly Haven
              </a>{" "}
              (CC0)
            </span>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
