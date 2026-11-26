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

/* A tall window (a phone held upright) shows only the middle of the photo,
   x ~430..1240 (Hero.css: the frame is ~two screens wide), so every note
   above sat off one side or the other. There they move into the water and
   the city above his head, with their arrows redrawn to match; the loop, the
   sparks and the bulb stay where they are. Same indices as STROKES/NOTES. */
const TALL_STROKES: Record<number, string> = {
  /* "single-threaded" -> the crown */
  10: "M560 420 C585 470 610 520 640 560",
  11: "M640 560 l-3 -24 M640 560 l-22 -9",
  /* "big brained" -> his head */
  12: "M1010 492 C1000 515 985 535 958 552",
  13: "M958 552 l24 -1 M958 552 l11 -21",
  /* the wave under "(not Austin)", and its arrow out to the water */
  14: "M447 274 q11 -9 22 0 t22 0 t22 0 t22 0 t22 0 t22 0 t22 0",
  15: "M612 262 C640 268 660 280 676 300",
  16: "M676 300 l-4 -24 M676 300 l-22 -9",
  /* "don't look down" -> down */
  17: "M1190 318 C1198 345 1195 370 1205 398",
  18: "M1205 398 l4 -24 M1205 398 l-18 -16",
};
const TALL_NOTES: Record<number, { x: number; y: number; rot: number }> = {
  0: { x: 440, y: 400, rot: -4 }, // single-threaded
  1: { x: 980, y: 470, rot: 4 }, // big brained
  2: { x: 445, y: 255, rot: -3 }, // (not Austin)
  3: { x: 935, y: 300, rot: 3 }, // don't look down
  4: { x: 600, y: 150, rot: -4 }, // (click for more)
};

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

export default function HeroDoodles({ color, tall = false }: { color: string; tall?: boolean }) {
  const d = (i: number) => (tall && TALL_STROKES[i]) || STROKES[i].d;
  const note = (i: number) => ({ ...NOTES[i], ...(tall ? TALL_NOTES[i] : null) });
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
            <path key={`h${i}`} d={d(i)} className="hx__strokeHit" />
          ))}
          {g.strokes.map((i) => (
            <path
              key={i}
              d={d(i)}
              pathLength={1}
              className="hx__stroke"
              style={{ animationDelay: `${STROKES[i].at}s`, animationDuration: `${STROKES[i].dur}s` }}
            />
          ))}
          {g.notes.map((i) => {
            const n = note(i);
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
