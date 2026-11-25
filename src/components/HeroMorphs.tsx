/* ---------------------------------------------------------------------------
   What each letter of BRIAN FU turns into while the pointer is on it
   (Brian, 2026-11-25: "when you hover the I in BRIAN, it should turn into
   the Space Needle ... come up with ideas for the rest of the letters").

     B  a bug              ("bugs: also Brian", the notice board)
     R  an R that kicks    a coin off its foot
     I  the Space Needle   a lift rides up, the top level turns
     A  Mount Rainier      the mountain you can see from that deck
     N  a lightning bolt   the N's zigzag, lit
     F  a goal flag        the flag slides down the pole, level clear
     U  a magnet           the U's horseshoe, poles sparking

   Drawn in the name's own thin white line with the doodles' yellow for the
   accents, so a letter turning into a thing reads as the same hand. Each
   drawing lives in a box one cap-height tall (140 units, baseline y = 0,
   centred on x = 0) and is scaled onto its letter by Hero.tsx; nothing
   goes below the baseline, where the name is clipped.
   --------------------------------------------------------------------------- */

/* a literal: SVG presentation attributes do not take var() */
const Y = "#ffd93b";

function Bug() {
  return (
    <g className="hxm-bug">
      <path d="M -38 0 V -140" />
      <path d="M -38 -140 C 28 -140 28 -72 -38 -72" />
      <path d="M -38 -72 C 40 -72 40 0 -38 0" />
      {/* antennae */}
      <path d="M -38 -140 C -42 -158 -56 -166 -64 -162" />
      <path d="M -30 -139 C -22 -160 -8 -166 0 -162" />
      {/* legs, in two sets that step in turn */}
      <path className="hxm-leg hxm-leg--a" d="M 12 -112 L 32 -124" />
      <path className="hxm-leg hxm-leg--b" d="M 22 -72 L 44 -76" />
      <path className="hxm-leg hxm-leg--a" d="M 18 -30 L 38 -18" />
      {/* ladybird spots */}
      <g fill={Y} stroke="none">
        <circle cx={-14} cy={-112} r={7} />
        <circle cx={4} cy={-96} r={4.5} />
        <circle cx={-8} cy={-44} r={8} />
        <circle cx={12} cy={-24} r={5} />
      </g>
      <circle cx={-26} cy={-127} r={3.5} fill="#fff" stroke="none" />
    </g>
  );
}

function Kick() {
  return (
    <g className="hxm-kick">
      <path d="M -40 0 V -140 H 0 A 35 35 0 0 1 0 -70 H -40" />
      <path className="hxm-kick__leg" d="M -6 -70 L 38 0" />
      <path className="hxm-kick__whoosh" d="M 34 -52 Q 52 -64 60 -86 M 44 -38 Q 64 -46 74 -64" stroke={Y} />
      <g className="hxm-kick__coin">
        <ellipse cx={50} cy={-12} rx={9} ry={12} fill={Y} stroke="none" />
        <path d="M 50 -18 V -6" stroke="#b8860b" strokeWidth={2.5} />
      </g>
    </g>
  );
}

function Needle() {
  return (
    <g className="hxm-needle">
      {/* three legs, pinched at the waist, flaring to the saucer */}
      <path d="M -20 0 L -3 -66 L -9 -102 M 20 0 L 3 -66 L 9 -102 M 0 0 V -102" />
      {/* the saucer, its underside, the top cap and the spire */}
      <path d="M -32 -108 H 32 L 24 -120 H -24 Z" />
      <path d="M -26 -102 H 26" />
      <path d="M -12 -120 L -8 -130 H 8 L 12 -120" />
      <path d="M 0 -130 V -168" />
      {/* the observation level turning, as the real one's floor does */}
      <path className="hxm-needle__deck" d="M -22 -114 H 22" stroke={Y} />
      {/* a lift riding up the core */}
      <rect className="hxm-needle__lift" x={-3.5} y={-10} width={7} height={9} rx={1.5} fill={Y} stroke="none" />
      <circle className="hxm-needle__beacon" cx={0} cy={-170} r={3.5} fill={Y} stroke="none" />
    </g>
  );
}

function Mountain() {
  return (
    <g className="hxm-mountain">
      <path d="M -60 0 L 0 -140 L 60 0" />
      <path
        className="hxm-mountain__snow"
        d="M 0 -140 L -23 -86 L -13 -94 L -4 -84 L 6 -97 L 14 -88 L 23 -86 Z"
        fill="#fff"
        stroke="none"
      />
      <path
        className="hxm-mountain__cloud"
        d="M -78 -104 a 9 9 0 0 1 12 -9 a 13 13 0 0 1 24 1 a 8 8 0 0 1 4 15 H -74 a 7 7 0 0 1 -4 -7 z"
        stroke={Y}
      />
    </g>
  );
}

function Bolt() {
  return (
    <g className="hxm-bolt">
      <path
        className="hxm-bolt__shape"
        d="M 22 -150 L -32 -62 L 0 -62 L -18 0 L 38 -86 L 6 -86 L 30 -150 Z"
        fill={Y}
        strokeLinejoin="round"
      />
    </g>
  );
}

function Flag() {
  return (
    <g className="hxm-flag">
      <path d="M -36 -12 V -150" />
      <circle cx={-36} cy={-156} r={6} fill="#fff" stroke="none" />
      {/* the block the pole stands on */}
      <rect x={-48} y={-12} width={24} height={12} rx={1.5} />
      <g className="hxm-flag__flag">
        <path d="M -36 -146 L 32 -127 L -36 -108 Z" fill={Y} />
      </g>
    </g>
  );
}

function Magnet() {
  return (
    <g className="hxm-magnet">
      <path d="M -38 -140 V -58 A 38 38 0 0 0 38 -58 V -140" />
      {/* the poles */}
      <path className="hxm-magnet__pole" d="M -38 -140 V -114 M 38 -140 V -114" stroke={Y} strokeWidth={14} strokeLinecap="butt" />
      {/* the field between them, and sparks off the tips */}
      <path className="hxm-magnet__field" d="M -38 -148 Q 0 -192 38 -148" stroke={Y} />
      <path className="hxm-magnet__spark" d="M -58 -146 l 5 -8 l 4 6 l 5 -9 M 52 -146 l 5 -8 l 4 6 l 5 -9" stroke={Y} />
    </g>
  );
}

const MORPHS: Record<string, () => JSX.Element> = {
  B: Bug,
  R: Kick,
  I: Needle,
  A: Mountain,
  N: Bolt,
  F: Flag,
  U: Magnet,
};

/** The drawing a letter turns into, or null for a letter without one. */
export function morphFor(ch: string): (() => JSX.Element) | null {
  return MORPHS[ch] ?? null;
}
