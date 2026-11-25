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
import { soundEnabled, toggleSound } from "./data/keySound";
import { CLIPS, transitionAllowed, transitionsEnabled, toggleTransitions, initFrame, isUltrawide, setBoxed } from "./lib/transitions";
import ContactSheet from "./components/ContactSheet";
import { warmModel } from "./lib/ragEngine";
import TransitionPlayer, { type TransitionHandle } from "./components/TransitionPlayer";
import TerminalHandoff, { type HandoffHandle } from "./components/TerminalHandoff";
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

function KeyboardScene({ active, skipIntro }: { active: boolean; skipIntro: boolean }) {
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
      <KeyboardSection skills={skills} active={active} skipIntro={skipIntro} onLight={handleLight} />
      <p className="field-note">
        Every key is something I&rsquo;ve shipped with.{" "}
        <span className="dim">Hover one.</span>
      </p>
    </div>
  );
}

/* The old Contact (headline + three text links) is gone: see
   components/ContactSheet.tsx - the machine prints the details instead. */


/* --------------------------------- app ----------------------------------- */

const SECTIONS = ["top", "craft", "ask", "work", "contact"] as const;

export default function App() {
  const reduce = useReducedMotion();

  // TEMP (debug): Space pauses/resumes the transition clip; , and . step a
  // frame while paused. Delete this effect and the import to remove.
  useEffect(() => installDebugPause(), []);

  const [sound, setSound] = useState(soundEnabled());
  const [clips, setClips] = useState(transitionsEnabled());

  /* Section-transition clips (docs/transition-kb-machine.md). The nav's gate
     holds a move while the clip plays over the page, then lands instantly.
     `boot` ticks when the keyboard->machine clip ends so the machine section
     wakes from a dark screen instead of appearing already lit. */
  const player = useRef<TransitionHandle>(null);
  /* RAG -> projects is not a clip: the terminal prints the work and the lines
     become the index. Same gate, no video. */
  const handoff = useRef<HandoffHandle>(null);
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
  const gate = useCallback((from: number, to: number) => {
    if (!transitionAllowed() || !player.current) return null;
    const p = player.current;
    const kbPanel = document.querySelector(".panel--void");
    if (from === 1 && to === 2) {
      /* the section's own text fades first; the clip has none of it */
      kbPanel?.classList.add("is-departing");
      return new Promise<void>((r) => window.setTimeout(r, 220))
        .then(() => p.play(CLIPS.kbToMachine))
        .then(() => {
          bootedByClip.current = true;
          setBoot((n) => n + 1);
          hideAfterLand.current = true;
          window.setTimeout(() => kbPanel?.classList.remove("is-departing"), 800);
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
    }
    return null;
  }, []);

  // Reduced motion keeps native scrolling; hijacking it would be hostile.
  const { index, goTo } = useSectionNav(SECTIONS.length, !reduce, gate);

  /* The model's download starts the instant the site is landed on, and the
     rest follows as soon as the visitor moves past the hero (ragEngine.ts,
     WHEN IT LOADS). Only downloads: the GPU work waits for the machine. */
  useEffect(() => warmModel("landing"), []);
  useEffect(() => {
    if (index >= 1) warmModel("rest");
  }, [index]);
  /* Under reduced motion the section nav is off and `index` never moves, so
     "past the hero" is read from the scroll position instead. */
  useEffect(() => {
    if (!reduce) return;
    const onScroll = () => {
      if (window.scrollY < window.innerHeight * 0.5) return;
      warmModel("rest");
      window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduce]);

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
      const canvas = document.querySelector<HTMLCanvasElement>(".panel--void canvas");
      const box = document.querySelector<HTMLElement>(".panel--void .kb");
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
          <a
            className="nav__mark"
            href="#top"
            data-cursor="hover"
            onClick={(e) => {
              e.preventDefault();
              goTo(0);
            }}
          >
            <span className="nav__dot" />
            {profile.name}
          </a>
          <div className="nav__links">
            {/* Site-wide, because the keycap clicks and the stage lamp both
                use it. On by default; browsers stay silent until the first
                interaction regardless, which keySound primes for. */}
            <button
              type="button"
              className="nav__sound"
              data-cursor="hover"
              aria-pressed={sound}
              aria-label={sound ? "Turn sound off" : "Turn sound on"}
              onClick={() => setSound(toggleSound())}
            >
              Sound {sound ? "on" : "off"}
            </button>
            {/* Every section boundary gets a clip; this is the one switch
                for all of them. Session memory only, like sound. */}
            <button
              type="button"
              className="nav__sound"
              data-cursor="hover"
              aria-pressed={clips}
              aria-label={clips ? "Turn transitions off" : "Turn transitions on"}
              onClick={() => setClips(toggleTransitions())}
            >
              Motion {clips ? "on" : "off"}
            </button>
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
          </div>
        </motion.nav>

        <Panel id="top" active={index === 0}>
          <Hero active={index === 0} onWork={() => goTo(3)} />
        </Panel>

        <Panel id="craft" active={index === 1} className="panel--void">
          <KeyboardScene active={index === 1} skipIntro={kbFromBelow.current} />
        </Panel>

        <Panel id="ask" active={index === 2}>
          <RagSection active={index === 2} boot={boot} leaving={leaving} />
        </Panel>

        <Panel id="work" active={index === 3} className="panel--work">
          <WorkIndex active={index === 3} handed={handed} lifting={lifting} />
        </Panel>

        <Panel id="contact" active={index === 4} className="panel--sheet">
          <ContactSheet active={index === 4} plate={frameMode === "sheet"} />
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
