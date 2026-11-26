import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Text3D, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three-stdlib";
import { LEGENDS } from "../data/legends";
import { CAP_NOTES } from "../data/capNotes";
import { studioMatcap } from "../data/matcap";
import { useKeycapGeometry, capGeometry, HEIGHT_RATIO } from "../data/keycapGeometry";
import { legendGeometry, legendExtrude, brandLogo } from "../data/legendGeometry";
import { setBoardStanding, registerBoardPlacement } from "../lib/boardState";
import { claimGesture } from "../lib/gesture";

/* ---------------------------------------------------------------------------
   Layout

   Four rows, ANSI-style stagger. Order is deliberate: the board is tilted
   toward the viewer, so the front rows sit closest and read first. The AWS /
   data-layer keys are on the front row, the daily drivers on the home row,
   and tooling recedes to the back.
   --------------------------------------------------------------------------- */

type CapAction = "github" | "email" | "linkedin" | "source" | "wave";
type Cap = {
  label: string;
  w: number;
  blank?: boolean;
  action?: CapAction;
  /** The physical key that presses this cap, as a `KeyboardEvent.code`.
   *  `code` is POSITIONAL, not the character produced, so a Dvorak or AZERTY
   *  typist presses the key in the same place on their board and gets the same
   *  cap here - which is the whole point of mirroring a QWERTY layout. */
  code?: string;
};

/* Proportioned like a 60% board. The left column GROWS as it descends -
   1u number row, 1.5u tab, 1.75u caps, 2.25u shift - and the right column
   carries the wide backspace / backslash / enter / shift caps. Everything
   between the two edges is 1u, the way it is on a real board.

   Rows are laid out left-aligned from x=0, so those differing left caps
   produce the genuine ANSI stagger for free: no row lines up with the one
   above it, which is exactly what makes a keyboard read as a keyboard.

   Rows are grouped by kind: languages, then the browser, then backend and
   cloud, then systems and silicon, then the function row. Everything here is
   on one of Brian's resumes or in this repo. */
const ROW_W = 12;

const row = (left: number, right: number, labels: string[], codes: string[]): Cap[] =>
  labels.map((label, i) => ({
    label,
    w: i === 0 ? left : i === labels.length - 1 ? right : 1,
    code: codes[i],
  }));

const ROWS: { caps: Cap[] }[] = [
  // number row: 1u through, wide "backspace" on the right
  {
    caps: row(1, 2,
      ["C++", "C#", "Java", "Python", "TypeScript", "JavaScript", "Swift", "Haskell", "Bash", "SQL", "HTML"],
      ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Backspace"]),
  },
  // tab row
  {
    caps: row(1.5, 1.5,
      ["CSS", "React", "Next.js", "Vite", "Node", "npm", "Deno", "Vercel", "Three.js", "WebGL", "Unity"],
      ["Tab", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"]),
  },
  // caps row, ending on the wide "enter"
  {
    caps: row(1.75, 2.25,
      ["FastAPI", "Poetry", "PyTorch", "OpenRouter", "PostgreSQL", "Supabase", "DynamoDB", "AWS Lambda", "API Gateway", "Docker"],
      ["CapsLock", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "Enter"]),
  },
  // shift row: the two widest caps on the board bracket it
  {
    caps: row(2.25, 2.75,
      ["VHDL", "Linux", "Vim", "Git", "GitHub Actions", "Playwright", "LLVM", "SystemRDL", "SystemVerilog"],
      ["ShiftLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "ShiftRight"]),
  },
  {
    caps: [
      { label: "GitHub", w: 1.5, action: "github" },
      { label: "Email", w: 1.5, action: "email" },
      /* no legend: an empty label prints nothing and shows no caption, but the
         cap still presses and still fires the wave */
      /* Space presses this cap (the wave easter egg) - except in development,
         where the transition scrubber (lib/debugPause.ts) owns the key. */
      { label: "", w: 6, blank: true, action: "wave", ...(import.meta.env.DEV ? {} : { code: "Space" }) },
      { label: "Source", w: 1.5, action: "source" },
      { label: "LinkedIn", w: 1.5, action: "linkedin" },
    ],
  },
];

const U = 1.0; // one key unit
const GAP = 0.16; // airy gaps: every cap reads as its own object
const TRAVEL = 0.22; // how far a key sinks when hovered
const BASE = U - GAP; // a 1u cap footprint
const CAP_H = HEIGHT_RATIO * BASE; // his cap proportions exactly

/* Uniform rows, no sculpt: the toy-like grid reads cleaner at product scale
   than a realistic Cherry profile ever did. Flat values rather than a
   per-row table, which silently returned undefined the moment a row was
   added. */
const ROW_LIFT = 0.3;
const ROW_TILT = 0;

/* The product pose from Brian's reference photo: standing on one corner,
   LONG SIDE VERTICAL with a slight lean, face toward the camera. Composed in
   world space - first tip the face to the camera, then roll around the view
   axis - so the angles mean what they say. */
const POSE_TIP = 1.42; // about X: face square-on to the camera, bottom edge nearest
const POSE_ROLL = -0.75; // about Z: halfway between standing on a corner and flat
const POSE_YAW = -0.16; // about Y: a hint of turn only - the face stays toward us
/* Applied LAST, so it acts on the finished pose in world space rather than in
   the board's own frame: a tilt about the horizontal screen axis. Negative
   pushes the upper half away from the viewer and swings the lower half
   toward them - the depth cue TIP/YAW could not give, because both of those
   act before the roll and end up turning the face instead of leaning it. */
const POSE_LEAN = -0.26;
const FINAL_Q = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), POSE_LEAN)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), POSE_YAW))
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), POSE_ROLL))
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), POSE_TIP));
const FLAT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.62);
/** Where the board rests before it stands up: inside the spotlight, fully in
 *  frame, tipped enough that you can read it as a keyboard. */
const FLAT_POS = new THREE.Vector3(0, -1.15, 1.0);
const POSE_POS = new THREE.Vector3(0, 0.55, 0);

/* ---------------------------------------------------------------------------
   Hero pose (daylight)

   The section pose stands the board almost upright inside a spotlight. The
   hero is a different picture entirely: an object being PRESENTED, tilted on
   a diagonal with its top face pitched toward the viewer so you read it as a
   keyboard at a glance, lit like a product shot on a warm off-white page.

   Less tip than the section (the face leans back rather than standing up),
   about twenty degrees of roll for the diagonal, and a touch of yaw so one
   long side edge shows and the thing has a thickness.
   --------------------------------------------------------------------------- */
const HERO_TIP = 1.12;
const HERO_ROLL = -0.35;
const HERO_YAW = -0.2;
const HERO_LEAN = -0.12;
const HERO_Q = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), HERO_LEAN)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HERO_YAW))
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), HERO_ROLL))
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), HERO_TIP));
const HERO_POS = new THREE.Vector3(0, 0, 0);

/** A pose driven from outside, in DEGREES, for the tuning panel. Composed in
 *  the same order as the constants above so the numbers mean the same thing. */
export type HeroPose = { tip: number; roll: number; yaw: number; lean: number };

const D2R = Math.PI / 180;
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0);
const _ay = new THREE.Vector3(0, 1, 0);
const _az = new THREE.Vector3(0, 0, 1);

/** Build a pose quaternion into `out`. Allocates nothing: this runs per frame
 *  while a slider is being dragged. */
function heroQuat(out: THREE.Quaternion, p: HeroPose): THREE.Quaternion {
  out.setFromAxisAngle(_ax, p.lean * D2R);
  out.multiply(_qa.setFromAxisAngle(_ay, p.yaw * D2R));
  out.multiply(_qb.setFromAxisAngle(_az, p.roll * D2R));
  out.multiply(_qa.setFromAxisAngle(_ax, p.tip * D2R));
  return out;
}

/** Scratch for the fit solver and the frame loop; never held across a frame. */
const _poseQ = new THREE.Quaternion();

/* Everything the whole board shares per frame; Key legends read the lamp so
   the unlit logo materials cannot glow before the spotlight is on. */
/* `ready` is false until the board has finished standing up. A stray mouse
   position over where a key WILL be was popping company names on screen
   mid-move, before the board had even landed. */
/** seconds the board lies flat after arriving, before it stands up */
const FLAT_HOLD = 1.2;
/* lamp starts at 1 now that there is no blackout to come up from. It used to
   start at 0 to stop the legends - which are unlit and multiplied by it -
   flashing at full brightness on the commit R3F renders before the first
   useFrame. With the room lit from the start there is nothing to flash. */
const STAGE = { lamp: 1, dark: false, ready: false };

/** Timestamp of the last spacebar hit; every key ripples off it. */
const WAVE = { at: 0 };

/* On a phone there is no hover, so a tap is how a key gets named - and on the
   GitHub, LinkedIn, Email and Source keys that same tap opened the link: you
   could not find out what a key was without being sent off the site (the
   projects page had the same fault; Brian, 2026-11-26). On touch a link key
   takes two taps: the first names it (and says to tap again), the second
   opens it. Any other key tapped in between disarms it. */
const ARMED = { label: null as string | null };
const touchOnly = () => typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches;
/** the keys whose tap leaves the page */
const LEAVES: Record<string, true> = { GitHub: true, LinkedIn: true, Email: true, Source: true };

/** Someone who asked for less motion gets none of the parallax. */
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// scratch, so the parallax allocates nothing per frame

type Placed = Cap & { x: number; z: number; row: number; capW: number };

function buildLayout() {
  // A row that does not add up to ROW_W just renders slightly ragged, which
  // is easy to miss and maddening to chase. Say so instead. Five rows, so
  // this is not worth gating behind a dev flag.
  ROWS.forEach((r, i) => {
    const w = r.caps.reduce((s, c) => s + c.w, 0);
    if (Math.abs(w - ROW_W) > 1e-9) {
      console.warn(`Keyboard row ${i} is ${w}u wide, expected ${ROW_W}u`);
    }
  });

  const placed: Placed[] = [];
  ROWS.forEach((row, r) => {
    let x = 0;
    for (const cap of row.caps) {
      placed.push({ ...cap, capW: cap.w * U - GAP, x: x + (cap.w * U) / 2, z: r * U, row: r });
      x += cap.w * U;
    }
  });

  // Centre the whole board on the origin rather than guessing at the offsets.
  const xs = placed.flatMap((p) => [p.x - p.capW / 2, p.x + p.capW / 2]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const midX = (lo + hi) / 2;
  const midZ = ((ROWS.length - 1) * U) / 2;
  for (const p of placed) {
    p.x -= midX;
    p.z -= midZ;
  }

  return { placed, width: hi - lo, depth: (ROWS.length - 1) * U + (U - GAP) };
}

/* ---------------------------------------------------------------------------
   Legends

   Drawn to a canvas in white on transparent, then tinted by the material
   colour so one texture serves both the resting and hovered states.
   --------------------------------------------------------------------------- */

/** Ink bounds of a 24x24 path, found by rasterising it once and scanning alpha.
 *  Simple Icons paths do not all fill their viewBox - some are inset, and the
 *  wordmarks (WebGL) are wide and short. Centring on the viewBox instead of on
 *  the actual ink leaves those marks small and off-centre on the cap. */
function inkBounds(path: string, box = 24) {
  const N = 64;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(N / box, N / box);
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(path));

  const d = ctx.getImageData(0, 0, N, N).data;
  let minX = N, minY = N, maxX = -1, maxY = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (d[(y * N + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const u = box / N; // back to path units
  return {
    x: minX * u,
    y: minY * u,
    w: (maxX - minX + 1) * u,
    h: (maxY - minY + 1) * u,
  };
}

/** The patch of cap a legend gets. Raster wordmarks (the Accellera marks)
 *  are wide and short, so they are given nearly the whole cap - at the 0.78
 *  used for logo marks they came out noticeably smaller than the vector
 *  wordmarks next to them, which get scaled up separately via MARK_SCALE.
 *  Shared, so the texture's aspect and the mesh it lands on cannot drift. */
function legendPlane(cap: Cap) {
  const capW = cap.w * U - GAP;
  return { w: capW * (LEGENDS[cap.label]?.img ? 0.94 : 0.78), d: (U - GAP) * 0.7 };
}

/* `?dpr=1` / `?dpr=1.75` / `?dpr=2` forces the render scale, so the board can
   be A/B'd on a real Retina display without a rebuild. Unset = the normal
   [1, 2] range. Debug aid; absent from normal URLs. */
/* Most pixels we are willing to shade per frame. 3.2 MP is ~1080p worth of
   work: comfortable for integrated graphics, and on a Retina panel it still
   lands above 1x so the board keeps its edge definition. */
/* QUALITY TIERS (the console way: one game, settings per machine). A
   machine reporting 4 or fewer cores, or 4 GB or less of memory, gets half
   the pixels, no shadow pass and no MSAA - the board still reads, it just
   stops costing what it costs a new laptop. ?tier=low forces it. */
const LOW_TIER =
  typeof navigator !== "undefined" &&
  (/[?&]tier=low/.test(typeof location === "undefined" ? "" : location.search) ||
    (navigator.hardwareConcurrency ?? 8) <= 4 ||
    ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4);
const PIXEL_BUDGET = LOW_TIER ? 1_600_000 : 3_200_000;

/** The highest device-pixel ratio that keeps a surface inside the budget,
 *  clamped to something sane. Recomputed on resize by the caller. */
function budgetedDpr(w: number, h: number) {
  const cap = Math.min(window.devicePixelRatio || 1, 2);
  if (w <= 0 || h <= 0) return cap;
  const fit = Math.sqrt(PIXEL_BUDGET / (w * h));
  return Math.max(1, Math.min(cap, +fit.toFixed(2)));
}

/* `?aniso=N` forces the anisotropic filter level on the keycap legend
   textures. Debug aid: the board is seen at a steep oblique angle, which is
   where this setting decides how sharp the logos read. */
/* `?legend=N` sets the legend texture's short side. The marks are SVG PATHS
   (24x24 viewBox) rasterised through Path2D, so the source art has no
   resolution limit - whatever this is set to is the real ceiling on how crisp
   a keycap logo can be. Debug knob for measuring where that ceiling bites. */
const LEGEND_PX_OVERRIDE: number | null = (() => {
  if (typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("legend");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 64 && n <= 2048 ? n : null;
})();

const ANISO_OVERRIDE: number | null = (() => {
  if (typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("aniso");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 16 ? n : null;
})();

const DPR_OVERRIDE: number | null = (() => {
  if (typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("dpr");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 && n <= 4 ? n : null;
})();

function legendTexture(cap: Cap): THREE.CanvasTexture | null {
  if (!cap.label) return null; // blank modifier caps carry nothing
  const S = LEGEND_PX_OVERRIDE ?? 256;
  // Canvas aspect matches the legend plane on this cap, so wide caps get
  // wide textures and nothing ever stretches.
  const plane = legendPlane(cap);
  const W = Math.max(1, Math.round(S * (plane.w / plane.d)));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const L = LEGENDS[cap.label];
  if (cap.label === "LinkedIn") {
    /* LinkedIn's mark is a rounded square with the letters knocked OUT of it.
       Drawing the letters alone - which is all a text legend can do - just
       reads as the word "in". Simple Icons carries no LinkedIn path
       (trademark), so it is punched here instead: fill the tile, then erase
       the type so the cap colour shows through. */
    const s = Math.min(W, S) * 0.66;
    const x0 = (W - s) / 2;
    const y0 = (S - s) / 2;
    ctx.beginPath();
    ctx.roundRect(x0, y0, s, s, s * 0.2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.font = `700 ${s * 0.6}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillText("in", W / 2, S / 2 + s * 0.03);
    ctx.globalCompositeOperation = "source-over";
  } else if (cap.blank) {
    // the spacebar motto: letterspaced type, shrunk to fit
    const spaced = cap.label.split("").join(" ");
    const face = (n: number) => `500 ${n}px "JetBrains Mono", ui-monospace, monospace`;
    let size = S * 0.16;
    ctx.font = face(size);
    const measured = ctx.measureText(spaced).width;
    if (measured > W * 0.88) {
      size *= (W * 0.88) / measured;
      ctx.font = face(size);
    }
    ctx.fillText(spaced, W / 2, S / 2);
  } else if (L?.path) {
    const b = inkBounds(L.path, L.box);
    if (!b) return null;
    const scale = Math.min((W * 0.56) / b.w, (S * 0.6) / b.h);
    ctx.save();
    ctx.translate(W / 2 - (b.x + b.w / 2) * scale, S / 2 - (b.y + b.h / 2) * scale);
    ctx.scale(scale, scale);
    ctx.fill(new Path2D(L.path));
    ctx.restore();
  } else if (L?.text) {
    let size = L.text.length > 3 ? S * 0.26 : S * 0.34;
    ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`;
    const measured = ctx.measureText(L.text).width;
    if (measured > W * 0.8) {
      size *= (W * 0.8) / measured;
      ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`;
    }
    ctx.fillText(L.text, W / 2, S / 2 + size * 0.04);
  } else if (!L?.img) {
    return null;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISO_OVERRIDE ?? 8;

  if (L?.img) {
    /* The official Accellera marks are raster only, pre-flattened to white
       ink on transparent. Drawn after the fact because decoding is async -
       the texture is already on the material by then, so it just needs to be
       told it changed. Wordmarks, so they take the cap's full width. */
    const im = new Image();
    im.onload = () => {
      const s = Math.min((W * 0.98) / im.width, (S * 0.8) / im.height);
      ctx.drawImage(
        im,
        W / 2 - (im.width * s) / 2,
        S / 2 - (im.height * s) / 2,
        im.width * s,
        im.height * s
      );
      tex.needsUpdate = true;
    };
    im.src = L.img;
  }

  return tex;
}

/* ---------------------------------------------------------------------------
   A single key
   --------------------------------------------------------------------------- */

/* Colourway. "white" is the post-black-section variant from the hero video
   plan: clean glossy white like the BRIAN FU street letters. */
const KB_VARIANT = "candy" as "dark" | "white" | "candy";

const DARKWAY = { cap: "#26262c", hover: "#3a3a44", mute: "#d5d1c8", case: "#17171c", plate: "#0d0d11", capRough: 0.58, capMetal: 0.14 };
const WHITEWAY = { cap: "#f1efe9", hover: "#ffffff", mute: "#7a766c", case: "#e6e3dc", plate: "#cfccc4", capRough: 0.3, capMetal: 0.05 };
/* candy: each cap wears its brand colour with a white legend; the case goes
   near-black soap-bar. Blanks and the spacebar stay charcoal fillers. */
/* Satin, not gloss: at roughness 0.38 the lamp threw a broad specular sheen
   across each top face and the near caps washed out to pastel. A rougher,
   non-metallic cap keeps the brand colour instead of the highlight. */
const CANDYWAY = { cap: "#2b2b31", hover: "#3a3a44", mute: "#e8e5de", case: "#1b1b20", plate: "#101014", capRough: 0.54, capMetal: 0 };
const WAY = KB_VARIANT === "white" ? WHITEWAY : KB_VARIANT === "candy" ? CANDYWAY : DARKWAY;

const CAP_COLOR = WAY.cap;
const CAP_HOVER = new THREE.Color(WAY.hover);
const CAP_REST = new THREE.Color(CAP_COLOR);
const LEGEND_MUTE = new THREE.Color(WAY.mute);

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** On white caps, near-white brand marks (Unity, Deno, Next.js, OpenJDK)
 *  would vanish; pull any too-light legend down to ink. */
function legibleHex(hex: string): string {
  if (KB_VARIANT !== "white") return hex;
  return luminance(hex) > 0.62 ? "#26262c" : hex;
}

/** The charcoal every cap falls back to. */
const NEUTRAL = CANDYWAY.cap;

/* legends.ts now publishes brand colours untouched, so this only covers what
   it cannot: text legends (whose hex is the ink colour, not a brand colour),
   Java, and the keys with no brand at all. */
const CAP_TINT: Record<string, string> = {
  // simple-icons publishes OpenJDK as black; the Java logo's own blue keeps
  // the languages row from turning into a wall of charcoal.
  LinkedIn: "#0A66C2",
  // no brand of its own: chosen, not sourced
  SQL: "#3E5C76",
  // the function keys stay charcoal, like the modifiers on a real board
  Email: NEUTRAL,
  Source: NEUTRAL,
};

/* The band a white legend can actually sit on. */
const CAP_LUM_MIN = 0.05;
const CAP_LUM_MAX = 0.55;

const hsl = { h: 0, s: 0, l: 0 };

/** Pull an out-of-band brand into the band WITHOUT throwing its hue away, so
 *  a yellow brand stays yellow instead of becoming yet another black key.
 *  Only genuinely colourless brands fall through to charcoal. */
function fitToCap(hex: string): string {
  const c = new THREE.Color(hex);
  c.getHSL(hsl, THREE.SRGBColorSpace);
  // Vercel, Next.js, Deno, Three.js, Unity and GitHub are not "missing" a
  // colour - their marks really are black or white. Nothing to preserve.
  if (hsl.s < 0.14) return NEUTRAL;
  c.setHSL(
    hsl.h,
    Math.max(hsl.s, 0.42),
    THREE.MathUtils.clamp(hsl.l, 0.2, 0.38),
    THREE.SRGBColorSpace
  );
  return `#${c.getHexString()}`;
}

/** The cap's colour: the brand's own where it can carry a white legend, a
 *  deepened version of it where it cannot, charcoal only when there is no
 *  colour to keep. */
function capColor(label: string, blank?: boolean): string {
  if (blank) return NEUTRAL;
  const hex = CAP_TINT[label] ?? LEGENDS[label]?.hex;
  if (!hex) return NEUTRAL;
  const lum = luminance(hex);
  return lum < CAP_LUM_MIN || lum > CAP_LUM_MAX ? fitToCap(hex) : hex;
}

/** Wordmarks normalise to their longest side, so a wide, short mark like
 *  WebGL's ends up a thin strip on the cap. These get scaled back up. */
const MARK_SCALE: Record<string, number> = {
  WebGL: 1.85,
  LLVM: 1.2,
  OpenRouter: 1.1,
};

type KeyProps = {
  cap: Placed;
  geometry: THREE.BufferGeometry;
  texture: THREE.CanvasTexture | null;
  active: boolean;
  onEnter: (label: string) => void;
  onLeave: (label: string) => void;
  onAction: (a: CapAction) => void;
  /** Ripple offset in seconds; the wave easter egg staggers by column. */
  waveAt: number;
};

const Key = memo(function Key({ cap, geometry, texture, active, onEnter, onLeave, onAction, waveAt }: KeyProps) {
  const group = useRef<THREE.Group>(null);
  const capMat = useRef<THREE.MeshStandardMaterial>(null);
  const legendMat = useRef<THREE.MeshBasicMaterial>(null);
  const press = useRef(0);

  const baseY = ROW_LIFT;

  // Resting legends sit slightly back from full brightness so the board reads
  // as one object; hovering brings the mark all the way up.
  const [rest, brand, capRest, capHover] = useMemo(() => {
    if (KB_VARIANT === "candy") {
      const base = new THREE.Color(capColor(cap.label, cap.blank));
      const hover = base.clone().offsetHSL(0, 0.02, 0.09);
      // ONE ink colour for the whole board. Switching the mark between white
      // and black to chase contrast made the board look like two keyboards
      // shuffled together; capColor guarantees every cap can hold white, so
      // the ink never has to move.
      const mark = new THREE.Color("#ffffff");
      return [mark.clone().multiplyScalar(cap.blank ? 0.6 : 0.88), mark, base, hover];
    }
    const b = new THREE.Color(legibleHex(cap.blank ? (KB_VARIANT === "dark" ? "#9a958a" : "#8a8578") : LEGENDS[cap.label]?.hex ?? "#d5d1c8"));
    return [b.clone().lerp(LEGEND_MUTE, 0.28), b, CAP_REST, CAP_HOVER];
  }, [cap.label, cap.blank]);

  useFrame((state, dt) => {
    // Frame-rate independent easing, clamped so a long frame cannot overshoot.
    const step = 1 - Math.pow(0.0001, Math.min(dt, 0.1));
    press.current += ((active ? 1 : 0) - press.current) * step;
    const p = press.current;

    // hover press + the ripple, so a key can ride both at once
    let sink = p * TRAVEL;
    if (WAVE.at > 0) {
      const since = performance.now() / 1000 - WAVE.at - waveAt;
      if (since > 0 && since < 0.5) {
        // deep enough to read as a wave rolling across the board
        sink += Math.sin((since / 0.5) * Math.PI) * TRAVEL * 2.4;
      }
    }
    if (group.current) {
      const y = baseY - sink;
      /* shadows are drawn only on frames where something moved (see the
         Canvas's onCreated): a key travelling is one of those */
      if (Math.abs(group.current.position.y - y) > 1e-5) state.gl.shadowMap.needsUpdate = true;
      group.current.position.y = y;
    }
    if (legendMat.current) {
      legendMat.current.color.lerpColors(rest, brand, p);
      legendMat.current.color.multiplyScalar(STAGE.lamp);
    }
    if (capMat.current) capMat.current.color.lerpColors(capRest, capHover, p);
  });

  const enter = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (ARMED.label !== cap.label) ARMED.label = null;
      onEnter(cap.label);
    },
    [cap.label, onEnter]
  );
  const leave = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onLeave(cap.label);
    },
    [cap.label, onLeave]
  );
  const click = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!cap.action) return;
      e.stopPropagation();
      if (touchOnly() && LEAVES[cap.label]) {
        if (ARMED.label !== cap.label) {
          ARMED.label = cap.label; // first tap: named, not opened
          return;
        }
        ARMED.label = null;
      }
      onAction(cap.action);
    },
    [cap.action, cap.label, onAction]
  );

  // Sit the legend just clear of the un-dished rim. Floating it above the whole
  // top face rather than tucking it into the scoop means it can never be
  // swallowed by the cap, and 4 thousandths of a unit is invisible at this size.
  const legendY = CAP_H / 2 + 0.004;
  const vector = cap.blank ? null : legendGeometry(cap.label);
  // marks sit at a consistent share of the 1u cap regardless of cap width
  const markSize = BASE * 0.46 * (MARK_SCALE[cap.label] ?? 1);
  const { w: legendW, d: legendD } = legendPlane(cap);

  return (
    <group ref={group} position={[cap.x, baseY, cap.z]} rotation={[ROW_TILT, 0, 0]}>
      <mesh
        geometry={geometry}
        scale={BASE}
        castShadow
        onPointerOver={enter}
        onPointerOut={leave}
        /* Touch has no hover, so a tap has to stand in for one. */
        onPointerDown={enter}
        onClick={cap.action ? click : undefined}
      >
        <meshStandardMaterial ref={capMat} color={CAP_COLOR} roughness={WAY.capRough} metalness={WAY.capMetal} />
      </mesh>

      {/* Vector mark: real geometry, sharp at any zoom (his approach). */}
      {vector && (
        <mesh
          geometry={vector}
          position={[0, legendY, 0]}
          scale={markSize}
          renderOrder={2}
        >
          <meshBasicMaterial
            ref={legendMat}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Wordmarks and text legends keep the canvas path. */}
      {!vector && texture && (
        <mesh position={[0, legendY, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[legendW, legendD]} />
          <meshBasicMaterial
            ref={legendMat}
            map={texture}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
});

/* ---------------------------------------------------------------------------
   Hover card

   The name used to be a DOM tooltip pinned to the cursor, which meant it lived
   on the website layer rather than in the room. This is the same information
   as an object ON the set: the brand's own mark, extruded and standing on the
   floor to the left of and below the board, with the name cut in bold behind
   it. It carries its own light, because the studio spot is aimed at the board
   and this sits well outside that cone.

   Swaps are snappy on purpose - punch in, settle - so hovering across the
   board feels like moving a selection through a menu.
   --------------------------------------------------------------------------- */

const CARD_LOGO_SIZE = 1.35; // icon + name stack ~ the height of a lockup
const CARD_TEXT_SIZE = 0.82;
const CARD_WORDMARK_W = 3.7; // wordmarks are sized by width, not height
/* The other side of each box. Every mark is fitted into ITS box - the largest
   scale at which it clears both limits - so a 5:1 lockup, a 2:1 lockup and a
   square icon all land at roughly the same visual mass instead of the widest
   one turning into a strip and the squarest one towering. */
const CARD_WORDMARK_H = 1.9;
const CARD_LOGO_W = 2.2;
/** Deep slab, like the freestanding letters in the hero plan - not signage. */
const CARD_TEXT_DEPTH = 0.3;
/** The floor plane. The letters STAND on it rather than hovering over it. */
const CARD_FLOOR_Y = -5.4;
/** Below this a fill cannot be read against the studio floor. */
const CARD_MIN_LUM = 0.07;
/** Extra yaw ON TOP of facing the camera. Zero: the card is billboarded every
 *  frame (see HoverCard) so the lockup reads flat-on from wherever the camera
 *  has been solved to, instead of being turned off toward the right by a fixed
 *  angle that only happened to look square at one viewport. */
const CARD_YAW = 0;

/** The card sits in an unlit corner, so a brand that is black - Vercel,
 *  Next.js, Deno, Three.js, GitHub - would be an invisible silhouette against
 *  the floor. Those get lifted; everything else keeps its own colour. */
function cardInk(hex: string): string {
  return luminance(hex) < 0.06 ? "#eceff5" : hex;
}

type CardTex = { tex: THREE.Texture; aspect: number };
const cardTexCache = new Map<string, CardTex>();

/** Decoding is async, so the aspect is not known on the frame that asks for
 *  it - the plane would be built square and the wordmark squashed. The aspect
 *  is cached alongside the texture and `onLoad` nudges a re-render once it is
 *  actually known. */
function cardTexture(label: string, onLoad?: () => void): CardTex | null {
  const img = LEGENDS[label]?.img;
  if (!img) return null;
  let entry = cardTexCache.get(label);
  if (!entry) {
    entry = { tex: new THREE.Texture(), aspect: 1 };
    cardTexCache.set(label, entry);
    new THREE.TextureLoader().load(img, (loaded) => {
      entry!.tex.image = loaded.image;
      entry!.tex.colorSpace = THREE.SRGBColorSpace;
      entry!.tex.anisotropy = ANISO_OVERRIDE ?? 8;
      entry!.tex.needsUpdate = true;
      entry!.aspect = loaded.image.width / loaded.image.height;
      onLoad?.();
    });
  }
  return entry;
}

function HoverCard({ label, offset }: { label: string | null; offset: { x: number; z: number } }) {
  const group = useRef<THREE.Group>(null);
  const textRef = useRef<THREE.Group>(null);
  const open = useRef(0);
  const punch = useRef(0);
  // Keep the last real label mounted so leaving a key does not tear the
  // geometry down and rebuild it on the next hover.
  const [shown, setShown] = useState<string | null>(null);

  /* Bail on null rather than clearing prevLabel: moving from one key to the
     next sends a null in between as the first key's pointerout lands before
     the second's pointerover. Holding the last label across that gap is what
     lets a genuine swap be told apart from a first appearance - and only a
     swap gets the settle. */
  const prevLabel = useRef<string | null>(null);
  useEffect(() => {
    if (!label) return;
    if (prevLabel.current && prevLabel.current !== label) punch.current = 1;
    prevLabel.current = label;
    setShown(label);
  }, [label]);

  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);
  /* Preference order: the brand's real full-colour logo, then the monochrome
     glyph the keycap uses, then the raster mask. The colour logo arrives a
     frame or two late (it is fetched on hover), so the glyph shows meanwhile
     and is simply replaced - no flash of empty. */
  /* The brand's own lockup wins: mark plus name set in THEIR typeface, so the
     name is never in a generic 3D font. 23 of the 33 publish one. The rest
     fall back to the icon with the name set in Text3D underneath. */
  const lockup = shown ? LEGENDS[shown]?.logoWordmark : undefined;
  const logo = shown ? brandLogo(lockup ?? LEGENDS[shown]?.logo, rerender) : null;
  const solid = shown && !logo ? legendExtrude(shown) : null;
  const card = shown && !logo && !solid ? cardTexture(shown, rerender) : null;
  const brand = useMemo(
    () => new THREE.Color(cardInk(shown ? LEGENDS[shown]?.hex ?? "#ffffff" : "#ffffff")),
    [shown]
  );
  /* Judged PER FILL, not per mark. Most lockups set the company name in a
     near-black or very dark ink - Docker's "docker" is a deep navy - which is
     unreadable on this floor even though the mark beside it is bright. Any
     fill too dark to read goes white; everything above the line keeps the
     brand's own colour, so Docker's blue whale and Java's outline survive
     while their names turn white. Threshold is low enough that only genuinely
     unreadable fills are touched. */
  const logoColors = useMemo(() => {
    if (!logo) return null;
    return logo.map((p) => {
      const c = new THREE.Color(p.color);
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      return lum < CARD_MIN_LUM ? new THREE.Color("#f4f6fa") : c;
    });
  }, [logo]);

  /* A lockup already carries the name, so no caption goes under it. Decided
     from `lockup` rather than from whether it has finished loading, or the
     card would show icon-plus-caption for a frame and then swap. */
  const isWordmark = !!lockup || !!(shown && LEGENDS[shown]?.wordmark);
  // Wordmarks are wide and short, so they are sized by WIDTH; a logo mark is
  // roughly square and is sized by height. Sizing both the same way either
  // shrinks the wordmark to a strip or runs it off the side of the frame.
  const cardW = card
    ? Math.min(CARD_LOGO_SIZE * card.aspect, CARD_WORDMARK_W)
    : CARD_LOGO_SIZE;

  /* Vector marks arrive normalised so their LONGEST side is 1, which is what
     made the cards uneven: one scalar per kind put a 5:1 lockup 0.7 tall next
     to a square icon 1.7 tall. Measure the real box and fit it instead. */
  const logoBox = useMemo(() => {
    const geos = logo ? logo.map((p) => p.geo) : solid ? [solid] : [];
    if (!geos.length) return null;
    const box = new THREE.Box3();
    for (const g of geos) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
    }
    return { w: Math.max(box.max.x - box.min.x, 1e-6), h: Math.max(box.max.y - box.min.y, 1e-6) };
  }, [logo, solid]);
  const logoScale = logoBox
    ? isWordmark
      ? Math.min(CARD_WORDMARK_W / logoBox.w, CARD_WORDMARK_H / logoBox.h)
      : Math.min(CARD_LOGO_W / logoBox.w, CARD_LOGO_SIZE / logoBox.h)
    : isWordmark
      ? CARD_WORDMARK_W
      : CARD_LOGO_SIZE;

  /* Everything is stacked UP from the floor, so the group's origin can sit on
     the ground plane: caption first, mark above it. A wordmark has no caption
     under it, so it stands on the ground itself. */
  const solidH = logoBox ? logoBox.h * logoScale : 0;
  const logoH = card ? cardW / card.aspect : solidH;
  const capBase = isWordmark ? 0 : CARD_TEXT_SIZE + 0.42;
  const logoY = capBase + logoH / 2;

  /* Sit the word on the floor and centre it across, measured from the built
     geometry. Text3D lays glyphs out from a baseline at y=0 with descenders
     hanging BELOW it, so "Playwright" and "Python" dipped through the ground.
     Reading the box here rather than assuming a nominal descender depth also
     means it runs after the font has actually resolved. */
  useEffect(() => {
    const g = textRef.current;
    const mesh = g?.children[0] as THREE.Mesh | undefined;
    if (!g || !mesh?.geometry) return;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    if (!b) return;
    g.position.y = -b.min.y;
    g.position.x = -(b.min.x + b.max.x) / 2;
  }, [shown, isWordmark]);

  /* The card simply APPEARS - full size, in place. `open` is a visibility
     latch only and deliberately drives neither scale nor position; ramping
     those made it grow up out of the floor on first hover. The small ramp is
     still there so the one-frame gap between leaving one key and entering the
     next does not flicker it off and on.
     `punch` is the only motion left, and it fires only when SWAPPING between
     keys - a small settle that reads as the selection changing. */
  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    open.current += ((label ? 1 : 0) - open.current) * (1 - Math.exp(-dt * 16));
    punch.current += (0 - punch.current) * (1 - Math.exp(-dt * 7));

    const p = punch.current;
    // matcap is unlit, so it would happily shine through the blackout
    g.visible = open.current > 0.02 && !STAGE.dark && STAGE.ready;
    g.scale.setScalar(1 + p * 0.12);
    g.position.set(offset.x, CARD_FLOOR_Y, offset.z);

    /* Billboard, yaw only. The card stands off to the LEFT of the board while
       the camera sits near the world axis, so a card with no yaw is seen from
       its side and the lockup skews away to the right. Aiming it at the camera
       each frame keeps it square to the lens.

       Only Y is solved: rolling it to face the camera exactly would tip the
       letters off the floor they are standing on, and the whole conceit is
       that these are physical objects in the studio, not a HUD. The camera is
       barely off the horizontal, so yaw alone reads as flat-on. */
    const cam = state.camera.position;
    const faceYaw = Math.atan2(cam.x - g.position.x, cam.z - g.position.z);
    g.rotation.y = faceYaw + CARD_YAW + p * 0.42;
    g.rotation.x = p * -0.1;
    if (open.current > 0.001) state.gl.shadowMap.needsUpdate = true;
  });

  if (!shown) return null;

  return (
    <group ref={group} visible={false}>
      {/* its own key light: the studio spot never reaches out here */}

      {/* the real logo: one solid per fill, each in its own colour */}
      {logo && (
        <group scale={logoScale} position={[0, logoY, 0]}>
          {logo.map((part, i) => (
            <mesh key={i} geometry={part.geo} castShadow>
              <meshMatcapMaterial matcap={studioMatcap()} color={logoColors![i]} />
            </mesh>
          ))}
        </group>
      )}

      {solid && (
        <mesh geometry={solid} scale={logoScale} position={[0, logoY, 0]} castShadow>
          <meshMatcapMaterial matcap={studioMatcap()} color={brand} />
        </mesh>
      )}

      {/* no vector for this one: the official mark, flat but still in-world */}
      {card && (
        <mesh position={[0, logoY, 0]}>
          <planeGeometry args={[cardW, logoH]} />
          <meshBasicMaterial map={card.tex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}

      {/* A wordmark already says the name; setting it again underneath just
          prints the word twice. */}
      {!isWordmark && (
        /* Placed from its own bounding box rather than by drei's <Center>:
           its baseline sits at y=0, so descenders on y, g, p and j sank
           through the floor, and Center's vertical alignment measures the box
           the other way round and buried the whole word. Reading min.y and
           lifting by it rests the LOWEST point on the ground, which is how
           cast letters actually sit. */
        <group ref={textRef}>
          <Text3D
            font="/fonts/helvetiker_bold.typeface.json"
            size={CARD_TEXT_SIZE}
            height={CARD_TEXT_DEPTH}
            bevelEnabled
            bevelThickness={0.022}
            bevelSize={0.016}
            bevelSegments={3}
            curveSegments={6}
            castShadow
          >
            {shown}
            <meshMatcapMaterial matcap={studioMatcap()} color="#f2f1ee" />
          </Text3D>
        </group>
      )}
    </group>
  );
}

/* ---------------------------------------------------------------------------
   Camera

   The board is a fixed-size object, so the camera is solved for it rather than
   hard-coded: at a narrow viewport the old fixed position clipped both ends.
   --------------------------------------------------------------------------- */

function FitCamera({
  width,
  depth,
  daylight = false,
  pose,
  fill,
}: {
  width: number;
  depth: number;
  daylight?: boolean;
  /** overrides HERO_Q while the tuning panel is driving */
  pose?: HeroPose;
  /** overrides the daylight FILL while the tuning panel is driving */
  fill?: number;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  useEffect(() => {
    // Solving the framing from the board's centre distance under-counts badly:
    // seen from three-quarters, the front corners sit much closer to the
    // camera than the centre does and blow past the edge of frame. So project
    // the real bounding corners and pull back until the worst one fits.
    // Match the case, which is built at width+1.15 / depth+1.15 - fitting to
    // the key field alone let the case corners hang off the frame.
    const hw = width / 2 + 0.62;
    const hd = depth / 2 + 0.62;

    /* Where the eye goes. The section keeps its slight rake - it is a lamp
       finding an object on a table. The hero is square-on and a touch below
       centre, the way a product is held up to be looked at. */
    const place = (cam: THREE.PerspectiveCamera, d: number) => {
      if (daylight) cam.position.set(0, d * 0.05, d);
      else cam.position.set(d * 0.02, -d * 0.04, d);
      cam.lookAt(0, 0, 0);
    };

    const corners: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const sy of [-0.9, 0.68]) {
          const q = daylight ? (pose ? heroQuat(_poseQ, pose) : HERO_Q) : FINAL_Q;
          const corner = new THREE.Vector3(sx * hw, sy, sz * hd).applyQuaternion(q);
          if (!daylight) corner.y += 0.55; // the board's resting lift
          corners.push(corner);
        }
      }
    }

    /* Fraction of the frame the board fills. Looser in the hero: the board
       is one element in a composition rather than the whole picture, and a
       0.93 fill leaves no air between the case corners and the type it is
       supposed to be sitting in front of. */
    const FILL = daylight ? (fill ?? 0.99) : 0.93;
    const probe = new THREE.Vector3();
    let dist = 8;

    for (let i = 0; i < 8; i++) {
      camera.aspect = size.width / Math.max(1, size.height);
      place(camera, dist);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();

      let worst = 0;
      for (const c of corners) {
        probe.copy(c).project(camera);
        worst = Math.max(worst, Math.abs(probe.x), Math.abs(probe.y));
      }
      if (Math.abs(worst - FILL) < 0.005) break;
      dist *= worst / FILL;
    }

    place(camera, dist);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, width, depth, daylight, fill,
      pose?.tip, pose?.roll, pose?.yaw, pose?.lean]);

  return null;
}

/* ---------------------------------------------------------------------------
   Board
   --------------------------------------------------------------------------- */

function Board({
  onHover,
  live = true,
  onLight,
  armed = true,
  instant = false,
  daylight = false,
  pose,
  fill,
  hidden = false,
  parkStanding = false,
}: {
  onHover: (label: string | null) => void;
  /** True once this is the section on screen. Going true ARMS the sequence;
   *  from there everything runs on its own clock: pitch black -> spotlight
   *  snaps on over the board lying flat -> half a second of stillness -> the
   *  board tilts up into the pose. False means "skip the theatre". */
  live?: boolean;
  /** true when the lamp comes on, false when the scene resets to darkness;
   *  drives the CSS spotlight cone and the copy fade. */
  onLight?: (on: boolean) => void;
  /** False once the section has left the viewport. Going false rewinds the
   *  whole sequence so it plays again on the next visit rather than being a
   *  one-shot that leaves the board already standing. */
  armed?: boolean;
  /** Arm straight into the finished state - lamp on, board standing - with
   *  no blackout, no strike and no sound. Used when the visitor scrolls back
   *  UP into the section: the intro is for arriving, not for returning. */
  instant?: boolean;
  /** Hero mode. The board is the hero object on a warm off-white page rather
   *  than a prop in a black studio, so the whole theatre comes off: no
   *  blackout, no lamp strike, no stand-up, no floor. It is simply lit and
   *  posed from the first frame, in daylight, and stays interactive. */
  daylight?: boolean;
  /** Live pose from the tuning panel; falls back to the baked HERO_Q. */
  pose?: HeroPose;
  /** Live camera fill from the tuning panel. */
  fill?: number;
  /** the canvas is off-screen (the render loop is parked) */
  hidden?: boolean;
  /** hold the board standing rather than flat while off-screen */
  parkStanding?: boolean;
}) {
  const advance = useThree((s) => s.advance);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  /* the frame the stand-up last drew a final shadow for */
  const shadowSettled = useRef(false);
  /* Shader warm-up (a game-dev staple): compile every program in the scene in
     the background as soon as the board exists, with the browser's parallel
     compile where it has one, so the first frame anyone SEES is not also the
     frame that stalls on compiling. */
  const warm = useRef<Promise<unknown> | null>(null);
  if (!warm.current) warm.current = gl.compileAsync ? gl.compileAsync(scene, camera).catch(() => {}) : Promise.resolve();
  const instantRef = useRef(instant);
  instantRef.current = instant;
  const { placed, width, depth } = useMemo(buildLayout, []);
  // leftmost cap edge: the ripple's origin for per-key stagger
  const originX = useMemo(() => Math.min(...placed.map((c) => c.x)), [placed]);
  const boardGroup = useRef<THREE.Group>(null);
  const spotRef = useRef<THREE.SpotLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const startAt = useRef<number | null>(live ? null : -99); // null = waiting in the dark
  const litFired = useRef(!live);

  /* Park the board while it is off-screen: put it in the pose the NEXT visit
     starts from - flat if that visit comes from above (it stands up), already
     standing if it comes from below - and DRAW that one frame. The render loop
     is stopped off-screen, so without the draw the canvas kept its last image:
     on a fast scroll back, the board showed standing mid-scroll, then snapped
     flat when the loop woke, then stood up (Brian, 2026-11-25). Only while
     hidden: re-posing it as it scrolls away would be a visible snap too. */
  useEffect(() => {
    if (daylight || armed || !hidden) return;
    startAt.current = null;
    litFired.current = false;
    STAGE.ready = false;
    setBoardStanding(false);
    STAGE.lamp = 1; // the room is always lit now; a dark parked frame would pop
    STAGE.dark = false;
    onLight?.(false);
    const g = boardGroup.current;
    if (g) {
      g.quaternion.copy(parkStanding ? FINAL_Q : FLAT_Q);
      g.position.copy(parkStanding ? POSE_POS : FLAT_POS);
    }
    /* after the warm-up, so this hidden frame is cheap and the shadow and
       GPU uploads are done before the section is ever on screen */
    let off = false;
    warm.current?.then(() => {
      if (off) return;
      shadowSettled.current = false;
      gl.shadowMap.needsUpdate = true;
      advance(performance.now());
    });
    return () => {
      off = true;
    };
  }, [armed, hidden, parkStanding, onLight, daylight, advance, gl]);

  /* Timeline (seconds from trigger, wall-clock so frame stalls cannot slow
     the choreography - a dropped frame skips ahead instead of dragging):
     0.00 - 1.20  the board lies flat (FLAT_HOLD). Arriving from the hero
                  the first ~0.4 s of it is under the iris's black, then the
                  spotlight strikes over it (SceneCuts.tsx)
     1.20 - 2.00  the stand-up (RISE), smootherstep eased at both ends
     (Brian, 2026-11-25, tuned by eye: flat ~0.8 s once lit, a quick tilt)

     It used ease-out cubic, whose velocity is at its MAXIMUM on frame one -
     the board snapped off the table from a dead stop. */
  useFrame((state) => {
    const g = boardGroup.current;
    if (!g) return;

    const now = state.clock.elapsedTime;

    /* Daylight short-circuits the whole timeline. There is no room to darken
       and no lamp to throw, so the stage is simply declared open on frame one
       and the board sits in its pose. This runs BEFORE the `armed` bail-out:
       the hero is the landing section and must be lit whether or not anything
       has armed it, and STAGE is module-level shared state, so leaving lamp at
       0 here would black out the legends. */
    if (daylight) {
      STAGE.lamp = 1;
      STAGE.dark = false;
      STAGE.ready = true;
      g.quaternion.copy(pose ? heroQuat(_poseQ, pose) : HERO_Q);
      g.position.copy(HERO_POS);
      return;
    }

    if (!armed) return; // rewound and off-screen; nothing to draw

    if (startAt.current === null && live) {
      if (instantRef.current) {
        // returning from below: already lit, already standing, no theatre
        startAt.current = -99;
        litFired.current = true;
        onLight?.(true);
      } else {
        // armed: the clock starts and the board stands up out of it
        startAt.current = now;
      }
    }
    const t = startAt.current === null ? -1 : startAt.current === -99 ? 99 : now - startAt.current;

    /* The room is simply LIT. The blackout and the lamp strike are gone
       (Brian, 2026-08-28): arriving in a dark room and waiting for a light to
       catch was a beat too many in front of the thing you came to see. The
       INTRO stays - the board still lies flat for half a second and stands up
       - it just does it with the lights already on. */
    const s = t;
    const lamp = 1;
    if (!litFired.current) {
      litFired.current = true;
      onLight?.(true);
    }
    STAGE.dark = false;
    STAGE.lamp = 1;
    /* The old 880 was set when the legends were dark ink on pale caps and
       needed all the help they could get. It put roughly 15 units of
       irradiance on the board - but a saturated cap clips once its brightest
       channel passes ~3, so every top face bleached to pastel while the side
       faces (which the lamp rakes) kept the real colour. The legends are unlit
       and tone-mapping-exempt, so they stay readable however far this drops;
       only the caps care. */
    if (spotRef.current) spotRef.current.intensity = 300 * lamp;
    if (ambRef.current) ambRef.current.intensity = 0.55 * lamp;
    if (fillRef.current) fillRef.current.intensity = 0.45 * lamp;
    if (rimRef.current) rimRef.current.intensity = 0.5 * lamp;

    // -- board: flat and near the lens, then it recedes as it stands up --
    // Smootherstep (Perlin): 6x^5 - 15x^4 + 10x^3. Velocity AND acceleration
    // are both zero at each end, so the board eases out of rest and eases
    // into the pose with nothing to snap at either edge. Driven off the wall
    // clock, so it is frame-rate independent by construction.
    const RISE = 0.8; // Brian, 2026-11-25: twice as fast as the old 1.6 s
    const x = THREE.MathUtils.clamp((s - FLAT_HOLD) / RISE, 0, 1);
    const u = x * x * x * (x * (x * 6 - 15) + 10);

    STAGE.ready = x >= 1;
    setBoardStanding(x >= 1); // App's 1->2 gate waits on this (lib/boardState.ts)
    if (x < 1 || !shadowSettled.current) {
      state.gl.shadowMap.needsUpdate = true;
      shadowSettled.current = x >= 1;
    }
    g.quaternion.slerpQuaternions(FLAT_Q, FINAL_Q, u);
    g.position.lerpVectors(FLAT_POS, POSE_POS, u);

    /* No pointer parallax. The board used to lean a few degrees toward the
       pointer; it read nicely but made the resting pose depend on where the
       mouse was, and the section's transition clip has exactly one start
       frame. Removed rather than frozen (Brian, 2026-08-26). */
  });
  /* A STACK, not a single slot.
     Two keys can be down at once - two fingers on the physical keyboard, or a
     finger and the mouse pointer - and a lone `active` string cannot describe
     that. It made releasing either key blank the board while the other was
     still held.

     Most-recently-pressed wins, and releasing it falls back to whatever is
     still down rather than to nothing. Order matters, so this is an array and
     not a Set. */
  const [held, setHeld] = useState<string[]>([]);
  const active = held.length ? held[held.length - 1] : null;

  // Text legends need the webfont, which is very likely still loading on first
  // paint. Rebuild once it lands so those five keys are not drawn in fallback
  // monospace.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // One shared cap mesh for the whole board; per-cap width comes from scale.
  const capMesh = useKeycapGeometry();

  const textures = useMemo(() => {
    void fontsReady;
    return new Map(placed.map((p) => [p.label, legendTexture(p)]));
  }, [placed, fontsReady]);
  useEffect(() => () => textures.forEach((t) => t?.dispose()), [textures]);

  const caseGeo = useMemo(
    () => new RoundedBoxGeometry(width + 1.15, 0.95, depth + 1.15, 6, 0.34),
    [width, depth]
  );
  useEffect(() => () => caseGeo.dispose(), [caseGeo]);

  /* Where the STANDING board is on screen, for the transition clips to fit
     their keyboard onto (lib/boardState.ts, TransitionPlayer seamTransform).
     The case's corners in the final pose, through the live camera - not the
     current pose, so it is right while the board is parked off-screen too. */
  useEffect(() => {
    if (daylight) return;
    const hw = (width + 1.15) / 2;
    const hd = (depth + 1.15) / 2;
    const world = new THREE.Matrix4().compose(POSE_POS, FINAL_Q, new THREE.Vector3(1, 1, 1));
    const v = new THREE.Vector3();
    registerBoardPlacement(() => {
      const el = gl.domElement;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const panel = el.closest(".panel")?.getBoundingClientRect();
      camera.updateMatrixWorld();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            v.set(sx * hw, -0.34 + sy * 0.475, sz * hd).applyMatrix4(world).project(camera);
            const nx = (v.x + 1) / 2;
            const ny = (1 - v.y) / 2;
            x0 = Math.min(x0, nx); x1 = Math.max(x1, nx);
            y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
          }
      return {
        n: { x0, y0, x1, y1 },
        /* x against the screen, y against the section: once the section is
           the one in view, that is where the canvas will be */
        canvas: { x: r.left, y: r.top - (panel?.top ?? 0), w: r.width, h: r.height },
      };
    });
    return () => registerBoardPlacement(null);
  }, [daylight, width, depth, gl, camera]);

  /* Re-entering a label already held moves it to the top rather than adding a
     duplicate: hovering a key you are already holding down should not need two
     releases to clear. */
  const enter = useCallback((label: string) => {
    setHeld((h) => (h[h.length - 1] === label ? h : [...h.filter((x) => x !== label), label]));
  }, []);

  const leave = useCallback((label: string) => {
    setHeld((h) => (h.includes(label) ? h.filter((x) => x !== label) : h));
  }, []);

  const clear = useCallback(() => setHeld([]), []);

  /* One place tells the parent what is selected, derived from the stack.
     Reporting it from inside enter/leave is what caused the original bug: a
     release fired `onHover(null)` unconditionally, wiping the caption even
     when another key was still down. */
  useEffect(() => {
    onHover(active);
  }, [active, onHover]);

  /* A key held while the tab loses focus never delivers its keyup, so it would
     stay down forever - visibly stuck, and blocking the fallback. Same when the
     section is left mid-press. Drop everything on the way out. */
  useEffect(() => {
    const drop = () => setHeld([]);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("blur", drop);
      drop();
    };
  }, [armed]);

  const runAction = useCallback((a: CapAction) => {
    switch (a) {
      case "github":
        window.open("https://github.com/jiacheng-fu", "_blank", "noopener");
        break;
      case "linkedin":
        window.open("https://linkedin.com/in/jiachengfu", "_blank", "noopener");
        break;
      case "email":
        window.location.href = "mailto:brian.fu123321@gmail.com";
        break;
      case "source":
        window.open("https://github.com/jiacheng-fu/personal-website", "_blank", "noopener");
        break;
      case "wave":
        WAVE.at = performance.now() / 1000;
        break;
    }
  }, []);

  /* ---------------------------------------------------------------------
     Physical keyboard

     The board mirrors an ANSI layout, so the obvious thing is to let the real
     one drive it: press D and the cap sitting in D's position goes down. Keyed
     on `KeyboardEvent.code`, so it is the PHYSICAL position that matches, not
     the character - the point is the shape of the board, not the alphabet.
     --------------------------------------------------------------------- */
  const byCode = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const cap of placed) if (cap.code) m.set(cap.code, cap);
    return m;
  }, [placed]);

  useEffect(() => {
    // Only while this is the section on screen. Otherwise typing anywhere else
    // on the page would be quietly driving a board nobody is looking at.
    if (!armed) return;

    /* Enter and Space ACTIVATE whatever holds focus, and after clicking a
       progress dot that is still the dot - so a Space meant for the board
       would have jumped the section instead. Links and buttons are treated as
       off-limits for the same reason fields are. */
    const busyElsewhere = () => {
      const el = document.activeElement as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))
      );
    };

    const down = (e: KeyboardEvent) => {
      // Auto-repeat would re-trigger the press many times a second.
      if (e.repeat || busyElsewhere()) return;
      /* Never answer a shortcut. Cmd+R, Ctrl+C and friends must pass straight
         through - lighting up "Git" because someone copied something would be
         a bug, not an easter egg. */
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const cap = byCode.get(e.code);
      if (!cap) return;

      /* useSectionNav also listens on window, and it reads Space as "next
         section". Both listeners sit on the same node, so preventDefault is
         not enough and registration order would decide the winner. This one
         runs in the CAPTURE phase and stops the event dead, so while the board
         is the thing on screen the spacebar belongs to the board.

         Only keys the board actually claims are stopped. Arrows, PageUp and
         PageDown are untouched and still move between sections. */
      e.preventDefault();
      e.stopImmediatePropagation();

      if (cap.action === "wave") {
        runAction("wave");
        return;
      }

      enter(cap.label);

      /* CapsLock reports a keydown when the light goes ON and the matching
         keyup only when it goes OFF again, so waiting for the release would
         leave this cap stuck down until the user toggled it back. Let it up on
         its own. */
      if (e.code === "CapsLock") window.setTimeout(() => leave(cap.label), 260);
    };

    const up = (e: KeyboardEvent) => {
      const cap = byCode.get(e.code);
      if (!cap || e.code === "CapsLock") return;
      if (cap.action !== "wave") leave(cap.label);
    };

    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [armed, byCode, enter, leave, runAction]);

  const activeCap = active ? placed.find((p) => p.label === active) : null;
  /* Sits off the board's lower-left corner, derived from the board size so it
     stays put if the layout changes. The board is posed on its corner, so
     that part of frame is empty. */
  /* Off the board's lower-left, standing on the floor. The board is posed on
     its corner, so that part of frame is empty. z brings it forward of the
     board so it reads as nearer to camera, not tucked behind. */
  /* z matters for FRAMING as much as depth: the camera sits just below the
     origin looking slightly up, so bringing the card toward the lens pushes
     it DOWN the frame and off the bottom. Held near the board's own depth. */
  const cardAt = useMemo(() => ({ x: -width * 0.4, z: -0.4 }), [width]);

  return (
    <>
      <FitCamera width={width} depth={depth} daylight={daylight} pose={pose} fill={fill} />

      <HoverCard label={activeCap && !activeCap.blank ? activeCap.label : null} offset={cardAt} />

      {/* ------------------------------ daylight ------------------------------
          A product-shot rig for the hero: broad soft key from the upper left
          (matching where the light falls on the photographed hand), a gentle
          front fill so the legends stay readable, and a procedural
          environment for the reflections.

          The environment is built from Lightformers rather than an HDR preset
          on purpose - drei's presets fetch from a third-party CDN at runtime,
          and a black anodised case with NO environment reads as flat grey
          plastic. This gives it something to reflect without a network call
          or an external dependency in the critical path. */}
      {daylight && (
        <>
          <ambientLight intensity={1.15} color="#fbf8f2" />
          <directionalLight position={[-5, 8, 7]} intensity={2.1} color="#fffaf2" />
          <directionalLight position={[6, 2, 6]} intensity={0.55} color="#eef1f6" />
          <Environment resolution={192}>
            {/* the big soft source overhead, standing in for a window */}
            <Lightformer intensity={2.4} form="rect" scale={[14, 8, 1]} position={[-4, 9, 6]} target={[0, 0, 0]} color="#ffffff" />
            {/* a low bounce, so the underside of the case is not dead black */}
            <Lightformer intensity={0.7} form="rect" scale={[12, 6, 1]} position={[3, -6, 5]} target={[0, 0, 0]} color="#f3f1ed" />
            {/* a narrow strip to draw a highlight down one edge and give the
                anodising somewhere to catch */}
            <Lightformer intensity={1.5} form="rect" scale={[1.4, 9, 1]} position={[7, 3, 2]} target={[0, 0, 0]} color="#ffffff" />
          </Environment>
        </>
      )}

      {/* the studio rig: everything starts dark and the sequence ramps it */}
      {!daylight && (
      <>
      <ambientLight ref={ambRef} intensity={0} color="#dfe3ea" />
      {/* Further from the board and swung toward the camera. Inverse-square
          falloff is much flatter when the lamp is far relative to the object,
          and the board stands nearly upright in its final pose - lighting it
          from almost directly overhead scorched the top row and starved the
          bottom one. */}
      <spotLight
        ref={spotRef}
        position={[1.5, 14, 13]}
        angle={0.6}
        penumbra={0.9}
        intensity={0}
        decay={1.6}
        color="#f4f2ee"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0012}
      />
      <directionalLight ref={fillRef} position={[0, 1, 10]} intensity={0} color="#cdd3dc" />
      <directionalLight ref={rimRef} position={[-6, 8, -3]} intensity={0} color="#aebacc" />

      {/* the table the board lies on when the light finds it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5.4, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#121214" roughness={0.95} metalness={0.04} />
      </mesh>
      </>
      )}

      {/* a press or swipe that lands on the board is the board's, never a
          page turn (lib/gesture.ts) */}
      <group ref={boardGroup} quaternion={FINAL_Q} position={[0, 0.55, 0]} onPointerMissed={clear} onPointerDown={claimGesture}>
        <mesh geometry={caseGeo} position={[0, -0.34, 0]} castShadow>
          <meshStandardMaterial color={WAY.case} roughness={0.36} metalness={KB_VARIANT === "white" ? 0.25 : 0.8} />
        </mesh>

        {/* switch plate, visible in the gaps between caps */}
        <mesh position={[0, 0.13, 0]}>
          <boxGeometry args={[width + 0.34, 0.06, depth + 0.34]} />
          <meshStandardMaterial color={WAY.plate} roughness={0.9} metalness={0.2} />
        </mesh>

        {placed.map((cap, i) => (
          <Key
            key={`${cap.label}|${i}`}
            cap={cap}
            geometry={capGeometry(capMesh, cap.capW / BASE)}
            texture={textures.get(cap.label) ?? null}
            active={active === cap.label}
            onEnter={enter}
            onLeave={leave}
            onAction={runAction}
            waveAt={(cap.x - originX) * 0.06}
          />
        ))}

      </group>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Canvas
   --------------------------------------------------------------------------- */

export default function Keyboard3D({
  paused = false,
  active = true,
  instant = false,
  daylight = false,
  pose,
  fill,
  onLight,
  hidden = false,
  parkStanding = false,
}: {
  paused?: boolean;
  hidden?: boolean;
  parkStanding?: boolean;
  active?: boolean;
  /** open on the finished state instead of playing the intro */
  instant?: boolean;
  /** Hero mode: daylight on a warm page, no studio theatre. See Board. */
  daylight?: boolean;
  /** Live pose + camera fill, driven by the hero tuning panel at ?tune=1. */
  pose?: HeroPose;
  fill?: number;
  onLight?: (on: boolean) => void;
}) {
  const [label, setLabel] = useState<string | null>(null);

  /* Keep the render scale inside PIXEL_BUDGET for whatever size the canvas
     actually is, and follow window resizes. */
  const hostBox = useRef<HTMLDivElement>(null);
  const [pixelBudgetDpr, setPixelBudgetDpr] = useState(1);
  useEffect(() => {
    const fit = () => {
      const el = hostBox.current;
      const w = el?.clientWidth || window.innerWidth;
      const h = el?.clientHeight || window.innerHeight;
      setPixelBudgetDpr(budgetedDpr(w, h));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div
      className={`kb ${daylight ? "kb--daylight" : ""}`}
      ref={hostBox}
    >
      <Canvas
        className="kb__canvas"
        /* Measure the LAYOUT box, not the on-screen one. The wrapper fades in
           with a scale(0.98) (App.css kb-in), and react-three-fiber sizes the
           canvas from getBoundingClientRect, transforms included, without
           ever re-measuring once the animation ends: wherever it measured
           mid-fade, the board rendered ~1.7% small and anchored top-left for
           good - on a 1440p or 4K screen every time (2517 of 2560px,
           3776 of 3840; 1080p measured after the fade and was fine). The same
           fault behind the plates' 1.6% shrink (docs/transition-kb-machine.md
           s16). offsetSize reads offsetWidth/Height, which transforms do not
           touch. 2026-11-26. */
        resize={{ offsetSize: true }}
        shadows={!LOW_TIER}
        /* Was capped at 1.75. On a Retina panel that renders ~14% fewer
           pixels per axis than the display can show (measured: a 3241x1823
           buffer where the screen could take 3705x2084), which is why the
           keycaps and their logos read soft. The cap is a RANGE, so weak
           GPUs still fall back down it; there is no cost on machines that
           cannot afford it. */
        /* A PIXEL BUDGET, not a device-pixel multiplier.

           `dpr={[1, 2]}` asks for the display's full density, which on a
           Retina panel at a large window is 7.3 MP a frame - with shadows and
           MSAA on 234 draw calls and ~389k triangles. That is what makes a
           laptop hot, and it scales with WINDOW SIZE, so the biggest screens
           pay the most. Budgeting total pixels instead keeps the cost roughly
           constant everywhere: small windows still get full density, large
           ones give back resolution rather than frame rate.

           `?dpr=` still overrides for testing. */
        dpr={DPR_OVERRIDE ?? pixelBudgetDpr}
        frameloop={paused ? "never" : "always"}
        /* The hero looks at the board almost square-on from further back: it
           is a product being presented to the reader, not an object found on
           a table by a lamp, and the section's raked overhead view reads as
           the latter. The longer lens also keeps the case edges near-parallel,
           which is what makes it sit against Swiss type instead of fighting
           it with a wide-angle flare. */
        camera={daylight ? { position: [0, 1.2, 11.5], fov: 22 } : { position: [0, 5.5, 6.7], fov: 26 }}
        gl={{ alpha: true, antialias: !LOW_TIER }}
        onCreated={({ gl }) => {
          /* Shadows on demand: the shadow pass re-rendered every mesh every
             frame even with the board sitting still. Now it runs only on
             frames something moved (stand-up, a key travelling, the hover
             card) - roughly halving the steady-state draw work. */
          gl.shadowMap.autoUpdate = false;
          gl.shadowMap.needsUpdate = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          // ACES desaturates as it rolls off, so an over-lit cap does not just
          // get brighter, it goes pale. Backing the exposure off keeps the
          // brand colours where they belong.
          gl.toneMappingExposure = 1.02;
        }}
      >
        {/* Black studio from the reference photo. The void and the visible
            light cone are painted by the section CSS behind this transparent
            canvas; the scene contributes the lit board, floor pool, shadow.
            Lights live inside Board so the switch-on sequence can drive them. */}
        <Board
          onHover={setLabel}
          live={active}
          onLight={onLight}
          armed={active && !paused}
          instant={instant}
          daylight={daylight}
          pose={pose}
          fill={fill}
          hidden={hidden}
          parkStanding={parkStanding}
        />
      </Canvas>

      {/* In the hero the hovered key is reported by the spec column, which is
          already the page's place for technical readout - a second caption
          floating under the board would be the same information twice. */}
      {!daylight && (
      <p className="kb__caption" aria-live="polite">
        {label ? (
          <>
            <b>{label}</b>
            <span>{CAP_NOTES[label]}</span>
            {LEAVES[label] && touchOnly() && <em className="kb__again">Tap it again to open</em>}
          </>
        ) : (
          /* a phone has no hover: a tap names the key */
          typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches ? "Tap a key." : "Hover a key."
        )}
      </p>
      )}

    </div>
  );
}
