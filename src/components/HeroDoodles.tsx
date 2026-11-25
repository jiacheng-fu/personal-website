import { PHOTO } from "../lib/eruption";

/* ---------------------------------------------------------------------------
   Marker doodles around Brian's head, drawn in after the name rises.

   SVG in the photo's own pixels (same viewBox as the name), so every stroke
   stays on the same strand of hair at any window size. Static once drawn:
   the only cost is the few seconds of stroke animation.

   Brian's pick (2026-11-25), in marker yellow. Notes say only true things.
   --------------------------------------------------------------------------- */

/* each stroke: its path and when it starts drawing (s after arrival) */
const STROKES: { d: string; at: number; dur: number }[] = [
  /* the loop around his head, open at the bottom where the frame cuts it */
  { d: "M1052 880 C1102 800 1112 650 1030 590 C960 540 760 530 690 575 C610 625 590 720 600 800 C606 860 628 905 648 940", at: 1.6, dur: 0.8 },
  /* sparks either side of the crown */
  { d: "M612 560 l-26 -18", at: 2.4, dur: 0.1 },
  { d: "M600 592 l-32 -4", at: 2.46, dur: 0.1 },
  { d: "M628 534 l-13 -27", at: 2.52, dur: 0.1 },
  { d: "M1072 560 l26 -18", at: 2.58, dur: 0.1 },
  { d: "M1084 592 l32 -4", at: 2.64, dur: 0.1 },
  { d: "M1056 534 l13 -27", at: 2.7, dur: 0.1 },
  /* a light bulb over the crown, in the gap under the name */
  { d: "M826 500 C810 486 812 460 832 453 C852 446 874 456 876 474 C877 486 870 494 864 500", at: 2.8, dur: 0.4 },
  { d: "M829 507 L861 507 M832 514 L858 514 M837 521 L853 521", at: 3.2, dur: 0.2 },
  { d: "M845 441 l0 -14 M816 451 l-10 -8 M874 451 l10 -8", at: 3.4, dur: 0.15 },
  /* "single-threaded" -> the crown */
  { d: "M548 684 C590 694 630 662 652 612", at: 3.7, dur: 0.35 },
  { d: "M652 612 l-23 17 M652 612 l3 28", at: 4.05, dur: 0.12 },
  /* "big brained" -> his head */
  { d: "M1182 798 C1150 786 1118 800 1090 826", at: 4.45, dur: 0.3 },
  { d: "M1090 826 l26 -6 M1090 826 l8 -26", at: 4.75, dur: 0.12 },
  /* a wave under "(not Austin)", and an arrow out to the water */
  { d: "M98 620 q11 -9 22 0 t22 0 t22 0 t22 0 t22 0 t22 0 t22 0", at: 5.15, dur: 0.35 },
  { d: "M292 584 C330 586 372 568 410 545", at: 5.2, dur: 0.3 },
  { d: "M410 545 l-24 0.5 M410 545 l-11.5 21", at: 5.5, dur: 0.12 },
  /* "don't look down" -> down to the city */
  { d: "M1478 632 C1490 655 1486 680 1498 708", at: 5.55, dur: 0.25 },
  { d: "M1498 708 l2.6 -21.8 M1498 708 l-17.6 -13.2", at: 5.8, dur: 0.12 },
];

/* Lighthearted, and never a claim: dry dev jokes, plus the one instruction
   that is literally true (a click brings more). The first set ("ideas come
   from here", "that's me"...) read as cringe to Brian, 2026-11-25. */
const NOTES: { text: string; x: number; y: number; at: number; dur: number; rot: number; size?: number }[] = [
  { text: "single-threaded", x: 255, y: 700, at: 3.0, dur: 0.6, rot: -4 },
  { text: "big brained", x: 1196, y: 815, at: 4.0, dur: 0.5, rot: 3 },
  { text: "(not Austin)", x: 96, y: 600, at: 4.6, dur: 0.5, rot: -3, size: 44 },
  { text: "don't look down", x: 1262, y: 612, at: 5.0, dur: 0.6, rot: 3, size: 44 },
  { text: "(click for more)", x: 1132, y: 512, at: 5.9, dur: 0.6, rot: -5, size: 40 },
];

/* Which strokes and notes hover together (indices into STROKES / NOTES). */
const GROUPS: { strokes: number[]; notes: number[]; kind?: "bulb" }[] = [
  { strokes: [0], notes: [] }, // the loop
  { strokes: [1, 2, 3, 4, 5, 6], notes: [] }, // sparks
  { strokes: [7, 8, 9], notes: [], kind: "bulb" },
  { strokes: [10, 11], notes: [0] }, // single-threaded
  { strokes: [12, 13], notes: [1] }, // big brained
  { strokes: [14, 15, 16], notes: [2] }, // (not Austin)
  { strokes: [17, 18], notes: [3] }, // don't look down
  { strokes: [], notes: [4] }, // (click for more)
];

export default function HeroDoodles({ color }: { color: string }) {
  return (
    <svg
      className="hx__layer hx__doodles"
      viewBox={`0 0 ${PHOTO.w} ${PHOTO.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ "--doodle": color } as React.CSSProperties}
    >
      {GROUPS.map((g, gi) => (
        /* each doodle reacts to hover on its own - a small wiggle, and the
           bulb lights up; the fat transparent strokes are the hit area, since
           a 5px marker line is too thin to find with a mouse */
        <g key={gi} className={`hx__doodle ${g.kind === "bulb" ? "hx__doodle--bulb" : ""}`} data-cursor="hover">
          {g.strokes.map((i) => (
            <path key={`h${i}`} d={STROKES[i].d} className="hx__strokeHit" />
          ))}
          {g.strokes.map((i) => (
            <path
              key={i}
              d={STROKES[i].d}
              pathLength={1}
              className="hx__stroke"
              style={{ animationDelay: `${STROKES[i].at}s`, animationDuration: `${STROKES[i].dur}s` }}
            />
          ))}
          {g.notes.map((i) => {
            const n = NOTES[i];
            return (
              <text
                key={`n${i}`}
                x={n.x}
                y={n.y}
                className="hx__note"
                transform={`rotate(${n.rot} ${n.x} ${n.y})`}
                style={{ animationDelay: `${n.at}s`, animationDuration: `${n.dur}s`, fontSize: n.size }}
              >
                {n.text}
              </text>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
