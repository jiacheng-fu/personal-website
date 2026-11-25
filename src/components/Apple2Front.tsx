import { useEffect, useRef, useState, type ReactNode } from "react";
import { transitionAllowed, viewportFrame } from "../lib/transitions";

/* ---------------------------------------------------------------------------
   The Apple ][-style machine as a front-elevation illustration.

   Flat SVG faces in three fixed light levels, ink hairlines, a soft cast
   shadow - a painted illustration, viewed square-on from just above eye
   level so the monitor face is a plain rectangle and the live terminal on it
   reads like a real screen. The proportions are deliberately monitor-heavy:
   the glass is most of the machine, so the WHOLE computer fits the stage at
   a size where the terminal is comfortably readable. One view, no zoom.

   The terminal is a real DOM subtree placed on the drawn glass with a plain
   translate+scale; the stage scales the drawing and the terminal together.
   --------------------------------------------------------------------------- */

export const SCREEN_W = 600; // the .a2-crt div, in its own px
export const SCREEN_H = 400;

/* design canvas */
const DESIGN_W = 700;
const DESIGN_H = 600;
/* where the glass sits on the drawing, and its drawn size (3:2, like the div) */
const SCR = { x: 95, y: 62, w: 510, h: 340 };
/* the smallest glass worth keeping the side cards for (a 1366x768 laptop's is 390) */
const MIN_GLASS = 380;

/* palette: paper family, three light levels + ink hairlines */
const TOP = "#ece3cc";
const LIT = "#dcd2b6";
const LIT_DK = "#cbc0a2";
const SHD = "#b9ad90";
const BEZ = "#57503f";
const BEZ_IN = "#211f18";
const INK = "rgba(22, 21, 15, 0.38)";
const KEY_L = "#d3c9ad";
const KEY_D = "#7b7160";

/** A closed polygon with its corners rounded by radius r - so the monitor's
 *  top face can carry the same rounding as the body it sits on. */
function roundedPath(pts: [number, number][], r: number): string {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i + n - 1) % n];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    const v1 = [px - cx, py - cy], v2 = [nx - cx, ny - cy];
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = [cx + (v1[0] / l1) * rr, cy + (v1[1] / l1) * rr];
    const b = [cx + (v2[0] / l2) * rr, cy + (v2[1] / l2) * rr];
    d += (i === 0 ? `M${a[0].toFixed(1)},${a[1].toFixed(1)}` : `L${a[0].toFixed(1)},${a[1].toFixed(1)}`) + ` Q${cx},${cy} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
  }
  return d + "Z";
}

/* The rainbow badge of the era, deliberately without the fruit: the
   silhouette is the trademark, the six stripes are just the memory of it. */
const RAINBOW = ["#61bb46", "#fdb827", "#f5821f", "#e03a3e", "#963d97", "#009ddc"];

/* Frame-render modes for the transition clips (docs/transition-kb-machine.md):
   `monitor` scales the whole monitor assembly about the case top (0 = not
   there yet, 1 = grown), `screenOff` paints the glass black in the SVG in
   place of the live terminal. Normal rendering is monitor=1, screenOff=false. */
function MachineSVG({
  led,
  active,
  monitor = 1,
  screenOff = false,
  blob = 0,
}: {
  led: "off" | "busy" | "on";
  active: boolean;
  monitor?: number;
  screenOff?: boolean;
  /** 0..1: the T-1000 beat - a beige sphere resting on the case where the
   *  monitor will be, at this fraction of its full size. Drawn in the
   *  illustration's own style so it can pin the middle of the morph. */
  blob?: number;
}) {
  /* a compact keyboard band under the monitor; nearer rows a touch taller */
  const rows = [
    { y: 511, h: 9, w: 22, count: 15 },
    { y: 524, h: 10, w: 23, count: 15 },
    { y: 538, h: 11, w: 24, count: 14 },
    { y: 553, h: 12, w: 25, count: 13 },
  ];
  return (
    <svg className="a2m__svg" width={DESIGN_W} height={DESIGN_H} viewBox={`0 0 ${DESIGN_W} ${DESIGN_H}`} aria-hidden>
      <defs>
        <filter id="a2mShadow" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <linearGradient id="a2mBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TOP} />
          <stop offset="0.35" stopColor={LIT} />
          <stop offset="1" stopColor={LIT_DK} />
        </linearGradient>
        <linearGradient id="a2mDeck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6ddc6" />
          <stop offset="1" stopColor={LIT} />
        </linearGradient>
        <radialGradient id="a2mBlob" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor={TOP} />
          <stop offset="0.55" stopColor={LIT} />
          <stop offset="1" stopColor={SHD} />
        </radialGradient>
        <linearGradient id="a2mGlow" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#6cff8e" stopOpacity="0.16" />
          <stop offset="1" stopColor="#6cff8e" stopOpacity="0.03" />
        </linearGradient>
        <clipPath id="a2mBadge">
          <rect x="104" y="411" width="22" height="22" rx="5" />
        </clipPath>
      </defs>

      {/* cast shadow on the paper */}
      <ellipse cx="350" cy="588" rx="330" ry="16" fill="rgba(22,21,15,0.28)" filter="url(#a2mShadow)" />

      {/* ---- case ---- */}
      <rect x="40" y="565" width="620" height="20" rx="7" fill={LIT_DK} stroke={INK} />
      <polygon points="62,506 638,506 660,565 40,565" fill="url(#a2mDeck)" stroke={INK} strokeLinejoin="round" />
      <rect x="62" y="488" width="576" height="18" fill={TOP} stroke={INK} />
      <rect x="80" y="488" width="540" height="7" fill="rgba(22,21,15,0.18)" />

      {/* keycaps */}
      {rows.map((r, i) =>
        Array.from({ length: r.count }, (_, k) => {
          const pitch = r.w + 4;
          const x = 350 + (k - (r.count - 1) / 2) * pitch - r.w / 2;
          const dark = i % 2 === 1;
          return (
            <g key={`${i}-${k}`}>
              <rect x={x} y={r.y} width={r.w} height={r.h} rx="2.5" fill={dark ? KEY_D : KEY_L} stroke={INK} strokeWidth="0.7" />
              <rect x={x + 1} y={r.y + r.h - 2.5} width={r.w - 2} height="2.5" rx="1" fill="rgba(22,21,15,0.28)" />
            </g>
          );
        })
      )}

      {/* ---- the blob: a sphere resting on the case top, for the morph frames ---- */}
      {blob > 0 && (() => {
        const r = 230 * blob;
        const cy = 490 - r;
        return (
          <g>
            <ellipse cx="350" cy="492" rx={r * 0.95} ry={r * 0.12} fill="rgba(22,21,15,0.22)" filter="url(#a2mShadow)" />
            <circle cx="350" cy={cy} r={r} fill="url(#a2mBlob)" stroke={INK} />
            <ellipse cx={350 - r * 0.38} cy={cy - r * 0.42} rx={r * 0.22} ry={r * 0.13} fill="rgba(255,255,255,0.35)" transform={`rotate(-30 ${350 - r * 0.38} ${cy - r * 0.42})`} />
          </g>
        );
      })()}

      {/* ---- monitor (grows out of the case top at (350, 490)) ---- */}
      {monitor > 0 && (
        <g transform={`translate(350 490) scale(${monitor}) translate(-350 -490)`}>
          <rect x="290" y="470" width="120" height="20" rx="4" fill={SHD} stroke={INK} />
          {/* top face: same corner rounding as the body, and tucked a little
              under it so no square corner can peek out past the body's curve */}
          <path d={roundedPath([[84, 8], [616, 8], [640, 34], [60, 34]], 14)} fill={TOP} stroke={INK} strokeLinejoin="round" />
          <rect x="60" y="30" width="580" height="440" rx="16" fill="url(#a2mBody)" stroke={INK} />
          <rect x="85" y="52" width="530" height="388" rx="12" fill={BEZ} stroke="rgba(0,0,0,0.35)" />
          <rect x={SCR.x - 6} y={SCR.y - 6} width={SCR.w + 12} height={SCR.h + 12} rx="10" fill={BEZ_IN} />
          {screenOff && <rect x={SCR.x} y={SCR.y} width={SCR.w} height={SCR.h} rx="8" fill="#050705" />}
          {/* CRT glow belongs to the GLASS only. It used to cover the whole
              bezel (y 52..440), and since the gradient is strongest at its
              bottom edge the brightest green landed straight on the chin -
              so the badge and the FU ][ nameplate lit up green when the
              machine woke. In the clip that chin stays black/grey the whole
              way through, so the two did not match at the cut. Bounded to
              the inner bezel (ends at y=408, above the chin at y=411). */}
          {active && !screenOff && (
            <rect
              x={SCR.x - 6}
              y={SCR.y - 6}
              width={SCR.w + 12}
              height={SCR.h + 12}
              rx="10"
              fill="url(#a2mGlow)"
            />
          )}

          {/* chin: rainbow badge, name, LED wired to the engine */}
          <g clipPath="url(#a2mBadge)">
            {RAINBOW.map((c, i) => (
              <rect key={c} x="104" y={411 + i * (22 / 6)} width="22" height={22 / 6 + 0.4} fill={c} />
            ))}
          </g>
          <rect x="104" y="411" width="22" height="22" rx="5" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
          <text x="136" y="427" fill="rgba(236,227,204,0.78)" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2.5">
            FU ][
          </text>
          <circle className={`a2m__led a2m__led--${screenOff ? "off" : led}`} cx="594" cy="422" r="4.5" />
        </g>
      )}
    </svg>
  );
}

export default function Apple2Front({
  led,
  screen,
  active,
  monitor = 1,
  screenOff = false,
  fall,
  blob = 0,
}: {
  led: "off" | "busy" | "on";
  screen: ReactNode;
  active: boolean;
  /** frame-render modes, see MachineSVG */
  monitor?: number;
  screenOff?: boolean;
  /** 0..1: a rough stand-in for the illustrated board on its way down - 0 is
   *  tilted up at the keyboard section's angle, 1 is flat (= frame F) */
  fall?: number;
  /** 0..1: the sphere-on-the-case frame for the morph, see MachineSVG */
  blob?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState({ w: 900, h: 640, left: 0, top: 0, vw: 1440, vh: 900 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      /* the host's place within its panel: the panel IS the viewport while
         the section is on screen, so this is viewport-relative and stable */
      const p = el.closest(".panel")?.getBoundingClientRect();
      const fr = viewportFrame();
      setHost({ w: r.width, h: r.height, left: r.left - (p?.left ?? 0) - fr.left, top: r.top - (p?.top ?? 0) - fr.top, vw: fr.w, vh: fr.h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* the div onto the drawn glass: one uniform scale, no skew */
  const s = SCR.w / SCREEN_W; // == SCR.h / SCREEN_H
  const screenTransform = `matrix(${s}, 0, 0, ${s}, ${SCR.x}, ${SCR.y})`;

  /* Placement matches the transition clip, not the layout box. The clip's
     frames were rendered at 2560x1440 with the design canvas at REF; the
     clip is shown with object-fit: cover, so at any viewport the machine
     sits where the cover-scaled reference puts it - and the cut in and out
     of the clip is exact instead of a size pop. Below 720px there is no
     clip, so the machine simply fits its box (docs/transition-kb-machine.md). */
  const REF = { x: 778.3, y: 279.84, s: 1.433, w: 2560, h: 1440 };
  let fit: number, tx: number, ty: number;
  /* The note ("Teach it something") and the LLM card stand at this box's two
     edges (App.css .feed / .brain, gone at 720px and under). The clip
     placement always leaves them room (measured from 1.45:1 out to 21:9), but
     the plain fit below - no clip: 4:3, a half-width window, a tablet - drew
     the machine over both, its glass 30-170px under their paper. So the fit
     keeps the glass clear of them, unless that would shrink it below what a
     1366x768 laptop gets; then the cards go instead, as on a phone (the LLM
     switch is still item 5 on the glass). */
  let cards = true;
  if (transitionAllowed()) {
    const cs = Math.max(host.vh / REF.h, host.vw / REF.w);
    const offX = (host.vw - REF.w * cs) / 2;
    const offY = (host.vh - REF.h * cs) / 2;
    fit = REF.s * cs;
    tx = offX + REF.x * cs - host.left;
    ty = offY + REF.y * cs - host.top;
  } else {
    fit = Math.min(host.w / DESIGN_W, host.h / DESIGN_H);
    const vw = typeof window === "undefined" ? 0 : window.innerWidth;
    const side = vw > 720 ? Math.min(250, 0.38 * vw) + 16 : 0; // a card's width + a gap
    const room = host.w - 2 * side; // for the glass, centred between the cards
    if (side && fit * SCR.w > room) {
      if (room >= MIN_GLASS) fit = room / SCR.w;
      else cards = false;
    }
    tx = (host.w - DESIGN_W * fit) / 2;
    ty = (host.h - DESIGN_H * fit) / 2;
  }

  return (
    <div className="a2m" ref={hostRef} data-cards={cards ? undefined : "off"}>
      <div
        className="a2m__stage"
        style={{ transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${fit.toFixed(3)})` }}
      >
        <div
          style={
            fall !== undefined && fall < 1
              ? {
                  transform: `translate(350px, 540px) perspective(1800px) rotateX(${(35 * (1 - fall)).toFixed(1)}deg) rotate(${(-28 * (1 - fall)).toFixed(1)}deg) scale(${(1 + 0.5 * (1 - fall)).toFixed(3)}) translate(-350px, -540px)`,
                  transformOrigin: "0 0",
                }
              : undefined
          }
        >
          <MachineSVG led={led} active={active} monitor={monitor} screenOff={screenOff} blob={blob} />
        </div>
        {monitor >= 1 && !screenOff && (
          <div className="a2m__screen" style={{ transform: screenTransform }}>
            {screen}
          </div>
        )}
      </div>
    </div>
  );
}
