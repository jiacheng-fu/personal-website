import { useCallback, useEffect, useRef, useState, type ReactNode, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import "./App.css";
// TEMP (debug): Space pauses the transition clip. See src/lib/debugPause.ts.
import { installDebugPause } from "./lib/debugPause";
import Cursor from "./components/Cursor";
import KeyboardSection from "./components/KeyboardSection";
import RagSection from "./components/RagSection";
import WorkIndex from "./components/WorkIndex";
import Hero from "./components/Hero";
import { Magnetic } from "./components/Bits";
import { useSectionNav } from "./hooks/useSectionNav";
import { CLIPS, transitionAllowed, transitionsEnabled, toggleTransitions, initFrame, isUltrawide, setBoxed } from "./lib/transitions";
import GroundFloor from "./components/GroundFloor";
import { llmOptedIn, loadInBackground } from "./lib/ragEngine";
import TransitionPlayer, { type TransitionHandle } from "./components/TransitionPlayer";
import TerminalHandoff, { type HandoffHandle } from "./components/TerminalHandoff";
import SceneCuts, { type CutsHandle } from "./components/SceneCuts";
import { whenBoardStanding } from "./lib/boardState";
import { profile, skills } from "./data/content";

const ease = [0.16, 1, 0.3, 1] as const;

/* ---------------------------------------------------------------------------
   Section-per-viewport

   Every section is exactly one screen and scroll is a trigger: one gesture
   moves to the next or previous section, and that section's animation plays
   on its own clock once it becomes active. Nothing scrubs, and there is no
   scrolling "inside" a section.
   --------------------------------------------------------------------------- */

function Panel({
  id,
  active,
  className,
  children,
}: {
  id: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`panel ${className ?? ""} ${active ? "is-active" : ""}`}>
      {children}
    </section>
  );
}

/* ------------------------------- sections -------------------------------- */

function KeyboardScene({ active, skipIntro, parkStanding }: { active: boolean; skipIntro: boolean; parkStanding: boolean }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // The spotlight cone and every line of copy are gated by this class:
  // nothing is visible until the lamp comes on, and it goes back off when the
  // section deactivates so the next visit starts dark again.
  //
  // `stage-dark` goes further and blacks out the whole page - nav, progress
  // dots, custom cursor. Those live outside the panel, so during the blackout
  // they were the only things on screen, which rather spoils a blackout.
  const skipRef = useRef(skipIntro);
  skipRef.current = skipIntro;
  const handleLight = (on: boolean) => {
    /* Returning from below, the board is armed straight into its lit pose -
       but while the visibility observer catches up it is briefly "paused",
       and the rewind reports the lamp off. Honouring that blacked the page
       out for a few frames on every return. While active in skip mode an
       off-report is that churn, not a real change; leaving still clears. */
    if (!on && skipRef.current && activeRef.current) return;
    sceneRef.current?.closest(".panel")?.classList.toggle("is-lit", on);
    document.documentElement.classList.toggle("stage-dark", !on && activeRef.current);
  };

  /* Blackout goes on when the section is ENTERED, not when the lamp reports
     itself off: on a first visit the lamp never reports off, it has simply
     never been on, so keying off that left the nav dot glowing in the corner
     of an otherwise empty frame. Leaving must clear it, or the rest of the
     site stays blacked out. */
  useEffect(() => {
    const root = document.documentElement;
    /* Entered from below, there is no blackout to stage: the lamp is already
       on and the board already standing. Only a descent gets the theatre. */
    root.classList.toggle("stage-dark", active && !skipIntro);
    if (active && skipIntro) sceneRef.current?.closest(".panel")?.classList.add("is-lit");
    return () => root.classList.remove("stage-dark");
  }, [active, skipIntro]);

  return (
    <div className="section shell field-section" ref={sceneRef}>
      <p className="section__label">What I work in</p>
      <KeyboardSection skills={skills} active={active} skipIntro={skipIntro} parkStanding={parkStanding} onLight={handleLight} />
      <p className="field-note">
        Every key is something I&rsquo;ve shipped with.{" "}
        <span className="dim">Hover one.</span>
      </p>
    </div>
  );
}

/* The last page is the ground floor (components/GroundFloor.tsx): the
   credits as a building directory, and an elevator back up to the top. The
   contact links live in the nav. */


/* --------------------------------- app ----------------------------------- */

const SECTIONS = ["top", "craft", "ask", "work", "contact"] as const;

export default function App() {
  const reduce = useReducedMotion();

  // TEMP (debug): Space pauses/resumes the transition clip; , and . step a
  // frame while paused. Delete this effect and the import to remove.
  /* development only: on the live site Space is the section nav's again */
  useEffect(() => (import.meta.env.DEV ? installDebugPause() : undefined), []);

  const [clips, setClips] = useState(transitionsEnabled());

  /* Section-transition clips (docs/transition-kb-machine.md). The nav's gate
     holds a move while the clip plays over the page, then lands instantly.
     `boot` ticks when the keyboard->machine clip ends so the machine section
     wakes from a dark screen instead of appearing already lit. */
  const player = useRef<TransitionHandle>(null);
  /* RAG -> projects is not a clip: the terminal prints the work and the lines
     become the index. Same gate, no video. */
  const handoff = useRef<HandoffHandle>(null);
  /* hero <-> keyboard and projects <-> board: 2D cuts, no video
     (components/SceneCuts.tsx) */
  const cuts = useRef<CutsHandle>(null);
  const handoffOut = useRef<false | "down" | "up">(false);
  /* ticks when the index is arrived at via the handoff, so it can skip the row
     entrance the overlay has already performed */
  const [handed, setHanded] = useState(false);
  /* the index lends its titles to the handoff for the trip back into the glass */
  const [lifting, setLifting] = useState(false);
  const [boot, setBoot] = useState(0);
  const [leaving, setLeaving] = useState(0);
  /* ultrawide: ask once per session how the 16:9 clips should be shown */
  const [askFrame, setAskFrame] = useState(false);
  useEffect(() => {
    const stored = initFrame();
    if (stored === null && isUltrawide()) setAskFrame(true);
  }, []);
  /* plate rendering never boots the machine; filled in below, read in effects */
  const frameModeRef = useRef<string | null>(null);
  const hideAfterLand = useRef(false);
  /* set when the keyboard->machine clip has already ticked `boot`, so the
     arrival effect below does not boot the machine a second time */
  const bootedByClip = useRef(false);
  /* A clip that has not buffered must never freeze the page. Wait for it
     briefly (a cached clip is ready in milliseconds); if it is still not
     there, the move happens as a plain cut, the same as with Motion off. */
  const clipWithin = (p: TransitionHandle, src: string, ms: number) =>
    Promise.race([
      p.whenReady(src).then(() => true),
      new Promise<boolean>((r) => window.setTimeout(() => r(false), ms)),
    ]);
  const gate = useCallback((from: number, to: number) => {
    /* The 2D cuts need no clip, so they only follow the Motion switch, not
       the clips' aspect and size rules. Adjacent moves only: a progress-dot
       jump, or the elevator's ride to the top, stays as it was. */
    const c = cuts.current;
    if (c && transitionsEnabled() && !frameModeRef.current) {
      if (from === 0 && to === 1) return c.irisDown();
      if (from === 1 && to === 0) return c.irisUp();
      if (from === 3 && to === 4) return c.notes("down");
      if (from === 4 && to === 3) return c.notes("up");
    }
    if (!transitionAllowed() || !player.current) return null;
    const p = player.current;
    const kbPanel = document.querySelector(".panel--void");
    if (from === 1 && to === 2) {
      /* The clip opens on the board STANDING. Scrolled away while it is
         still lying flat or rising (flat for 1.2 s, up by 2 s after arriving),
         it finishes standing first - otherwise the clip's first frame snaps
         it upright. Capped, so a board that never reports cannot hold the
         nav. */
      return whenBoardStanding(1800).then(() => {
      /* the section's own text fades first; the clip has none of it */
      kbPanel?.classList.add("is-departing");
      return Promise.all([
        new Promise<void>((r) => window.setTimeout(r, 220)),
        clipWithin(p, CLIPS.kbToMachine, 1200),
      ]).then(([, ready]) => {
        if (!ready) {
          // plain cut; the machine's arrival effect boots it as usual
          window.setTimeout(() => kbPanel?.classList.remove("is-departing"), 400);
          return;
        }
        return p.play(CLIPS.kbToMachine).then(() => {
          bootedByClip.current = true;
          setBoot((n) => n + 1);
          hideAfterLand.current = true;
          window.setTimeout(() => kbPanel?.classList.remove("is-departing"), 800);
        });
      });
      });
    }
    if (from === 2 && to === 3 && handoff.current) {
      return handoff.current.run().then(() => {
        handoffOut.current = "down";
        setHanded(true);
      });
    }
    /* Back up is a different scene, not this one rewound: the black only has
       to cover the jump, and the terminal it lands on is played out afterwards
       (the machine cannot be revealed until the page is in front of it). */
    if (from === 3 && to === 2 && handoff.current) {
      /* Self-contained: it lands the page itself under the black and holds the
         nav lock for the whole scene, so there is nothing to do afterwards. */
      setHanded(false);
      setLifting(true);
      return handoff.current.runBack().finally(() => setLifting(false));
    }
    if (from === 2 && to === 1) {
      /* This one covers the screen the instant it starts, so an unbuffered
         clip here would be a black screen, not just a pause: check first,
         and cut plainly (nothing covered yet) if it is not there. */
      return clipWithin(p, CLIPS.machineToKb, 600).then((ready) => {
      if (!ready) return;
      kbPanel?.classList.add("is-departing"); // arrive text-less, like the clip
      /* black the machine's glass so the instant cover matches the clip's
         first frame (M, dark screen), then reveal instantly.
         The clip runs to its LAST frame now: the static keyboard tail it
         used to land inside is gone (that still, and the dissolve into it,
         is what produced the ghosted double board), so there is nothing
         safe to land early on. Instead seamAtEnd ramps in the scale/offset
         correction over the final 0.55 s, so the frame we hold is in
         register with the live board underneath. */
      setLeaving((n) => n + 1);
      return p.play(CLIPS.machineToKb, { instantReveal: true, seamAtEnd: true }).then(() => {
        /* hideAfterLand defers the next prime() to ~700 ms after landing;
           priming immediately swaps the video's frames while the overlay is
           still fading out - a visible flash of the forward clip's frame */
        hideAfterLand.current = true;
        window.setTimeout(() => kbPanel?.classList.remove("is-departing"), 700);
      });
      });
    }
    return null;
  }, []);

  // Reduced motion keeps native scrolling; hijacking it would be hostile.
  const { index, goTo } = useSectionNav(SECTIONS.length, !reduce, gate);

  /* The model's download starts the instant the site is landed on, and the
     rest follows as soon as the visitor moves past the hero (ragEngine.ts,
     WHEN IT LOADS). Only downloads: the GPU work waits for the machine. */
  /* STREAMING ORDER (the console trick: what the player needs next loads
     first). The keyboard->machine clip is primed as soon as the page itself
     has loaded, and the model's background download waits for that clip to
     buffer (10 s at most). Measured 2026-11-25 on a 10 Mbps line: with the two
     racing, the clip took 12 s to start; the model can wait, the clip cannot. */
  /* Created at mount, resolved when the clip has buffered (or 10 s): an
     early scroll can never start the model download ahead of the clip. */
  const clipReady = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!clipReady.current) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => (resolve = r));
    clipReady.current = { promise, resolve };
  }
  /* "Calm": no section move, scroll or key press for 2.5 s. That also covers
     the keyboard's whole stand-up (flat for 1.2 s, up by 2.0 s - FLAT_HOLD
     and RISE in Keyboard3D). The model's GPU stage (upload +
     compile, in its worker) only starts in a calm moment - on a cached
     return visit that GPU work landing mid-scroll was the stutter. */
  const lastMoveAt = useRef(performance.now());
  useEffect(() => {
    const moved = () => (lastMoveAt.current = performance.now());
    const evs = ["wheel", "keydown", "touchmove"] as const;
    evs.forEach((e) => window.addEventListener(e, moved, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, moved));
  }, []);
  useEffect(() => {
    let off = false;
    const calm = () => performance.now() - lastMoveAt.current > 2500;
    /* the whole model, in the background, from the hero on - for a visitor
       who switched the machine's LLM on (on an earlier visit: the choice is
       remembered). Everyone else is answered by quotes and downloads nothing. */
    if (llmOptedIn()) void loadInBackground(calm, clipReady.current!.promise);
    const start = () => {
      if (off) return;
      const p = player.current;
      const clip = transitionAllowed() && p;
      if (clip) p.prime(CLIPS.kbToMachine);
      void Promise.race([
        clip ? p.whenReady(CLIPS.kbToMachine) : Promise.resolve(),
        new Promise<void>((r) => window.setTimeout(r, 10_000)),
      ]).then(() => clipReady.current!.resolve());
    };
    let t = 0;
    const onLoad = () => (t = window.setTimeout(start, 300));
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      off = true;
      window.clearTimeout(t);
      window.removeEventListener("load", onLoad);
    };
  }, []);
  /* a section change is movement too */
  useEffect(() => {
    lastMoveAt.current = performance.now();
    /* the iris lights the hero's bulb for its hold; let it go once the hero
       is off screen, where nobody sees it return to its own draw-in */
    if (index !== 0) cuts.current?.releaseBulb();
  }, [index]);

  /* The machine boots on EVERY arrival from above, not only after the clip.
     The boot is where the model's load is shown - the progress bar is the
     real download now - so a hard cut (Motion off, a small or ultrawide
     screen, a progress-dot jump past the keyboard) must not skip it and land
     on a live prompt over a model that has not arrived. The clip path ticks
     `boot` itself, as it ends; this covers everything else. Arrivals from
     below are the terminal handoff's own scene and are left to it. */
  const lastIndex = useRef(index);
  useEffect(() => {
    const from = lastIndex.current;
    lastIndex.current = index;
    if (index !== 2 || from >= 2 || frameModeRef.current) return;
    if (bootedByClip.current) {
      bootedByClip.current = false;
      return;
    }
    setBoot((n) => n + 1);
  }, [index]);


  /* The clip is held on its last frame until the landed section has painted
     in the matching state; then it fades away. Prime the clip the next
     boundary would need, so the first play starts without a stall. */
  /* The handoff holds its last frame until the index underneath has painted -
     the lines land exactly on the real titles, so this is a same-place
     cross-fade rather than a reveal. */
  useEffect(() => {
    if (!handoffOut.current) return;
    const was = handoffOut.current;
    handoffOut.current = false;
    if (was !== "down") return;
    /* Start the hand-over fade at once. It used to wait 240ms, and with the
       overlay then taking another 420ms the index spent its whole build-in
       behind a black sheet - the rules drawing and the numbers arriving were
       simply never seen. */
    const t = window.setTimeout(() => handoff.current?.hide(), 40);
    return () => window.clearTimeout(t);
  }, [index]);

  useEffect(() => {
    const next = index === 1 ? CLIPS.kbToMachine : index === 2 ? CLIPS.machineToKb : null;
    if (hideAfterLand.current) {
      hideAfterLand.current = false;
      /* fade the held frame first; priming reloads the element, and a
         reload mid-fade would flash. */
      const t1 = window.setTimeout(() => player.current?.hide(), 260);
      const t2 = window.setTimeout(() => next && player.current?.prime(next), 700);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    if (next) player.current?.prime(next);
  }, [index]);

  /* Which way the keyboard section was entered. Scrolling DOWN into it plays
     the intro (blackout, lamp strike, the board standing up); coming back UP
     from a later section finds it already lit and posed. Remembered per
     entry, so the flag holds for the whole visit and only re-evaluates on
     the next arrival. */
  const prevIndex = useRef(index);
  /* `?frame=` also drives plate rendering, so it has to be readable during
     render, not just inside the mount effect. */
  const frameMode = useMemo(
    () => (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("frame")),
    [],
  );
  frameModeRef.current = frameMode;
  const kbFromBelow = useRef(false);
  if (index !== prevIndex.current) {
    if (index === 1) kbFromBelow.current = prevIndex.current > 1;
    prevIndex.current = index;
  }

  /* The RAG model is NOT preloaded here any more (Brian, 2026-10-20): it
     downloads on demand when the machine is reached, and the boot screen's
     progress bar shows the real load. See ragEngine.ts and RagSection. */
  useEffect(() => {
    // clean-plate rendering for the transition clips: land on the machine
    const frame = new URLSearchParams(location.search).get("frame");
    if (frame === "kb" || frame === "kb-ui") {
      /* `kb`    - bare board, no page furniture at all (the original plates).
         `kb-ui` - board WITH the section's own copy ("WHAT I WORK IN",
                   "HOVER A KEY", the caption) but WITHOUT the nav, dots and
                   cursor. That split matters: the nav and dots are z-50 and
                   deliberately stay ON TOP of the clip, so if they were baked
                   into the plate the live ones would sit over a drawn copy
                   that the wipe then erases. The section copy is underneath
                   the overlay, so the wipe CAN erase it - which is the beat
                   Brian wanted instead of the text popping off at the cut. */
      document.documentElement.classList.add(
        frame === "kb-ui" ? "is-framing-kb-ui" : "is-framing-kb",
      );
      goTo(1, false);
    } else if (frame === "hero" || frame === "hero-ui") {
      /* The hero at rest: the start frame for a hero->keyboard clip. Same
         split as the board plates above - `hero` is the bare object on the
         sheet, `hero-ui` keeps the section's own type and annotation (which
         the wipe is allowed to erase) but still drops the nav, dots and
         cursor (which stay live on top of the clip). On the photo hero,
         `hero` is the bare photo: no name, no rails, no eruption. */
      document.documentElement.classList.add(
        frame === "hero-ui" ? "is-framing-hero-ui" : "is-framing-hero",
      );
      goTo(0, false);
    } else if (frame) goTo(2, false);

    /* Plate capture MUST nudge the r3f canvas to re-measure.
       react-three-fiber sizes the <canvas> from its container once, with an
       inline width/height, and the canvas carries no class - the
       `.kb__canvas { width:100% !important }` rule applies to r3f's WRAPPER
       div, not to the canvas - so a stale first measurement is never
       corrected. In `?frame=kb` it settles at 1824.37x1026.21 inside a
       1852.44x1042 container: the whole scene rendered ~1.6% small and
       top-left anchored, which is EXACTLY the error baked into
       public/shots/transition-kb-start.png and inherited by every clip
       generated from it (docs/transition-kb-machine.md 16).
       One resize event snaps it to the container. Normal browsing is not
       affected - the canvas measures correctly there - so this is scoped to
       the plate modes, where a silently wrong plate is expensive. */
    if (!frame) return;
    /* One nudge is not enough - it can land while layout is still settling
       (measured: 1824.37 -> 1847.61, still 4.8px short). Retry until the
       canvas actually matches its container, then stop. */
    let tries = 0;
    const tick = window.setInterval(() => {
      /* Whichever section this plate is of. A hero that owned an r3f canvas
         would mis-measure in exactly the same way; the photo hero has none,
         so it is ready at once. */
      const hero = document.documentElement.className.includes("is-framing-hero");
      const canvas = document.querySelector<HTMLCanvasElement>(
        hero ? ".hx__frame canvas" : ".panel--void canvas",
      );
      const box = document.querySelector<HTMLElement>(
        hero ? ".hx__frame" : ".panel--void .kb",
      );
      if (hero && box && !canvas) {
        window.clearInterval(tick);
        document.documentElement.setAttribute("data-plate-ready", "1");
        return;
      }
      if (canvas && box) {
        const c = canvas.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (Math.abs(c.width - b.width) < 0.5 && Math.abs(c.height - b.height) < 0.5) {
          window.clearInterval(tick);
          document.documentElement.setAttribute("data-plate-ready", "1");
          return;
        }
      }
      window.dispatchEvent(new Event("resize"));
      if (++tries > 20) window.clearInterval(tick);
    }, 250);
    return () => window.clearInterval(tick);
  }, [goTo]);

  return (
    <>
      <div className="grain" />
      <Cursor />
      <TransitionPlayer ref={player} />
      <TerminalHandoff ref={handoff} />
      <SceneCuts ref={cuts} />
      {askFrame && (
        <div className="framechoice" role="dialog" aria-label="Display choice">
          <p className="framechoice__title">Ultrawide display</p>
          <p className="framechoice__body">
            The transitions between sections are 16:9 films. Play the site in a 16:9 frame
            with bars at the sides, or keep it full width with hard cuts?
          </p>
          <div className="framechoice__row">
            <button
              type="button"
              data-cursor="hover"
              onClick={() => {
                setBoxed(true);
                setAskFrame(false);
              }}
            >
              16:9 frame
            </button>
            <button
              type="button"
              data-cursor="hover"
              onClick={() => {
                setBoxed(false);
                setAskFrame(false);
              }}
            >
              Full width, hard cuts
            </button>
          </div>
        </div>
      )}

      <div className="app">
        <motion.nav
          className="nav"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease, delay: 0.2 }}
        >
          <div className="nav__links">
            {/* No Sound toggle: the site is silent (Brian, 2026-11-25 - the
                keycap clicks were the last sound left). */}
            <Magnetic>
              <a href={profile.github} target="_blank" rel="noreferrer" data-cursor="hover">
                GitHub
              </a>
            </Magnetic>
            <Magnetic>
              <a href={`mailto:${profile.email}`} data-cursor="hover">
                Email
              </a>
            </Magnetic>
            {/* LinkedIn, not a resume download (Brian, 2026-11-25): recruiters
                already have the resume, a redacted one says little, and it
                would go stale - LinkedIn he keeps current himself. */}
            <Magnetic>
              <a href={profile.linkedin} target="_blank" rel="noreferrer" data-cursor="hover">
                LinkedIn
              </a>
            </Magnetic>
            {/* Every section boundary gets a clip; this is the one switch for
                all of them, as a switch rather than words, rightmost
                (Brian, 2026-11-25). Session memory only. */}
            <button
              type="button"
              role="switch"
              className="nav__switch"
              data-cursor="hover"
              aria-checked={clips}
              aria-label="Motion: section transitions"
              onClick={() => setClips(toggleTransitions())}
            >
              <span>Motion</span>
              <i className={`nav__track ${clips ? "is-on" : ""}`} aria-hidden="true">
                <b />
              </i>
            </button>
          </div>
        </motion.nav>

        <Panel id="top" active={index === 0}>
          <Hero active={index === 0} />
        </Panel>

        <Panel id="craft" active={index === 1} className="panel--void">
          {/* parkStanding: from below the keyboard, the next visit arrives from below and skips the intro */}
          <KeyboardScene active={index === 1} skipIntro={kbFromBelow.current} parkStanding={index > 1} />
        </Panel>

        <Panel id="ask" active={index === 2}>
          <RagSection active={index === 2} boot={boot} leaving={leaving} />
        </Panel>

        <Panel id="work" active={index === 3} className="panel--work">
          <WorkIndex active={index === 3} handed={handed} lifting={lifting} />
        </Panel>

        <Panel id="contact" active={index === 4} className="panel--sheet">
          {/* the ground floor: credits, and an elevator back up to the hero */}
          <GroundFloor active={index === 4} onRideUp={() => goTo(0, false)} />
        </Panel>

        {/* Where you are, and a way to jump. */}
        <nav className="dots" aria-label="Sections">
          {SECTIONS.map((s, i) => (
            <button
              key={s}
              className={`dots__dot ${i === index ? "is-on" : ""}`}
              aria-label={s}
              aria-current={i === index}
              data-cursor="hover"
              onClick={() => goTo(i)}
            />
          ))}
        </nav>
      </div>
    </>
  );
}
