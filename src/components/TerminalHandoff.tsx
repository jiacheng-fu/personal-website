import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { projects } from "../data/content";
import { setNavLocked } from "../lib/transitions";
import "./TerminalHandoff.css";

/* ---------------------------------------------------------------------------
   RAG <-> Projects: the terminal hands off

   DOWN. The machine is asked for the work and the answer it prints IS the next
   section: the prompt types `ls ~/work`, the four names come back as green
   mono output, the room goes black, and those same lines travel to where the
   project index will be and turn into it - mono becoming Instrument Serif on
   the way. The site's two voices are the machine's and its own, so the handoff
   is one speaking and the other answering.

   UP is NOT that run backwards. Going back you return to the same terminal
   with the session still on it - `ls ~/work` and its output are still there,
   the way a shell keeps what you typed - and a NEW command is entered that
   starts the archive up again. Reversing the fall would have implied the index
   unwrote itself, which is not what happened; the machine was left running.

   No clips, no credits: every beat is type moving, which the browser does
   better than any generator.

   THE MORPH
   Font-family cannot be interpolated, so each name renders TWICE - mono and
   serif - stacked at one origin and cross-faded. Both layers carry the FINAL
   size and the wrapper scales up from monoSize/serifSize, so the mono layer
   measures its true terminal size at rest and genuinely grows. Scaling the
   wrapper keeps it off the layout path.
   --------------------------------------------------------------------------- */

export type HandoffHandle = {
  /** Down: play the handoff. Resolves when the page may land on projects. */
  run: () => Promise<void>;
  /** Up: cover the move. Resolves as soon as the black is safely over. */
  runBack: () => Promise<void>;
  /** Down: fade the held frame away once the index has painted under it. */
  hide: () => void;
};

/* down: type -> print (at the terminal) -> fly (to the index)
   up:   out (on the index) -> back (to the terminal) -> type the new command */
type Phase = "idle" | "type" | "print" | "fly" | "out" | "back";

const CMD_DOWN = "ls ~/work";
const CMD_BACK = "./ragsetup.py";
const MONO = 13;

/* Seconds.

   Typing is priced PER CHARACTER rather than given a fixed slot: a flat
   duration made `ls ~/work` rattle out at 40ms a key and would have made the
   much longer command coming back rattle out even faster. At ~105ms it reads
   as someone actually typing, and both commands take as long as their own
   length says they should. */
const T = {
  perChar: 0.105,
  /** names print, staggered */
  print: 0.62,
  /** the output is left up to be read before anything moves */
  hold: 0.85,
  /** beat between the room going dark and the lines leaving */
  flyGap: 0.22,
  /** keep in step with the transform duration in the stylesheet */
  fly: 1.05,
  tail: 0.24,
};
const typeDur = (t: string) => t.length * T.perChar;

type Line = {
  label: string;
  /** where the terminal prints it */
  termX: number;
  termY: number;
  /** where the index sets it */
  idxX: number;
  idxY: number;
  /** mono size / serif size */
  scale0: number;
  /** the serif size */
  size: number;
};

/** The same measure the nav lands on, so our arithmetic and its scroll agree. */
const panelTop = (i: number) => {
  const el = document.querySelectorAll<HTMLElement>(".panel")[i];
  return el ? el.offsetTop : i * window.innerHeight;
};

/** Where a rect will be once the page has scrolled to `landAt`. */
const afterScroll = (r: DOMRect, landAt: number) => ({
  x: r.left,
  y: r.top + window.scrollY - landAt,
});

/** The translate an element is currently carrying, so a measurement taken
 *  mid-animation can be corrected back to where the element RESTS. */
const carried = (el: Element | null) => {
  if (!el) return { x: 0, y: 0 };
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(t);
  return { x: m.e, y: m.f };
};

const TerminalHandoff = forwardRef<HandoffHandle>(function TerminalHandoff(_, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [dir, setDir] = useState<"down" | "up">("down");
  const [phase, setPhase] = useState<Phase>("idle");
  /* Is the machine actually on screen yet? Going up it is not: the page has
     not scrolled, so anything drawn at the glass's landed position would be
     floating over the projects section. The prompt used to appear there from
     the first frame - green text over a black page, before the room existed. */
  const [revealed, setRevealed] = useState(false);
  const timers = useRef<number[]>([]);

  const at = (s: number, fn: () => void) =>
    timers.current.push(window.setTimeout(fn, s * 1000));
  const clearAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  /* Put everything back exactly as found. Called at the START of a run too:
     a gesture during a half-played scene used to leave its timers running
     against a section that had already gone, which is what made the animation
     "break" rather than simply restart. */
  const reset = (h: HTMLDivElement) => {
    clearAll();
    setNavLocked(false);
    h.classList.remove("is-on", "is-dark", "is-out", "is-instant", "is-back");
    document.querySelector(".rag")?.classList.remove("is-handoff");
    setPhase("idle");
    setRevealed(false);
    setLines(null);
  };

  /** Both ends of the journey, in viewport coordinates the overlay can use.
   *
   *  Which end needs converting is the whole subtlety, and it was worth a bug:
   *  a rect is only usable as-is if that thing is ON SCREEN NOW. Going down the
   *  machine is in front of us and the index is a screen below, so the index is
   *  the one to project forward. Going up it is the other way round - and the
   *  scene scrolls the page itself before revealing anything, so there the
   *  glass is the projected one. Getting this backwards printed the output a
   *  full viewport above the fold, where it was typed, held and flown in from
   *  somewhere nobody could see. */
  const measure = (dir: "down" | "up") => {
    const glassEl = document.querySelector(".a2m__screen");
    const titles = [...document.querySelectorAll<HTMLElement>(".wx__title")];
    if (!glassEl || titles.length < projects.length) return null;

    const down = dir === "down";
    const landAt = panelTop(down ? 3 : 2);
    const gr = glassEl.getBoundingClientRect();
    const g = down ? { x: gr.left, y: gr.top } : afterScroll(gr, landAt);

    return projects.map((p, i) => {
      const r = titles[i].getBoundingClientRect();
      const size = parseFloat(getComputedStyle(titles[i]).fontSize);
      /* If the index has not been arrived at yet its rows are still in their
         entrance pose - translated down and transparent - which put every
         landing 26px low. Subtract whatever the row is carrying and it is
         exact, whatever that entrance is later changed to. */
      const off = carried(titles[i].closest("li"));
      const t = down ? afterScroll(r, landAt) : { x: r.left, y: r.top };
      return {
        label: p.title,
        termX: g.x + gr.width * 0.055,
        termY: g.y + gr.height * 0.32 + i * (MONO * 1.9),
        idxX: t.x - off.x,
        idxY: t.y - off.y,
        scale0: MONO / size,
        size,
      } as Line;
    });
  };

  useImperativeHandle(ref, () => ({
    /* ------------------------------- DOWN ------------------------------- */
    run() {
      const h = host.current;
      if (!h) return Promise.resolve();
      const next = measure("down");
      if (!next) return Promise.resolve();

      /* reset() FIRST - it is a full teardown and removes `is-handoff` among
         everything else, so clearing the glass before it just had the glass
         un-cleared a line later, and the boot menu sat under the command being
         typed over it. */
      reset(h);
      setNavLocked(true);

      /* Now clear the glass: the boot menu and the live prompt are still on it,
         and printing over them reads as two terminals fighting rather than one
         answering. Faded, not unmounted - the section is not ours. */
      document.querySelector(".rag")?.classList.add("is-handoff");

      setDir("down");
      setLines(next);
      setRevealed(true); // the machine is right there in front of us
      setPhase("type");
      h.classList.add("is-on");

      const tt = typeDur(CMD_DOWN);
      at(tt, () => setPhase("print"));
      at(tt + T.print + T.hold, () => h.classList.add("is-dark"));
      at(tt + T.print + T.hold + T.flyGap, () => setPhase("fly"));
      return new Promise<void>((res) =>
        at(tt + T.print + T.hold + T.flyGap + T.fly + T.tail, res)
      );
    },

    hide() {
      const h = host.current;
      if (!h) return;
      /* Still locked: the index is painting in underneath and this frame is
         cross-fading off it. A gesture here would jump out of a hand-over
         that is still visibly happening. */
      setNavLocked(true);
      h.classList.add("is-out");
      /* reset() and not an inline teardown: it is the single place that both
         clears the classes AND releases the nav lock. Duplicating it here is
         exactly how the lock leaked and left the page unable to move. */
      at(0.42, () => reset(h));
    },

    /* -------------------------------- UP -------------------------------- */
    /* Only job: get the black up before the page jumps. Everything the visitor
       actually watches happens after landing, in backReveal - the machine
       cannot be revealed until the page is standing in front of it. */
    runBack() {
      const h = host.current;
      if (!h) return Promise.resolve();
      const next = measure("up");
      if (!next) return Promise.resolve();

      reset(h);
      setNavLocked(true);
      document.querySelector(".rag")?.classList.add("is-handoff");
      setDir("up");
      setLines(next);
      setPhase("out"); // standing on the index, in serif, exactly as drawn
      h.classList.add("is-back", "is-on");

      const tb = typeDur(CMD_BACK);
      /* This promise covers the ENTIRE scene, not just the covered jump. The
         nav keeps its lock only until the gate resolves, so resolving early -
         tempting, because the machine cannot be revealed until the page is in
         front of it - left a second and a half in which another gesture was
         accepted, skipped a section, and left this playing against a page that
         had moved on. The page is landed HERE instead, under the black. */
      return new Promise<void>((res) => {
        // the titles lift off the index and fly back into the screen
        at(0.1, () => setPhase("back"));
        at(0.34, () => h.classList.add("is-dark"));
        at(1.05, () => window.scrollTo(0, panelTop(2)));
        at(1.2, () => {
          h.classList.remove("is-dark");
          setRevealed(true); // the room is back; the glass may now be written on
        });
        // the machine is back, the old session still on its glass
        at(1.85, () => setPhase("type"));
        at(1.85 + tb + 0.34, () => {
          h.classList.add("is-out");
          document.querySelector(".rag")?.classList.remove("is-handoff");
        });
        /* Resolve BEFORE tearing down, and tear down last: reset() clears every
           pending timer, so scheduling it ahead of the resolve cancelled the
           resolve itself - the promise never settled, the nav never ran its
           setIndex, and React went on believing it was on the section this
           scene had already scrolled away from. */
        at(1.85 + tb + 0.78, res);
        at(1.85 + tb + 1.0, () => reset(h));
      });
    },

  }));

  const back = dir === "up";
  /* One vocabulary for both directions:
       at the terminal   = held small and mono, in the glass
       at the index      = full size, serif, on the page
     Down runs term -> idx; up runs idx -> term. */
  const atTerm = phase !== "fly" && phase !== "out";
  const serifInk = phase === "fly" || phase === "out";
  const moving = phase === "fly" || phase === "back";
  const linesVisible = back ? phase !== "idle" : phase === "print" || phase === "fly";

  const cmdText = back ? CMD_BACK : CMD_DOWN;
  const typing = phase === "type";

  return (
    <div className="handoff" ref={host} aria-hidden>
      {/* the room going out - covers paper, machine, nav and all */}
      <div className="handoff__black" />

      {lines && (
        <>
          {/* Coming back up, the command from last time is still in the
              scrollback above the new one. */}
          {back && (
            <div
              className={`handoff__cmd is-done ${revealed ? "is-in" : ""}`}
              style={{ left: lines[0].termX, top: lines[0].termY - MONO * 2.6 }}
            >
              <span className="handoff__caret">]</span>
              <span className="handoff__typed handoff__typed--static">{CMD_DOWN}</span>
            </div>
          )}

          <div
            className={`handoff__cmd ${typing ? "" : "is-done"} ${
              back ? (!revealed ? "is-hidden" : typing ? "is-in" : "is-pending") : ""
            }`}
            style={{
              left: lines[0].termX,
              top: back
                ? lines[lines.length - 1].termY + MONO * 2.4
                : lines[0].termY - MONO * 2.6,
            }}
          >
            <span className="handoff__caret">]</span>
            <span
              className="handoff__typed"
              style={
                {
                  ["--cmd-len" as string]: `${cmdText.length}`,
                  ["--type-dur" as string]: `${typeDur(cmdText)}s`,
                } as React.CSSProperties
              }
            >
              {cmdText}
            </span>
            <span className="handoff__cursor" />
          </div>

          {lines.map((l, i) => (
            <div
              key={l.label}
              className={`handoff__line ${linesVisible ? "is-in" : ""} ${
                moving ? "is-moving" : ""
              } ${serifInk ? "is-serif" : "is-mono"}`}
              style={{
                /* Positioned at the INDEX and transformed back to the glass, so
                   whichever direction is running, the page-side end is the one
                   that needs no arithmetic and lands exactly. */
                left: l.idxX,
                top: l.idxY,
                fontSize: l.size,
                transform: atTerm
                  ? `translate3d(${l.termX - l.idxX}px, ${l.termY - l.idxY}px, 0) scale(${l.scale0})`
                  : "translate3d(0,0,0) scale(1)",
                transitionDelay: `${(moving ? 0.07 : 0.11) * (back ? lines.length - 1 - i : i)}s`,
              }}
            >
              <span className="handoff__mono">{l.label}</span>
              <span className="handoff__serif">{l.label}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
});

export default TerminalHandoff;
