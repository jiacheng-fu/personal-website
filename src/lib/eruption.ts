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

type Particle = {
  /** which logo, so it can be in the air only once at a time */
  idx: number;
  el: HTMLImageElement;
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
export function createEruption(layer: HTMLElement): Eruption {
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
    el.style.width = `${rand(2.3, 3.7).toFixed(2)}cqw`;
    layer.append(el);
    const at = hairPoint(0.55, 34);
    const ang = ((-90 + rand(-1, 1) * (volley ? 58 : 32)) * Math.PI) / 180;
    const sp = volley ? rand(860, 1090) : rand(720, 920);
    live.push({
      idx,
      el,
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
    },
  };
}
