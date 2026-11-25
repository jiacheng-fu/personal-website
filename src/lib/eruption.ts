/* ---------------------------------------------------------------------------
   The hero's logo eruption

   Brian's tools, as their bare logos, shoot up out of his hair, tumble, pass
   behind his name and fade at the top of their arc. Prototyped in
   scripts/hero-demos.ts; this is the shipped version of it.

   It is NOT continuous (Brian, 2026-11-25). It erupts for a while when the
   hero arrives and then stops. A click keeps it going - each click buys more
   eruption TIME, not a fresh burst - and two caps keep a click-spammer from
   carpeting the screen: how far ahead time can be banked, and how many logos
   can be in the air at once.

   Plain DOM and one rAF loop, not React state: this runs at 60fps and a
   re-render per frame is exactly what it must not cost. The loop only runs
   while something is erupting or still in the air; at rest it costs nothing.

   Everything is laid out in the photo's own pixels (1672x941) and converted
   to screen pixels with one scale, so it tracks the photo at any size.
   --------------------------------------------------------------------------- */

/** The photo the hero is built on, and where the head sits in it.
 *  Measured once from the head cutout's alpha (media/hero-photo): `top` is the
 *  first opaque row every `step` px from x0 to x1, so things can be launched
 *  from just inside the hair, wherever across the head they start. */
export const PHOTO = {
  w: 1672,
  h: 941,
  crownX: 844,
  crownY: 569,
  x0: 631,
  x1: 1053,
  step: 8,
  top: [
    748, 720, 700, 685, 679, 671, 660, 653, 640, 631, 625, 620, 617, 613, 608, 602, 597, 594, 592, 592, 590, 590,
    590, 584, 569, 570, 586, 594, 593, 590, 588, 583, 583, 583, 587, 592, 594, 597, 601, 604, 607, 609, 612, 619,
    627, 634, 639, 643, 651, 662, 681, 702, 754,
  ],
} as const;

/** The marks it throws. Only tools from the skills list in data/content.ts,
 *  plus JavaScript (CarStatus is written in it) - nothing he has not used. */
export const ERUPTION_LOGOS: [name: string, file: string][] = [
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

/** The tuning, in one place. */
export const ERUPTION = {
  /** how long it erupts when the hero arrives */
  arrivalS: 3.2,
  /** thrown at once at the start of the arrival eruption */
  opening: 12,
  /** what one click adds */
  perClickS: 1.5,
  /** the most eruption that can be banked ahead of now - spam past this and
   *  the clicks only keep it topped up */
  maxAheadS: 5,
  /** the most logos in the air at once, whatever the clicking */
  maxLive: 14,
  /** one thrown every this many seconds while erupting */
  everyS: 0.12,
  /** gravity, photo px/s^2 */
  gravity: 1150,
  /** starting tilt and spin rate, degrees and degrees/s */
  tilt: 20,
  spin: 85,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** a point just inside the hair, somewhere across the middle of the head */
function hairPoint(spread: number, depth: number) {
  const w = PHOTO.x1 - PHOTO.x0;
  const x = PHOTO.x0 + w * (0.5 + (Math.random() - 0.5) * spread);
  const i = Math.max(0, Math.min(PHOTO.top.length - 1, Math.round((x - PHOTO.x0) / PHOTO.step)));
  return { x, y: PHOTO.top[i] + depth };
}

/** A ledge a logo can land on, in photo pixels: the top of a letter. */
export type Platform = { x0: number; x1: number; y: number };

/** PLAY mode (the hero uses it): the logos come down instead of fading -
 *  onto the tops of the letters and onto his hair, where they roll off -
 *  and the cursor knocks them about. `front` is a layer above the head and
 *  the name; a logo moves into it once it has cleared his hair. */
export type Play = { front: HTMLElement; platforms: () => Platform[] };

/** the head's top edge at x, in photo px; Infinity off either side of it */
function headTop(x: number) {
  if (x < PHOTO.x0 || x > PHOTO.x1) return Infinity;
  const f = (x - PHOTO.x0) / PHOTO.step;
  const i = Math.min(PHOTO.top.length - 1, Math.floor(f));
  const j = Math.min(PHOTO.top.length - 1, i + 1);
  return PHOTO.top[i] + (PHOTO.top[j] - PHOTO.top[i]) * (f - i);
}

type Particle = {
  /** which logo, so it can be in the air only once at a time */
  idx: number;
  el: HTMLImageElement;
  /** radius in photo px (play mode) */
  rad: number;
  /** moved above the head yet (play mode) */
  front: boolean;
  /** seconds spent at rest (play mode); it fades and goes after a while */
  rest: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  age: number;
};

export type Eruption = {
  /** the arrival eruption: an opening volley, then a stream for arrivalS */
  arrive(): void;
  /** a click: more time, capped; never a volley of its own */
  extend(): void;
  /** stop throwing; whatever is in the air finishes its arc */
  stop(): void;
  /** stop everything and remove it */
  destroy(): void;
};

/**
 * @param layer where the logos are drawn: the photo-sized layer BETWEEN the
 *   photo and the name, so they come out from behind the head and pass
 *   behind the letters
 */
export function createEruption(layer: HTMLElement, play?: Play): Eruption {
  /* fetched up front, so the first volley is not a row of empty boxes */
  const srcs = ERUPTION_LOGOS.map(([, f]) => `/logos/brand/${f}.svg`);
  for (const s of srcs) new Image().src = s;

  const order = [...ERUPTION_LOGOS.keys()];
  let next = 0;
  /* Logos in the air right now. A logo is never thrown while its twin is
     still flying (Brian saw two Unity marks leave side by side: the order
     reshuffles every 19 throws, so the last of one round could open the
     next). maxLive < the number of logos, so a free one always exists. */
  const flying = new Set<number>();
  const shuffle = () => {
    for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
  };
  shuffle();

  const live: Particle[] = [];
  const timers: number[] = [];
  const now = () => performance.now() / 1000;
  let until = 0;
  let acc = 0;
  let last = 0;
  let raf = 0;

  const throwOne = (volley: boolean) => {
    if (live.length >= ERUPTION.maxLive) return;
    let idx = -1;
    for (let tries = 0; tries < order.length * 2 && idx < 0; tries++) {
      if (next >= order.length) {
        next = 0;
        shuffle();
      }
      const cand = order[next++];
      if (!flying.has(cand)) idx = cand;
    }
    if (idx < 0) return;
    flying.add(idx);
    const [name] = ERUPTION_LOGOS[idx];
    const el = document.createElement("img");
    el.className = "hx__logo";
    el.src = srcs[idx];
    el.alt = "";
    el.draggable = false;
    el.dataset.logo = name;
    const cqw = rand(2.3, 3.7);
    el.style.width = `${cqw.toFixed(2)}cqw`;
    layer.append(el);
    const at = hairPoint(0.55, 34);
    const ang = ((-90 + rand(-1, 1) * (volley ? 58 : 32)) * Math.PI) / 180;
    const sp = volley ? rand(860, 1090) : rand(720, 920);
    live.push({
      idx,
      el,
      rad: ((cqw / 100) * PHOTO.w) / 2 * 0.82,
      front: false,
      rest: 0,
      ...at,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r: rand(-ERUPTION.tilt, ERUPTION.tilt),
      vr: rand(-ERUPTION.spin, ERUPTION.spin),
      age: 0,
    });
  };

  const frame = (ms: number) => {
    const t = ms / 1000;
    const dt = Math.min(0.05, t - last);
    last = t;

    if (t < until) {
      acc += dt;
      while (acc > ERUPTION.everyS) {
        acc -= ERUPTION.everyS;
        throwOne(false);
      }
    } else acc = 0;

    const s = layer.clientWidth / PHOTO.w;
    if (play) {
      stepPlay(t, dt, s);
      raf = t < until || live.length > 0 || timers.length > 0 ? requestAnimationFrame(frame) : 0;
      return;
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      p.vy += ERUPTION.gravity * dt;
      p.vx *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      /* full strength on the way up, gone a third of a second past the apex */
      const o = p.vy < 0 ? 1 : 1 - p.vy / 380;
      if (o <= 0 || p.y > PHOTO.h + 80) {
        p.el.remove();
        flying.delete(p.idx);
        live.splice(i, 1);
        continue;
      }
      p.el.style.opacity = String(Math.min(1, p.age * 7) * o);
      p.el.style.transform = `translate(${p.x * s}px, ${p.y * s}px) translate(-50%, -50%) rotate(${p.r}deg)`;
    }

    raf = t < until || live.length > 0 || timers.length > 0 ? requestAnimationFrame(frame) : 0;
  };

  /* ---- play mode ------------------------------------------------------ */
  const cursor = { x: -1e4, y: -1e4, vx: 0, vy: 0, at: 0 };
  const onMove = (e: PointerEvent) => {
    const b = layer.getBoundingClientRect();
    if (!b.width) return;
    const k = PHOTO.w / b.width;
    const x = (e.clientX - b.left) * k;
    const y = (e.clientY - b.top) * k;
    const t = performance.now() / 1000;
    const dt = Math.max(0.008, t - cursor.at);
    cursor.vx = Math.max(-2500, Math.min(2500, (x - cursor.x) / dt));
    cursor.vy = Math.max(-2500, Math.min(2500, (y - cursor.y) / dt));
    cursor.x = x;
    cursor.y = y;
    cursor.at = t;
  };
  if (play) window.addEventListener("pointermove", onMove, { passive: true });

  const remove = (i: number) => {
    const p = live[i];
    p.el.remove();
    flying.delete(p.idx);
    live.splice(i, 1);
  };

  const stepPlay = (t: number, dt: number, s: number) => {
    const plats = play!.platforms();
    const g = ERUPTION.gravity;
    const fresh = t - cursor.at < 0.12;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      /* out of his hair and rising: from here on it is in front of him */
      if (!p.front && p.vy < 0 && p.y + p.rad < PHOTO.crownY - 6) {
        play!.front.append(p.el);
        p.front = true;
      }
      p.vy += g * dt;
      p.vx *= 1 - 0.15 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      let support = false;
      if (p.front) {
        /* letter tops: ledges, landable from above only */
        for (const pf of plats) {
          if (p.vy < 0 || p.x < pf.x0 - p.rad * 0.3 || p.x > pf.x1 + p.rad * 0.3) continue;
          const bottom = p.y + p.rad;
          if (bottom > pf.y && bottom - p.vy * dt <= pf.y + 3) {
            p.y = pf.y - p.rad;
            p.vy = Math.abs(p.vy) < 60 ? 0 : -p.vy * 0.28;
            p.vx *= 0.8;
            support = true;
            /* past the edge with its centre: it tips off */
            if (p.x < pf.x0) p.vx -= 220 * dt;
            else if (p.x > pf.x1) p.vx += 220 * dt;
          }
        }
        /* his hair: it lands, then rolls downhill and off */
        const gy = headTop(p.x);
        if (p.y + p.rad > gy) {
          const slope = (headTop(p.x + 10) - headTop(p.x - 10)) / 20;
          p.y = gy - p.rad;
          if (p.vy > 0) p.vy = Math.abs(p.vy) < 60 ? 0 : -p.vy * 0.3;
          p.vx += (Number.isFinite(slope) ? slope : 0) * g * 0.9 * dt;
          p.vx *= 0.985;
          support = true;
        }
        /* the sides of the picture */
        if (p.x < p.rad) {
          p.x = p.rad;
          p.vx = Math.abs(p.vx) * 0.5;
        } else if (p.x > PHOTO.w - p.rad) {
          p.x = PHOTO.w - p.rad;
          p.vx = -Math.abs(p.vx) * 0.5;
        }
        /* the cursor knocks it about */
        if (fresh) {
          const dx = p.x - cursor.x;
          const dy = p.y - cursor.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < p.rad + 28) {
            p.vx += cursor.vx * 0.45 + (dx / d) * 220;
            p.vy += cursor.vy * 0.45 + (dy / d) * 220 - 160;
            p.vr += rand(-200, 200);
            p.rest = 0;
          }
        }
      }
      /* rolling on something: spin to match; in the air, keep tumbling */
      if (support) p.vr = (p.vx / p.rad) * 57.3;
      p.r += p.vr * dt;
      p.rest = support && Math.hypot(p.vx, p.vy) < 30 ? p.rest + dt : 0;
      const fade = p.rest > 5 ? 1 - (p.rest - 5) / 0.8 : 1;
      if (fade <= 0 || p.y > PHOTO.h + 80 || p.age > 25) {
        remove(i);
        continue;
      }
      p.el.style.opacity = String(Math.min(1, p.age * 7) * fade);
      p.el.style.transform = `translate(${p.x * s}px, ${p.y * s}px) translate(-50%, -50%) rotate(${p.r}deg)`;
    }
    /* logos bump into each other (only once they are out in front) */
    for (let a = 0; a < live.length; a++) {
      const A = live[a];
      if (!A.front) continue;
      for (let b = a + 1; b < live.length; b++) {
        const B = live[b];
        if (!B.front) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = A.rad + B.rad;
        if (d >= min) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        A.x -= nx * push;
        A.y -= ny * push;
        B.x += nx * push;
        B.y += ny * push;
        const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (vn < 0) {
          const j = (-(1 + 0.3) * vn) / 2;
          A.vx -= j * nx;
          A.vy -= j * ny;
          B.vx += j * nx;
          B.vy += j * ny;
        }
      }
    }
  };

  const run = () => {
    if (raf) return;
    last = now();
    raf = requestAnimationFrame(frame);
  };

  const bank = (seconds: number) => {
    const t = now();
    until = Math.min(Math.max(until, t) + seconds, t + ERUPTION.maxAheadS);
    run();
  };

  return {
    arrive() {
      for (let i = 0; i < ERUPTION.opening; i++) {
        const id = window.setTimeout(() => {
          timers.splice(timers.indexOf(id), 1);
          throwOne(true);
        }, i * 30);
        timers.push(id);
      }
      bank(ERUPTION.arrivalS);
    },
    extend() {
      bank(ERUPTION.perClickS);
    },
    stop() {
      until = 0;
      timers.splice(0).forEach(clearTimeout);
    },
    destroy() {
      until = 0;
      timers.splice(0).forEach(clearTimeout);
      cancelAnimationFrame(raf);
      raf = 0;
      live.splice(0).forEach((p) => p.el.remove());
      flying.clear();
      window.removeEventListener("pointermove", onMove);
    },
  };
}
