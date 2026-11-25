/* Hero demos — DEV ONLY, never built or deployed.
 *
 *   npm run dev
 *   open http://localhost:5173/scripts/hero-demos.html
 *
 * Quick takes on Brian's hero idea (2026-11-25): a photo of him, with ideas
 * coming out of his head. Everything is 2D on purpose - type, SVG lines,
 * logos, a canvas - so there is no lighting to get wrong and no model to find.
 *
 * THE BASE (Brian's pick, 2026-11-25): photo 1, full colour, BRIAN FU in Inter
 * Tight 200 rising from behind his head. It is on in every view; the effects
 * are layered on top of it. The rejected options are still reachable from the
 * hash for comparison - photo=2, look=paper, font=geist|manrope, w=300|400 -
 * but the switcher only offers the effects.
 *
 * Every word and logo that comes out of his head is from src/data/content.ts
 * or the keyboard's own brand set: nothing invented.
 *
 * Assets: the photos and their head cutouts live in media/hero-photo/
 * (gitignored; Vite's dev server serves them, a build never sees them). The
 * cutouts were made with macOS Vision's subject lift - see the README there.
 */

import { profile, projects, skills } from "../src/data/content";

const IW = 1672;
const IH = 941;
const PAPER = "#f3f1ed";
const INK = "#16150f";
const RED = "#cf3f22";

const PHOTOS = {
  "1": { bg: "/media/hero-photo/background1.png", cut: "/media/hero-photo/background1-cut.png" },
  "2": { bg: "/media/hero-photo/background2.png", cut: "/media/hero-photo/background2-cut.png" },
} as const;
type PhotoId = keyof typeof PHOTOS;

const EFFECTS = ["none", "tree", "eruption", "logos", "ascii"] as const;
type Fx = (typeof EFFECTS)[number];
const FX_LABEL: Record<Fx, string> = {
  none: "Base only",
  tree: "Tree",
  eruption: "Eruption",
  logos: "Logo arc",
  ascii: "ASCII",
};

const FONTS = { inter: "Inter Tight", geist: "Geist", manrope: "Manrope" } as const;
type FontId = keyof typeof FONTS;
const WEIGHTS = [200, 300, 400];

type Look = "colour" | "paper";
type State = { photo: PhotoId; fx: Fx; look: Look; font: FontId; weight: number };

/* ---- state, kept in the hash so a view can be linked or screenshotted ---- */

function readHash(): State {
  const h = new URLSearchParams(location.hash.slice(1));
  const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T =>
    v && (all as readonly string[]).includes(v) ? (v as T) : d;
  return {
    photo: pick(h.get("photo"), ["1", "2"] as const, "1"),
    fx: pick(h.get("fx"), EFFECTS, "none"),
    look: pick(h.get("look"), ["colour", "paper"] as const, "colour"),
    font: pick(h.get("font"), Object.keys(FONTS) as FontId[], "inter"),
    weight: WEIGHTS.includes(Number(h.get("w"))) ? Number(h.get("w")) : 200,
  };
}
let st = readHash();
function writeHash() {
  const q = `photo=${st.photo}&fx=${st.fx}&look=${st.look}&font=${st.font}&w=${st.weight}`;
  history.replaceState(null, "", `#${q}`);
}

/* ---- DOM ---- */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage");
const frame = $("frame");
const bgImg = $<HTMLImageElement>("bgImg");
const bgCanvas = $<HTMLCanvasElement>("bgCanvas");
const headImg = $<HTMLImageElement>("headImg");
const headCanvas = $<HTMLCanvasElement>("headCanvas");
const behind = $("behind");
const nameLayer = $("nameLayer");
const front = $("front");
const ui = $("ui");

const SVGNS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function svgLayer(parent: HTMLElement) {
  const s = svgEl("svg", { viewBox: `0 0 ${IW} ${IH}`, preserveAspectRatio: "none", class: "layer" });
  parent.append(s);
  return s;
}
function div(cls: string, text?: string) {
  const e = document.createElement("div");
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const px = (x: number) => `${(x / IW) * 100}%`;
const py = (y: number) => `${(y / IH) * 100}%`;
/** image pixels -> container width units; the frame scales uniformly */
const cq = (v: number) => `${(v / IW) * 100}cqw`;
const scale = () => frame.clientWidth / IW;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---- assets ---- */

const imgs = new Map<string, Promise<HTMLImageElement>>();
function loadImg(src: string) {
  let p = imgs.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    imgs.set(src, p);
  }
  return p;
}

/** Where the head is, read from the cutout's alpha. `top[x]` is the first
 *  opaque row in column x (NaN where the column is empty). */
type Head = {
  top: Float32Array;
  crownX: number;
  crownY: number;
  x0: number;
  x1: number;
  alpha: Uint8ClampedArray;
};
const heads = new Map<PhotoId, Promise<Head>>();
function headOf(id: PhotoId) {
  let p = heads.get(id);
  if (!p) {
    p = loadImg(PHOTOS[id].cut).then((img) => {
      const c = document.createElement("canvas");
      c.width = IW;
      c.height = IH;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const alpha = g.getImageData(0, 0, IW, IH).data;
      const top = new Float32Array(IW).fill(NaN);
      let crownY = IH;
      for (let x = 0; x < IW; x++) {
        for (let y = 0; y < IH; y++) {
          if (alpha[(y * IW + x) * 4 + 3] > 140) {
            top[x] = y;
            if (y < crownY) crownY = y;
            break;
          }
        }
      }
      /* the upper head only, so a stray fleck of railing at the bottom
         corner does not widen it */
      let x0 = IW;
      let x1 = 0;
      let sx = 0;
      let n = 0;
      for (let x = 0; x < IW; x++) {
        const t = top[x];
        if (!(t <= crownY + 220)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        if (t <= crownY + 30) {
          sx += x;
          n++;
        }
      }
      return { top, crownX: sx / n, crownY, x0, x1, alpha };
    });
    heads.set(id, p);
  }
  return p;
}

/** a point just inside the hair, somewhere across the middle of the head */
function hairPoint(h: Head, spread = 0.6, depth = 26) {
  const w = h.x1 - h.x0;
  const x = h.x0 + w * (0.5 + (Math.random() - 0.5) * spread);
  const t = h.top[Math.round(x)];
  return { x, y: (Number.isNaN(t) ? h.crownY : t) + depth };
}

/* ---- the base: the name behind the head ----
   Each letter rises out of a slot at its own baseline, nearest the head
   first, and the head crops the middle letters. */

/** How far below the crown the baseline sits, in cap heights - i.e. how much
 *  of the middle letters the head covers. 0.46 -> 0.28 on 2026-11-25 (Brian:
 *  "make the name rise a bit higher"). */
const NAME_DROP = 0.28;
/** the name's width, as a fraction of the photo's */
const NAME_WIDTH = 0.86;

/** Where the name landed, in photo pixels, so effects can keep clear of it. */
type NameBox = { top: number; base: number };

function drawName(head: Head): { box: NameBox; stop: () => void } {
  const svg = svgLayer(nameLayer);
  const name = profile.name.toUpperCase();
  const probe = svgEl("text", { x: IW / 2, y: 500, "text-anchor": "middle", class: "cover", "font-size": 100 });
  probe.textContent = name;
  svg.append(probe);
  const fs = (100 * IW * NAME_WIDTH) / probe.getComputedTextLength();
  probe.setAttribute("font-size", String(fs));
  const cap = fs * 0.72;
  const base = head.crownY + cap * NAME_DROP;
  probe.setAttribute("y", String(base));

  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: "slot" });
  clip.append(svgEl("rect", { x: 0, y: 0, width: IW, height: base + fs * 0.03 }));
  defs.append(clip);
  const g = svgEl("g", { "clip-path": "url(#slot)" });
  const anims: Animation[] = [];
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " ") continue;
    const p = probe.getStartPositionOfChar(i);
    const L = svgEl("text", { x: p.x, y: base, class: "cover", "font-size": fs });
    L.textContent = name[i];
    g.append(L);
    const d = Math.abs(p.x + fs * 0.3 - head.crownX) / IW;
    anims.push(
      L.animate([{ transform: `translateY(${cap * 1.08}px)` }, { transform: "translateY(0)" }], {
        duration: 1150,
        delay: 200 + d * 1100,
        easing: "cubic-bezier(.2,.9,.25,1)",
        fill: "both",
      }),
    );
  }
  probe.remove();
  svg.append(defs, g);
  return { box: { top: base - cap, base }, stop: () => anims.forEach((a) => a.cancel()) };
}

/* ---- the effects, on top of the base ----
   Each one builds into `behind` (between the photo and the name, so things
   come out FROM BEHIND the head and pass behind the name) and/or `front`,
   and returns its cleanup. */

type Ctx = { head: Head; name: NameBox; look: Look };
type Effect = (c: Ctx) => () => void;

const none: Effect = () => () => {};

/* 2 - A parse tree rooted in the head: focus areas, then the tools under
   each. Orthogonal lines, drawn in by depth. */
const TREE: { name: string; leaves: [string, string | null][] }[] = [
  { name: "Compilers", leaves: [["LLVM", null], ["C++", "cplusplus"]] },
  { name: "Backends", leaves: [["FastAPI", "fastapi"], ["PostgreSQL", "postgresql"], ["DynamoDB", "dynamodb"]] },
  { name: "Security", leaves: [["Row-Level Security", null], ["Supabase", "supabase"]] },
  { name: "Games", leaves: [["Unity", "unity"], ["C#", "csharp"]] },
];
const tree: Effect = ({ head, name }) => {
  const svg = svgLayer(behind);
  const anims: Animation[] = [];
  const line = (d: string, delay: number, dur = 360) => {
    const p = svgEl("path", { d, pathLength: 1, class: "branch" });
    svg.append(p);
    anims.push(
      p.animate([{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }], {
        duration: dur,
        delay,
        easing: "cubic-bezier(.55,0,.25,1)",
        fill: "both",
      }),
    );
  };
  const dot = (x: number, y: number, delay: number) => {
    const c = svgEl("circle", { cx: x, cy: y, r: 4.5, class: "node" });
    svg.append(c);
    anims.push(
      c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, fill: "both" }),
    );
  };
  const chip = (x: number, y: number, el: HTMLElement, delay: number) => {
    el.style.left = px(x);
    el.style.top = py(y);
    front.append(el);
    anims.push(
      el.animate(
        [
          { opacity: 0, transform: "translate(-50%,-50%) translateY(0.6cqw)" },
          { opacity: 1, transform: "translate(-50%,-50%)" },
        ],
        { duration: 420, delay, easing: "cubic-bezier(.2,1,.3,1)", fill: "both" },
      ),
    );
  };

  /* stacked upward from just above the name; the trunk runs up from the
     hair and passes behind the letters */
  const cx = head.crownX;
  const busY = name.top - 46;
  const catY = busY - 62;
  const leafBusY = catY - 84;
  const leafY = leafBusY - 64;
  const catXs = [0.17, 0.39, 0.61, 0.83].map((f) => f * IW);

  line(`M${cx} ${head.crownY + 46} V${busY}`, 0, 480);
  dot(cx, busY, 470);
  line(`M${cx} ${busY} H${catXs[0]}`, 480, 420);
  line(`M${cx} ${busY} H${catXs[catXs.length - 1]}`, 480, 420);

  /* Leaves are measured, not guessed: each group is centred under its
     category, then pushed right just far enough to clear the group before
     it, and the whole row pulled back if it runs off the edge. A wider face
     or a longer label can never make two chips collide. */
  const s = scale();
  const GAP = 24;
  const groups = TREE.map((cat, i) => {
    const els = cat.leaves.map(([label, logo]) => {
      const l = div("chip");
      if (logo) {
        const im = document.createElement("img");
        im.src = `/logos/brand/${logo}.svg`;
        im.alt = "";
        l.append(im);
      }
      l.append(document.createTextNode(label));
      l.style.opacity = "0";
      front.append(l);
      return l;
    });
    const widths = els.map((e) => e.offsetWidth / s);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (els.length - 1);
    return { cx: catXs[i], els, widths, total, left: 0, xs: [] as number[] };
  });
  let right = -Infinity;
  for (const g of groups) {
    g.left = Math.max(g.cx - g.total / 2, right + 40);
    right = g.left + g.total;
  }
  const over = right - (IW - 70);
  for (const g of groups) {
    if (over > 0) g.left -= over;
    let x = g.left;
    g.xs = g.widths.map((w) => {
      const c = x + w / 2;
      x += w + GAP;
      return c;
    });
  }

  TREE.forEach((cat, i) => {
    const x = catXs[i];
    const t0 = 880 + i * 70;
    line(`M${x} ${busY} V${catY + 20}`, t0, 160);
    const c = div("chip chip--cat");
    const b = document.createElement("b");
    b.textContent = `0${i + 1}`;
    c.append(b, document.createTextNode(cat.name));
    chip(x, catY, c, t0 + 120);

    const n = cat.leaves.length;
    const xs = groups[i].xs;
    const t1 = t0 + 420;
    line(`M${x} ${catY - 22} V${leafBusY}`, t1, 220);
    dot(x, leafBusY, t1 + 210);
    line(`M${x} ${leafBusY} H${xs[0]}`, t1 + 220, 240);
    line(`M${x} ${leafBusY} H${xs[n - 1]}`, t1 + 220, 240);
    groups[i].els.forEach((l, j) => {
      const t2 = t1 + 460 + j * 70;
      line(`M${xs[j]} ${leafBusY} V${leafY + 16}`, t2, 150);
      l.style.opacity = "";
      chip(xs[j], leafY, l, t2 + 120);
    });
  });

  return () => anims.forEach((a) => a.cancel());
};

/* 3 - Logos erupting out of the head: a burst on arrival, then a steady
   stream. Each shoots up from inside the hair, slows, and dissolves at the
   top of its arc. Click anywhere for another burst. The engine is shared;
   what it throws is the spawner's business - words, or the bare logos.

   `tilt` is the starting angle either way, `spin` how fast it turns, both in
   degrees: words barely turn (they have to be read), logos tumble. */
type Spawner = () => () => HTMLElement;
/** one more thrown every this many seconds once the opening burst is out */
const STREAM_EVERY_S = 0.12;
function eruptionOf(makeSpawn: Spawner, tilt: number, spin: number): Effect {
  return ({ head }) => {
  const spawn = makeSpawn();
  type P = { el: HTMLElement; x: number; y: number; vx: number; vy: number; r: number; vr: number; age: number };
  const ps: P[] = [];
  const G = 1150;

  const emit = (burst: boolean) => {
    const el = spawn();
    behind.append(el);
    const at = hairPoint(head, 0.55, 34);
    const ang = ((-90 + rand(-1, 1) * (burst ? 58 : 32)) * Math.PI) / 180;
    const sp = burst ? rand(860, 1090) : rand(720, 920);
    ps.push({ el, ...at, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: rand(-tilt, tilt), vr: rand(-spin, spin), age: 0 });
  };
  const timers: number[] = [];
  const burst = (n: number) => {
    for (let i = 0; i < n; i++) timers.push(window.setTimeout(() => emit(true), i * 30));
  };
  burst(18);

  let last = performance.now();
  let acc = 0;
  let raf = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc > STREAM_EVERY_S) {
      acc -= STREAM_EVERY_S;
      emit(false);
    }
    const s = scale();
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      p.vy += G * dt;
      p.vx *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      /* full strength on the way up, gone a third of a second past the apex */
      const o = p.vy < 0 ? 1 : 1 - p.vy / 380;
      if (o <= 0 || p.y > IH + 80) {
        p.el.remove();
        ps.splice(i, 1);
        continue;
      }
      p.el.style.opacity = String(Math.min(1, p.age * 7) * o);
      p.el.style.transform = `translate(${p.x * s}px, ${p.y * s}px) translate(-50%,-50%) rotate(${p.r}deg)`;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".ui")) return;
    burst(16);
  };
  window.addEventListener("pointerdown", onDown);
  return () => {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    window.removeEventListener("pointerdown", onDown);
  };
  };
}

/** The eruption throws his tools as bare logos - the mark itself, no disc,
 *  no card. It threw words first; Brian, 2026-11-25: "use eruption but with
 *  the logos instead of text". */
const logoSpawner: Spawner = () => {
  const list = shuffle([...LOGOS]);
  let i = 0;
  return () => {
    const [name, file] = list[i++ % list.length];
    const im = document.createElement("img");
    im.className = "blogo";
    im.src = `/logos/brand/${file}.svg`;
    im.alt = name;
    im.draggable = false;
    im.style.width = `${rand(2.3, 3.7).toFixed(2)}cqw`;
    return im;
  };
};

const eruption = eruptionOf(logoSpawner, 20, 85);

/* 4 - The keyboard's own logos fly out of the head and settle into two arcs
   around it. Hover one for its name. */
const LOGOS: [string, string][] = [
  ["TypeScript", "typescript"],
  ["Python", "python"],
  ["C++", "cplusplus"],
  ["React", "react"],
  ["FastAPI", "fastapi"],
  ["PostgreSQL", "postgresql"],
  ["DynamoDB", "dynamodb"],
  ["Node", "nodejs"],
  ["Deno", "denojs"],
  ["Java", "java"],
  ["C#", "csharp"],
  ["Docker", "docker"],
  ["Supabase", "supabase"],
  ["Unity", "unity"],
  ["Vite", "vitejs"],
  ["Next.js", "nextjs"],
  ["Bash", "bash"],
  ["Git", "git"],
  ["JavaScript", "javascript"],
];
/* fetched up front, so the first burst is not a volley of empty boxes */
for (const [, file] of LOGOS) void loadImg(`/logos/brand/${file}.svg`);
const logos: Effect = ({ head, name }) => {
  const svg = svgLayer(behind);
  const anims: Animation[] = [];
  const cx = head.crownX;
  /* Two shallow arcs ABOVE the name, each a circle through its own top
     point and two ends that stop just short of the letters. The logos fly
     out of the hair, behind the name, and settle on them. */
  const arc = (halfW: number, topY: number, endY: number, n: number) => {
    const h = endY - topY;
    const r = (halfW * halfW + h * h) / (2 * h);
    const span = (Math.asin(halfW / r) * 180) / Math.PI;
    return { r, cy: topY + r, from: 90 + span, to: 90 - span, n };
  };
  const rings = [
    arc(330, name.top - 120, name.top - 34, 8),
    arc(520, name.top - 250, name.top - 40, 10),
  ];
  let k = 0;
  rings.forEach((ring, ri) => {
    const cy = ring.cy;
    /* the arc itself, a hairline, drawn first */
    const a0 = (ring.from * Math.PI) / 180;
    const a1 = (ring.to * Math.PI) / 180;
    const p0 = { x: cx + ring.r * Math.cos(a0), y: cy - ring.r * Math.sin(a0) };
    const p1 = { x: cx + ring.r * Math.cos(a1), y: cy - ring.r * Math.sin(a1) };
    const line = svgEl("path", {
      d: `M${p0.x} ${p0.y} A${ring.r} ${ring.r} 0 0 1 ${p1.x} ${p1.y}`,
      pathLength: 1,
      class: "arc",
    });
    svg.append(line);
    anims.push(
      line.animate([{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }], {
        duration: 900,
        delay: 150 + ri * 150,
        easing: "cubic-bezier(.55,0,.25,1)",
        fill: "both",
      }),
    );

    for (let i = 0; i < ring.n; i++) {
      const [name, file] = LOGOS[k++];
      const a = ((ring.from + ((ring.to - ring.from) * i) / (ring.n - 1)) * Math.PI) / 180;
      const x = cx + ring.r * Math.cos(a);
      const y = cy - ring.r * Math.sin(a);
      const el = div("logo");
      el.style.left = px(x);
      el.style.top = py(y);
      const mark = document.createElement("img");
      mark.className = "logo__mark";
      mark.style.animationDelay = `${-rand(0, 4.6).toFixed(2)}s`;
      mark.src = `/logos/brand/${file}.svg`;
      mark.alt = name;
      mark.draggable = false;
      el.append(mark, div("logo__name", name));
      behind.append(el);
      const from = hairPoint(head, 0.3, 40);
      anims.push(
        el.animate(
          [
            {
              transform: `translate(-50%,-50%) translate(${cq(from.x - x)}, ${cq(from.y - y)}) scale(.25)`,
              opacity: 0,
            },
            { opacity: 1, offset: 0.2 },
            { transform: "translate(-50%,-50%)", opacity: 1 },
          ],
          {
            duration: 1050,
            delay: 250 + ri * 260 + Math.abs(i - (ring.n - 1) / 2) * 55,
            easing: "cubic-bezier(.18,1.3,.4,1)",
            fill: "both",
          },
        ),
      );
    }
  });
  /* the halo needs hover, so let pointer events through to the layer */
  behind.style.pointerEvents = "auto";
  return () => {
    anims.forEach((a) => a.cancel());
    behind.style.pointerEvents = "";
  };
};

/* 5 - Thoughts as text: words rise out of the hair one character at a time,
   each character scrambling before it settles, in the machine section's
   phosphor (or the page's ink, on paper). */
const ascii: Effect = ({ head, look }) => {
  const cv = document.createElement("canvas");
  cv.className = "layer";
  behind.append(cv);
  const g = cv.getContext("2d")!;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => {
    cv.width = Math.round(frame.clientWidth * dpr);
    cv.height = Math.round(frame.clientHeight * dpr);
  };
  size();
  window.addEventListener("resize", size);

  const paper = look === "paper";
  const font = paper ? `300 21px "JetBrains Mono"` : `30px "VT323"`;
  const SCR = "01<>/{}[]=+*#$%&;:~";
  const words = shuffle([...skills, ...projects.map((p) => p.title)].map((w) => w.toUpperCase()));
  type Gl = { x: number; y: number; ch: string; fin: string; age: number; life: number; vx: number };
  type Stream = { x: number; y: number; word: string; i: number; next: number };
  const gls: Gl[] = [];
  const streams: Stream[] = [];
  let wi = 0;
  let t = 0;
  let nextStream = 0;
  const recent: { x: number; t: number }[] = [];
  const SPEED = 150;
  const STEP = 0.16;

  let last = performance.now();
  let raf = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (t >= nextStream && streams.length < 6) {
      /* a column's glyphs outlive the stream that wrote them, so keep clear
         of every column used in the last few seconds */
      for (let k = recent.length - 1; k >= 0; k--) if (t - recent[k].t > 3.2) recent.splice(k, 1);
      for (let tries = 0; tries < 12; tries++) {
        const at = hairPoint(head, 0.85, 16);
        if (recent.some((r) => Math.abs(r.x - at.x) < 38)) continue;
        streams.push({ ...at, word: words[wi++ % words.length], i: 0, next: t });
        recent.push({ x: at.x, t });
        break;
      }
      nextStream = t + rand(0.3, 0.55);
    }
    for (let i = streams.length - 1; i >= 0; i--) {
      const s = streams[i];
      while (t >= s.next && s.i < s.word.length) {
        if (s.word[s.i] !== " ")
          gls.push({ x: s.x, y: s.y, ch: "", fin: s.word[s.i], age: 0, life: rand(2.6, 3.4), vx: rand(-6, 6) });
        s.i++;
        s.next += STEP;
      }
      if (s.i >= s.word.length) streams.splice(i, 1);
    }

    const sc = scale() * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(sc, 0, 0, sc, 0, 0);
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = paper ? INK : "#9dffad";
    g.strokeStyle = paper ? "rgba(243,241,237,.9)" : "rgba(0,22,8,.8)";
    g.lineWidth = 4;
    g.lineJoin = "round";
    for (let i = gls.length - 1; i >= 0; i--) {
      const q = gls[i];
      q.age += dt;
      if (q.age >= q.life) {
        gls.splice(i, 1);
        continue;
      }
      q.y -= SPEED * dt;
      q.x += q.vx * dt;
      const ch = q.age < 0.24 ? SCR[(Math.random() * SCR.length) | 0] : q.fin;
      g.globalAlpha = Math.min(1, q.age / 0.08) * Math.min(1, (q.life - q.age) / 0.9);
      g.strokeText(ch, q.x, q.y);
      g.fillText(ch, q.x, q.y);
    }
    g.globalAlpha = 1;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", size);
  };
};

const FX: Record<Fx, Effect> = { none, tree, eruption, logos, ascii };

/* ---- the "paper" treatment: a two-screen halftone, ink + red ----
   Ink dots follow darkness at 45 degrees; red dots follow warmth at 15. The
   head is drawn on the SAME grid as the background, so where the cutout
   sits over the photo the dots line up exactly and nothing shows a seam. */

const blurred = new Map<string, Uint8ClampedArray>();
function pixels(img: HTMLImageElement) {
  let d = blurred.get(img.src);
  if (!d) {
    const c = document.createElement("canvas");
    c.width = IW;
    c.height = IH;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.filter = "blur(2px)";
    g.drawImage(img, 0, 0);
    d = g.getImageData(0, 0, IW, IH).data;
    blurred.set(img.src, d);
  }
  return d;
}
function halftone(cv: HTMLCanvasElement, bg: HTMLImageElement, cut: HTMLImageElement | null, head: Head) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(frame.clientWidth * dpr);
  cv.height = Math.round(frame.clientHeight * dpr);
  const g = cv.getContext("2d")!;
  g.setTransform(cv.width / IW, 0, 0, cv.height / IH, 0, 0);
  if (cut) {
    /* paper under the head first, so whatever is behind it stays hidden */
    g.drawImage(cut, 0, 0, IW, IH);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = PAPER;
    g.fillRect(0, 0, IW, IH);
    g.globalCompositeOperation = "source-over";
  } else {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, IW, IH);
  }
  const src = pixels(bg);
  const cell = 5;
  const screens = [
    {
      ang: 45,
      color: INK,
      op: "source-over" as GlobalCompositeOperation,
      /* levels first: everything lighter than mid-grey prints as paper, so
         the sky goes blank and the dots are spent on the face and the hair */
      v: (r: number, gg: number, b: number) =>
        Math.max(0, Math.min(1, (1 - (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255 - 0.32) / 0.6)),
    },
    {
      ang: 15,
      color: RED,
      op: "multiply" as GlobalCompositeOperation,
      v: (r: number, gg: number, b: number) => Math.max(0, Math.min(1, ((r - Math.max(gg, b) * 0.92) / 255) * 1.9 - 0.04)),
    },
  ];
  const diag = Math.hypot(IW, IH) / 2 + cell;
  for (const sc of screens) {
    const a = (sc.ang * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.globalCompositeOperation = sc.op;
    g.fillStyle = sc.color;
    g.beginPath();
    for (let u = -diag; u <= diag; u += cell) {
      for (let v = -diag; v <= diag; v += cell) {
        const x = IW / 2 + u * ca - v * sa;
        const y = IH / 2 + u * sa + v * ca;
        if (x < 0 || y < 0 || x >= IW || y >= IH) continue;
        const i = ((y | 0) * IW + (x | 0)) * 4;
        if (cut && head.alpha[i + 3] < 128) continue;
        const val = sc.v(src[i], src[i + 1], src[i + 2]);
        if (val < 0.04) continue;
        const rad = cell * 0.5 * Math.sqrt(val) * 1.3;
        g.moveTo(x + rad, y);
        g.arc(x, y, rad, 0, Math.PI * 2);
      }
    }
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
}

/* ---- apply the state ---- */

/** how long the name has to itself before the effect starts */
const FX_DELAY_MS = 900;

let stop: (() => void) | null = null;
let seq = 0;
async function apply() {
  const id = ++seq;
  writeHash();
  renderUi();
  stage.classList.toggle("is-paper", st.look === "paper");
  stage.dataset.fx = st.fx;
  stage.style.setProperty("--dfont", `"${FONTS[st.font]}"`);
  stage.style.setProperty("--dw", String(st.weight));

  stop?.();
  stop = null;
  nameLayer.replaceChildren();
  behind.replaceChildren();
  front.replaceChildren();

  const p = PHOTOS[st.photo];
  const [bg, cut, head] = await Promise.all([
    loadImg(p.bg),
    loadImg(p.cut),
    headOf(st.photo),
    document.fonts.load(`${st.weight} 100px "${FONTS[st.font]}"`),
    document.fonts.load(`300 20px "JetBrains Mono"`),
    document.fonts.load(`30px "VT323"`),
  ]);
  if (id !== seq) return;

  const paper = st.look === "paper";
  if (paper) {
    halftone(bgCanvas, bg, null, head);
    halftone(headCanvas, bg, cut, head);
  } else {
    bgImg.src = p.bg;
    headImg.src = p.cut;
  }
  bgImg.hidden = headImg.hidden = paper;
  bgCanvas.hidden = headCanvas.hidden = !paper;

  /* the base, then the effect once the name is mostly up */
  const nm = drawName(head);
  let fxStop: (() => void) | null = null;
  const t = window.setTimeout(() => {
    fxStop = FX[st.fx]({ head, name: nm.box, look: st.look });
  }, FX_DELAY_MS);
  stop = () => {
    clearTimeout(t);
    nm.stop();
    fxStop?.();
  };
  document.documentElement.dataset.ready = String(id);
}

let resizeT = 0;
window.addEventListener("resize", () => {
  if (st.look !== "paper") return;
  clearTimeout(resizeT);
  resizeT = window.setTimeout(apply, 200);
});

/* ---- the switcher ---- */

function renderUi() {
  const grp = (label: string, items: [string, string, boolean][], on: (v: string) => void) => {
    const g = div("ui__grp");
    const s = document.createElement("span");
    s.textContent = label;
    g.append(s);
    for (const [v, text, active] of items) {
      const b = document.createElement("button");
      b.textContent = text;
      if (active) b.className = "is-on";
      b.onclick = () => on(v);
      g.append(b);
    }
    return g;
  };
  const replay = document.createElement("button");
  replay.textContent = "Replay ↻";
  replay.onclick = () => void apply();
  const hint = document.createElement("span");
  hint.className = "ui__hint";
  hint.textContent = "← → effect · R replay · H hide";
  ui.replaceChildren(
    grp("Effect", EFFECTS.map((v) => [v, FX_LABEL[v], st.fx === v]), (v) => set({ fx: v as Fx })),
    replay,
    hint,
  );
}
function set(patch: Partial<State>) {
  st = { ...st, ...patch };
  void apply();
}
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const i = EFFECTS.indexOf(st.fx);
  if (e.key === "ArrowRight") set({ fx: EFFECTS[(i + 1) % EFFECTS.length] });
  else if (e.key === "ArrowLeft") set({ fx: EFFECTS[(i + EFFECTS.length - 1) % EFFECTS.length] });
  else if (e.key === "r" || e.key === "R") void apply();
  else if (e.key === "h" || e.key === "H") ui.hidden = !ui.hidden;
});
window.addEventListener("hashchange", () => {
  const next = readHash();
  if (JSON.stringify(next) !== JSON.stringify(st)) {
    st = next;
    void apply();
  }
});

void apply();
