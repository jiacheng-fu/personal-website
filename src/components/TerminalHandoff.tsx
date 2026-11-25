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
/* Fallbacks only. The real size, line and face are read off the machine's
   glass every run (see `glassType`): the glass sits inside CSS transforms
   whose scale changes with the window, so a fixed 13px printed `ls ~/work`
   visibly smaller than the session it was typed into, in another font, and
   the scroll - applied INSIDE the scaled glass - came up short, so the names
   printed over text that had not moved out of their way (Brian, 2026-11-25). */
const MONO = 13;
const LINE = MONO * 1.9;

type TermType = { mono: number; line: number; family: string; scale: number };

/** The glass's on-screen text size, line pitch and face, and its scale. */
function glassType(glass: HTMLElement): TermType {
  const scale = glass.getBoundingClientRect().width / (glass.offsetWidth || 1) || 1;
  const sample = document.querySelector<HTMLElement>(
    ".a2-prompt input, .a2-prompt, .a2-boot__line, .a2-speech__text, .a2-perf__query",
  );
  const cs = sample ? getComputedStyle(sample) : null;
  const fs = cs ? parseFloat(cs.fontSize) : NaN;
  const lh = cs ? parseFloat(cs.lineHeight) : NaN;
  if (!cs || !fs) return { mono: MONO, line: LINE, family: "", scale };
  return {
    mono: fs * scale,
    line: (lh || fs * 1.32) * scale,
    family: cs.fontFamily,
    scale,
  };
}

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
  const [term, setTerm] = useState<TermType>({ mono: MONO, line: LINE, family: "", scale: 1 });
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
    const rag = document.querySelector<HTMLElement>(".rag");
    rag?.classList.remove("is-handoff", "is-continuing", "is-scrolled", "is-cleared");
    document.documentElement.style.removeProperty("--handoff-scroll");
    document.documentElement.style.removeProperty("--handoff-scroll-screen");
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
    const glassEl = document.querySelector<HTMLElement>(".a2m__screen");
    /* The live prompt is where a person would actually be typing, so it is
       what the typed command is anchored to. Falling back to a fraction of the
       glass keeps the scene working while the machine is still booting and the
       prompt has not been drawn yet. */
    const promptEl = document.querySelector(".a2-prompt");
    const titles = [...document.querySelectorAll<HTMLElement>(".wx__title")];
    if (!glassEl || titles.length < projects.length) return null;

    const down = dir === "down";
    const tt = glassType(glassEl);
    setTerm(tt);
    const LINE = tt.line;
    const landAt = panelTop(down ? 3 : 2);
    const gr = glassEl.getBoundingClientRect();
    const g = down ? { x: gr.left, y: gr.top } : afterScroll(gr, landAt);

    /* Where the output lands, in the terminal's own coordinates.
    
       The handoff used to wipe the glass and type onto a blank screen a third
       of the way down it, which is the one thing a terminal never does - the
       session was simply gone, and `ls ~/work` arrived in a void. Now the
       command is typed AT the prompt, on top of whatever the machine already
       had on it, and the four names print underneath. There is no room
       underneath, of course; that is what the scroll is for. */
    const pr = down ? promptEl?.getBoundingClientRect() : null;
    /* Down: anchored to the live prompt, because the session is still on the
       glass and the command has to land on the line the cursor is really on.
    
       Up: NOT anchored to it. There the overlay redraws the whole session from
       scratch on a blank glass and then types a NEW command underneath the
       output - anchoring to the prompt put that new line below the prompt,
       which on this machine is the status bar. It keeps the original placement,
       a third of the way down, which leaves room under the output for the
       command that follows it. */
    const anchor = pr
      ? { x: pr.left, y: pr.top }
      : {
          x: g.x + gr.width * 0.055,
          y: g.y + gr.height * 0.32 + (projects.length - 1) * LINE,
        };

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
        termX: anchor.x,
        /* the last name comes to rest on the line the prompt was on, so the
           output fills the space the session just scrolled out of */
        termY: anchor.y - (projects.length - 1 - i) * LINE,
        idxX: t.x - off.x,
        idxY: t.y - off.y,
        scale0: tt.mono / size,
        size,
      } as Line;
    });
  };

  useImperativeHandle(ref, () => ({
    /* ------------------------------- DOWN ------------------------------- */
    run() {
      const h = host.current;
      if (!h) return Promise.resolve();
      /* a boot still typing finishes now, so there is a prompt to type on and
         nothing left printing under the command (RagSection, rag:handoff) */
      window.dispatchEvent(new Event("rag:handoff"));
      const next = measure("down");
      if (!next) return Promise.resolve();
      const gt = glassType(document.querySelector<HTMLElement>(".a2m__screen")!);

      /* reset() FIRST - it is a full teardown and removes `is-handoff` among
         everything else, so clearing the glass before it just had the glass
         un-cleared a line later, and the boot menu sat under the command being
         typed over it. */
      reset(h);
      setNavLocked(true);

      /* Going down the glass is NOT cleared. The session stays exactly where
         it was and the command is typed at the foot of it, because that is
         what typing into a terminal looks like; only the live prompt itself
         goes, and only because the overlay is about to draw one in its place.
         The scroll distance is published as a custom property so the section's
         own stylesheet can move the content and the overlay can move its
         command by the same amount. */
      const ragEl = document.querySelector<HTMLElement>(".rag");
      /* On the ROOT, not on `.rag`. The overlay is a fixed layer at the top of
         the document and not a descendant of the section, so a property set on
         the section never reaches it - the command lost its offset, was drawn
         four lines high and typed itself straight through the boot menu. Both
         subtrees read it from here. */
      /* Two lengths for one scroll: the session moves INSIDE the scaled
         glass, so it gets the output's height in the glass's own pixels; the
         overlay's command moves on the page, so it gets screen pixels. */
      document.documentElement.style.setProperty(
        "--handoff-scroll",
        `${(projects.length * gt.line) / gt.scale}px`
      );
      document.documentElement.style.setProperty(
        "--handoff-scroll-screen",
        `${projects.length * gt.line}px`
      );
      ragEl?.classList.add("is-continuing");
      /* An answer still being played out keeps growing under the command
         (more lines, the acts changing), so that session is cleared instead. */
      if (ragEl?.hasAttribute("data-busy")) ragEl.classList.add("is-cleared");

      setDir("down");
      setLines(next);
      setRevealed(true); // the machine is right there in front of us
      setPhase("type");
      h.classList.add("is-on");

      const tt = typeDur(CMD_DOWN);
      at(tt, () => {
        /* Enter. The session slides up by exactly the height of the output
           about to be printed, the top of it clipped away by the tube, and the
           names arrive in the space it left. */
        ragEl?.classList.add("is-scrolled");
        setPhase("print");
      });
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
      /* Coming back the overlay IS the screen - it redraws the whole session
         from scratch over a machine that is not there yet - so here the real
         glass does stay blanked. */
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
        at(1.2, () => h.classList.remove("is-dark"));
        /* The room comes up first, and the phosphor after it.
        
           These used to happen in the same frame, and the blackout takes 0.55s
           to lift - so for most of that half second the brightest thing on
           screen was a green command line hanging in front of a machine that
           was still black. It read as a glow stick in a dark room rather than
           as a terminal someone had left running. Letting the case and the
           glass arrive first and lighting the session up against them puts the
           two in the right order: the room, then what is on its screen.
        
           1.74s is deliberate rather than "a bit later": the blackout is
           removed at 1.2 and takes 0.55s to lift, so this is the first moment
           the room is all the way back. The phosphor then warms up against a
           machine that is already there, which is the order a real one comes
           back in. */
        at(1.74, () => setRevealed(true));
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
    <div
      className="handoff"
      ref={host}
      aria-hidden
      style={
        {
          ["--ho-mono" as string]: `${term.mono}px`,
          ...(term.family ? { ["--ho-family" as string]: term.family } : {}),
        } as React.CSSProperties
      }
    >
      {/* the room going out - covers paper, machine, nav and all */}
      <div className="handoff__black" />

      {lines && (
        <>
          {/* Coming back up, the command from last time is still in the
              scrollback above the new one. */}
          {back && (
            <div
              className={`handoff__cmd is-done ${revealed ? "is-in" : ""}`}
              style={{ left: lines[0].termX, top: lines[0].termY - term.mono * 2.6 }}
            >
              <span className="handoff__caret">]</span>
              <span className="handoff__typed handoff__typed--static">{CMD_DOWN}</span>
            </div>
          )}

          <div
            className={`handoff__cmd ${typing ? "" : "is-done"} ${
              back ? (!revealed ? "is-hidden" : typing ? "is-in" : "is-pending") : ""
            } ${!back && typing ? "is-unscrolled" : ""}`}
            style={{
              left: lines[0].termX,
              /* Down: one line above the first name, which after the scroll is
                 four lines above where the prompt was. While it is still being
                 typed `is-unscrolled` holds it down at the prompt, so the
                 command is typed where the cursor really is and then rides up
                 with the rest of the session. */
              top: back
                ? lines[lines.length - 1].termY + term.mono * 2.4
                : lines[0].termY - term.line,
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
