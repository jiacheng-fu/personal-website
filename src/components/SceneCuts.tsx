import { forwardRef, useImperativeHandle, useRef } from "react";
import { setNavLocked } from "../lib/transitions";
import "./SceneCuts.css";

/* ---------------------------------------------------------------------------
   The two cuts that are not films (2026-11-25)

   1 <-> 2 is a clip and 2 <-> 3 is the terminal handoff. These are the other
   two boundaries, done in plain 2D, so there is no video to buffer and nothing
   depends on the window's aspect ratio:

   hero <-> keyboard   A cartoon iris. Down: it closes on the light bulb over
                       Brian's head, holds while the bulb glows, the bulb
                       clicks off, black - and the keyboard's own intro starts
                       from that black (blackout, lamp strike). Up: it closes on
                       the board and opens again from the bulb.
   projects <-> board  Sticky notes in the board's four colours slap over the
                       screen, the page jumps underneath, and they drop off.

   Each cut is the nav gate's promise (App.tsx): it resolves when the screen is
   covered, the nav lands instantly behind it, and the reveal runs here
   afterwards. The nav stays locked until the cut is off the screen.
   --------------------------------------------------------------------------- */

export type CutsHandle = {
  irisDown: () => Promise<void>;
  irisUp: () => Promise<void>;
  notes: (dir: "down" | "up") => Promise<void>;
  /** keyboard <-> machine where the 16:9 clip cannot play (a phone, a
   *  portrait window): the monitor's own power on, and off */
  crt: (dir: "on" | "off") => Promise<void>;
  /** stop forcing the bulb lit (the hero has gone off screen) */
  releaseBulb: () => void;
};

const INK = "#050505"; // the keyboard's void (and the projects' page)
/* hero -> keyboard: full black once the bulb is out, split around the landing */
const BLACK_BEFORE = 260;
const BLACK_AFTER = 380;
const NOTE_COLOURS = [
  ["#fff480", "#f7e257"],
  ["#ffbad4", "#f899bc"],
  ["#b2e0ff", "#8dccf7"],
  ["#cdf5a6", "#ace683"],
];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
/** two frames: the nav has landed and the new section has painted */
const settled = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function tween(ms: number, ease: (t: number) => number, frame: (k: number) => void) {
  return new Promise<void>((done) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      frame(ease(t));
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

const root = () => document.documentElement.classList;

/** the bulb doodle on the hero, in screen px: centre and a radius that frames it */
function bulb() {
  const g = document.querySelector<SVGGElement>("#top .hx__doodle--bulb");
  const r = g?.getBoundingClientRect();
  if (!r || !r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, hold: 0.62 * Math.hypot(r.width, r.height) + 30 };
}

/** force the bulb drawn (it normally draws itself in ~3 s after arrival) */
function lightBulb() {
  const s = document.querySelector<SVGPathElement>("#top .hx__doodle--bulb .hx__stroke");
  const drawn = s ? parseFloat(getComputedStyle(s).strokeDashoffset) < 0.05 : true;
  root().remove("cut-off");
  root().add("cut-bulb", "cut-glow");
  /* not drawn yet: fade it in. Web Animations, not a CSS animation - each
     stroke carries its draw-in delay inline, and an inline animation-delay
     would hold a CSS fade at opacity 0 for ~3 s */
  if (!drawn)
    document
      .querySelectorAll<SVGPathElement>("#top .hx__doodle--bulb .hx__stroke")
      .forEach((p) => p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" }));
}

export default forwardRef<CutsHandle>(function SceneCuts(_, ref) {
  const iris = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const run = useRef(0);

  /** hold the nav for the cut's whole time on screen, with a failsafe */
  const lock = () => {
    const id = ++run.current;
    setNavLocked(true);
    const t = window.setTimeout(() => run.current === id && setNavLocked(false), 5000);
    return () => {
      window.clearTimeout(t);
      if (run.current === id) setNavLocked(false);
    };
  };

  /* ---- iris ---- */
  const far = (x: number, y: number) =>
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 2;
  const drawIris = (x: number, y: number, r: number) => {
    const el = iris.current;
    if (!el) return;
    el.style.display = "block";
    el.style.opacity = "1";
    const m = r <= 0 ? "none" : `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + 1.5}px)`;
    el.style.maskImage = m;
    el.style.webkitMaskImage = m;
  };
  const hideIris = async (fade = 0) => {
    const el = iris.current;
    if (!el) return;
    if (fade) {
      el.style.opacity = "0";
      el.style.transition = `opacity ${fade}ms ease`;
      await wait(fade);
      el.style.transition = "";
    }
    el.style.display = "none";
  };

  /** the black lifts the way a stage light strikes: a stutter, then on */
  const spotlightOn = async () => {
    const el = iris.current;
    if (!el) return;
    el.style.maskImage = el.style.webkitMaskImage = "none";
    await el
      .animate(
        [
          { opacity: 1 },
          { opacity: 0.45, offset: 0.12 },
          { opacity: 0.95, offset: 0.22 },
          { opacity: 0.3, offset: 0.4 },
          { opacity: 0.7, offset: 0.5 },
          { opacity: 0 },
        ],
        { duration: 460, easing: "linear", fill: "forwards" },
      )
      .finished.catch(() => {});
    el.getAnimations().forEach((a) => a.cancel());
    el.style.display = "none";
  };

  const irisDown = () => {
    const unlock = lock();
    const b = bulb() ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.45, hold: 110 };
    const R = far(b.x, b.y);
    lightBulb();
    const covered = (async () => {
      await tween(560, easeInOut, (k) => drawIris(b.x, b.y, R + (b.hold - R) * k));
      await wait(320); // the beat on the glowing bulb
      root().remove("cut-glow");
      root().add("cut-off"); // ...click
      await wait(140);
      await tween(170, easeIn, (k) => drawIris(b.x, b.y, b.hold * (1 - k)));
      drawIris(b.x, b.y, 0);
      /* Brian: after the light goes out it should stay completely black for a
         bit. Part of the black is spent here, before the nav lands... */
      await wait(BLACK_BEFORE);
    })();
    /* ...and the rest after it, so the keyboard's first frames (its canvas
       waking up) happen unseen. Then the spotlight comes on over a board that
       is still lying flat: Keyboard3D holds it flat for FLAT_HOLD before it
       stands up, and that clock started when the nav landed. */
    void covered
      .then(settled)
      .then(async () => {
        root().remove("cut-bulb", "cut-glow", "cut-off");
        await wait(BLACK_AFTER);
        await spotlightOn();
      })
      .finally(unlock);
    return covered;
  };

  const irisUp = () => {
    const unlock = lock();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.48;
    const R = far(cx, cy);
    const covered = tween(380, easeIn, (k) => drawIris(cx, cy, R * (1 - k))).then(() => drawIris(cx, cy, 0));
    void covered
      .then(settled)
      .then(async () => {
        lightBulb();
        const b = bulb() ?? { x: cx, y: window.innerHeight * 0.45, hold: 110 };
        const R2 = far(b.x, b.y);
        await tween(190, easeOut, (k) => drawIris(b.x, b.y, b.hold * k));
        await wait(170);
        root().remove("cut-glow");
        await tween(520, easeInOut, (k) => drawIris(b.x, b.y, b.hold + (R2 - b.hold) * k));
        await hideIris();
      })
      .finally(unlock);
    return covered;
  };

  /* ---- sticky notes ---- */
  const notes = (dir: "down" | "up") => {
    const unlock = lock();
    const host = board.current;
    if (!host) {
      unlock();
      return Promise.resolve();
    }
    host.replaceChildren();
    host.style.display = "block";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cell = Math.max(150, Math.min(vw, vh) / 4.2);
    const size = cell * 1.32;
    const cols = Math.ceil(vw / cell) + 1;
    const rows = Math.ceil(vh / cell) + 1;
    const ox = (vw - (cols - 1) * cell) / 2;
    const oy = (vh - (rows - 1) * cell) / 2;

    /* what the jump happens behind: the colour of the page arriving, so the
       gaps between notes never show the page leaving */
    const backing = document.createElement("div");
    backing.className = `cut-backing cut-backing--${dir === "down" ? "cork" : "ink"}`;
    host.append(backing);

    type Note = { el: HTMLDivElement; x: number; y: number; rot: number };
    const list: Note[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * cell + (Math.random() - 0.5) * cell * 0.3;
        const y = oy + r * cell + (Math.random() - 0.5) * cell * 0.3;
        const rot = (Math.random() - 0.5) * 18;
        const [s1, s2] = NOTE_COLOURS[Math.floor(Math.random() * NOTE_COLOURS.length)];
        const el = document.createElement("div");
        el.className = "cut-note";
        el.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;--s1:${s1};--s2:${s2};opacity:0`;
        host.append(el);
        list.push({ el, x, y, rot });
      }
    }
    /* slapped on in a shuffled flurry */
    const order = list.map((n) => ({ n, k: Math.random() })).sort((a, b) => a.k - b.k);
    const SPREAD = 240;
    const SLAP = 150;
    const slaps = order.map(({ n }, i) =>
      n.el.animate(
        [
          { opacity: 0, transform: `translateY(-10px) rotate(${n.rot * 1.6}deg) scale(1.45)` },
          /* opaque early: paper, not tracing paper */
          { opacity: 1, offset: 0.3 },
          { opacity: 1, transform: `rotate(${n.rot}deg) scale(1)` },
        ],
        { duration: SLAP, delay: (i / order.length) * SPREAD, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", fill: "forwards" },
      ),
    );
    backing.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      delay: SPREAD * 0.6,
      easing: "ease-in",
      fill: "forwards",
    });

    const covered = Promise.all(slaps.map((a) => a.finished)).then(() => wait(40));
    void covered
      .then(settled)
      .then(async () => {
        /* the page underneath is the one the backing was standing in for */
        backing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
        const falls = list.map((n) => {
          const drop = vh - n.y + size + Math.random() * 220;
          const dx = (Math.random() - 0.5) * 140;
          const spin = n.rot + (Math.random() - 0.5) * 70;
          return n.el.animate(
            [
              { opacity: 1, transform: `rotate(${n.rot}deg)` },
              { opacity: 1, transform: `translate(${dx}px, ${drop}px) rotate(${spin}deg)` },
            ],
            {
              duration: 380 + Math.random() * 140,
              /* the lower notes let go first, as if peeled from the bottom */
              delay: (1 - n.y / vh) * 100 + Math.random() * 60,
              easing: "cubic-bezier(0.3, 0, 0.7, 0.45)",
              fill: "forwards",
            },
          );
        });
        await Promise.all(falls.map((a) => a.finished));
        host.replaceChildren();
        host.style.display = "none";
      })
      .finally(unlock);
    return covered;
  };

  /* ---- the CRT: keyboard <-> machine without the clip ----
     The clip is a 16:9 film and cannot play on a phone held upright, where
     the move used to be a bare scroll (Brian, 2026-11-25). Instead the tube
     does what tubes did. On: the stage lamp goes out, and in the dark the
     screen comes on as a dot, a line, then the raster - which then gives way
     to the machine's own warm-up underneath. Off: the screen collapses to a
     line and a dot while the room goes dark, and the keyboard's spotlight
     strikes. */
  const crtBox = useRef<HTMLDivElement>(null);
  const crtDark = useRef<HTMLDivElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  const placeBeam = () => {
    const b = beam.current;
    if (!b) return;
    const r = document.querySelector<HTMLElement>("#ask .a2-crt")?.getBoundingClientRect();
    const box = r && r.width && r.bottom > 0 && r.top < window.innerHeight
      ? r
      : { left: window.innerWidth * 0.08, top: window.innerHeight * 0.2, width: window.innerWidth * 0.84, height: window.innerHeight * 0.55 };
    Object.assign(b.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  };
  const crtDone = () => {
    [crtDark.current, beam.current].forEach((e) => e?.getAnimations().forEach((a) => a.cancel()));
    if (crtBox.current) crtBox.current.style.display = "none";
  };
  const crt = (dir: "on" | "off") => {
    const unlock = lock();
    const host = crtBox.current;
    const dark = crtDark.current;
    const b = beam.current;
    if (!host || !dark || !b) {
      unlock();
      return Promise.resolve();
    }
    crtDone();
    host.style.display = "block";
    const DOT = "scale(0.015, 0.006)";
    const LINE = "scale(1, 0.006)";
    if (dir === "on") {
      b.style.opacity = "0";
      const covered = dark
        .animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-in", fill: "forwards" })
        .finished.then(() => wait(140));
      void covered
        .then(settled)
        .then(async () => {
          placeBeam();
          await b.animate(
            [
              { opacity: 0, transform: DOT },
              { opacity: 1, transform: DOT, offset: 0.15 },
              { opacity: 1, transform: LINE, offset: 0.5 },
              { opacity: 1, transform: "scale(1, 1)" },
            ],
            { duration: 440, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "forwards" },
          ).finished;
          /* the room comes up around the screen, and the flash sinks into
             the machine's own dark-then-bloom warm-up */
          const fade = { duration: 420, easing: "ease-out", fill: "forwards" } as const;
          dark.animate([{ opacity: 1 }, { opacity: 0 }], fade);
          await b.animate([{ opacity: 1, transform: "scale(1, 1)" }, { opacity: 0, transform: "scale(1, 1)" }], fade).finished;
        })
        .catch(() => {})
        .finally(() => {
          crtDone();
          unlock();
        });
      return covered;
    }
    placeBeam();
    dark.style.opacity = "0";
    dark.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-in", fill: "forwards" });
    const covered = b
      .animate(
        [
          { opacity: 0, transform: "scale(1, 1)" },
          { opacity: 1, transform: "scale(1, 1)", offset: 0.15 },
          { opacity: 1, transform: LINE, offset: 0.5 },
          { opacity: 1, transform: DOT, offset: 0.8 },
          { opacity: 0, transform: DOT },
        ],
        { duration: 560, easing: "cubic-bezier(0.6, 0, 0.4, 1)", fill: "forwards" },
      )
      .finished.then(() => wait(160));
    void covered
      .then(settled)
      .then(async () => {
        /* the board was left lit and standing: the lamp strikes on it */
        await dark
          .animate(
            [
              { opacity: 1 },
              { opacity: 0.45, offset: 0.12 },
              { opacity: 0.95, offset: 0.22 },
              { opacity: 0.3, offset: 0.4 },
              { opacity: 0.7, offset: 0.5 },
              { opacity: 0 },
            ],
            { duration: 460, easing: "linear", fill: "forwards" },
          )
          .finished;
      })
      .catch(() => {})
      .finally(() => {
        crtDone();
        unlock();
      });
    return covered;
  };

  useImperativeHandle(ref, () => ({
    irisDown,
    irisUp,
    notes,
    crt,
    releaseBulb: () => root().remove("cut-bulb", "cut-glow", "cut-off"),
  }));

  return (
    <>
      <div className="cut-iris" ref={iris} aria-hidden="true" style={{ background: INK }} />
      <div className="cut-board" ref={board} aria-hidden="true" />
      <div className="cut-crt" ref={crtBox} aria-hidden="true">
        <div className="cut-crt__dark" ref={crtDark} style={{ background: INK }} />
        <div className="cut-crt__beam" ref={beam} />
      </div>
    </>
  );
});
