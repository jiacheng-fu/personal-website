import { isNavLocked } from "../lib/transitions";
import { isClipBusy } from "../lib/transitions";
import { useCallback, useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
   Section navigation

   Scroll is a trigger, not a scrubber: one wheel gesture, swipe, or arrow key
   moves exactly one section, and the page glides there. Nothing scrolls
   "within" a section - each is a single viewport and its animation runs on its
   own clock once it becomes active.

   Native scrolling is suppressed while this is on; that is the whole point,
   but it means the escape hatches have to be deliberate:
     - prefers-reduced-motion turns the whole thing off (native scroll returns)
     - the jump is animated with a real easing curve, not scroll-behavior:smooth,
       so the duration is known and the lock can be released exactly on arrival
     - anchor links and focus still work through goTo()
   --------------------------------------------------------------------------- */

const DURATION = 850; // ms per section jump
const WHEEL_MIN = 6; // ignore trackpad jitter
/* Was a 300 ms dead time after arriving. Removed with the rest of the
   cooldown system: the animation itself already holds `busy`, and anything
   longer only made the page feel unresponsive. */
const COOLDOWN = 0;
/* Ceiling on how long a gate may hold the nav. Longer than the slowest scene
   we ship (the ~4.5 s transition clip, the ~4 s terminal handoff) so it never
   cuts a healthy one short: it exists only to guarantee the page cannot be
   stranded by a gate that fails or hangs. */
const GATE_FAILSAFE = 12000;

/** Ease-in-out cubic: leaves rest gently, arrives gently. */
function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Where a section actually starts.
 *
 *  Measured off the element rather than computed as index * innerHeight.
 *  Going fullscreen fires `resize` BEFORE the 100svh panels have reflowed, so
 *  the computed offset is a viewport stale at exactly the moment it is used -
 *  the page lands part way between two panels and you get one section filling
 *  most of the screen with a band of the next below it. Reading offsetTop is
 *  always right, whatever the layout is doing. */
function sectionTop(i: number) {
  const el = document.querySelectorAll<HTMLElement>(".panel")[i];
  return el ? el.offsetTop : i * window.innerHeight;
}

/** Runs before a move and can hold it up. Return a promise to make the nav
 *  wait - the hero uses it to play the robot beat before handing over. */
export type Gate = (from: number, to: number) => Promise<void> | null | undefined;

/* The browser never restores the scroll on its own: left to it, a reload put
   the page back on, say, the projects while the nav (and every section's
   "active" state) started at the hero - titles never drawn, dots on the wrong
   section. The nav restores the section itself (RELOAD, below). */
if (typeof history !== "undefined" && "scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

/* Trackpad momentum. One flick keeps sending wheel events for a second or more
   after the finger lifts, ever smaller. The plain scrolls (work <-> contact,
   hero <-> keyboard) finish inside that tail, and the tail then moved the page
   AGAIN - one flick from contact went past the projects into the machine.
   So a move spends its gesture: further events belong to it until the stream
   pauses (NEW_GESTURE_GAP) or the deltas grow again (a new flick, or a finger
   still pushing), which is what keeps deliberate continued scrolling moving -
   the reason the old quiet-period rule, which waited for a pause only, felt dead. */
const NEW_GESTURE_GAP = 160; // ms
/* The section this tab was on, so a reload comes back to it (see below). */
const SECTION_KEY = "nav:section";
const GROWTH = 1.4;

/* Boxes with their own scroll (the "Teach it something" note, the fragments
   list, a code block on the glass) are marked [data-scrollable]. They used to
   get every wheel and swipe over them, including ones they could not use: an
   empty note cannot scroll, so the browser scrolled the PAGE instead - 120px
   off the section, and the next wheel started the terminal handoff from
   there. Now a box keeps an event only while it has room to move that way. */
function boxOf(t: EventTarget | null) {
  return ((t as HTMLElement | null)?.closest?.("[data-scrollable]") as HTMLElement | null) ?? null;
}
function roomIn(el: HTMLElement, dy: number) {
  return dy > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
}

/* The machine's screen (Brian, 2026-11-25): "when your mouse is within the
   monitor, youre only scrolling the text within the RAG and you cannot trigger
   the next page/animation/transition. You can only trigger that when your
   mouse is outside and youre scrolling." Reading a long answer used to turn
   the page: at the end of the text the next flick ("is there more?") started
   the handoff to the projects, and over the glass but off the text box any
   wheel did. A [data-scroll-zone] is that screen: the wheel anywhere on it
   scrolls what is under it, or else its [data-scroll-main] text, and never the
   page. With nothing left to scroll it says where to scroll instead
   (data-edge on the zone, drawn by the section). */
function zoneOf(t: EventTarget | null) {
  return ((t as HTMLElement | null)?.closest?.("[data-scroll-zone]") as HTMLElement | null) ?? null;
}
/** Everything under the pointer that can scroll, innermost first: the
 *  [data-scrollable] boxes, then its zone's main text. */
function scrollersAt(t: EventTarget | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let el = boxOf(t); el; el = boxOf(el.parentElement)) out.push(el);
  const main = zoneOf(t)?.querySelector<HTMLElement>("[data-scroll-main]");
  if (main && !out.includes(main)) out.push(main);
  return out;
}
/** a wheel's deltaY in pixels, whatever unit the browser sent */
const wheelPx = (e: WheelEvent) => e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
const EDGE_HINT_MS = 1600;

export function useSectionNav(count: number, enabled: boolean, gate?: Gate) {
  const [index, setIndex] = useState(0);
  const busy = useRef(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  const gateRef = useRef<Gate | undefined>(gate);
  gateRef.current = gate;

  const goTo = useCallback(
    (target: number, animate = true) => {
      /* A transition still on screen owns the page. Checked here rather than
         in each handler because every move - wheel, key, touch, progress dot -
         comes through goTo. */
      if (isNavLocked()) return;
      const i = Math.max(0, Math.min(count - 1, target));
      /* One move at a time, whatever asked for it. The wheel used to be the
         only input that waited for a clip's fade-out (isClipBusy), and the
         progress dots did not even wait for a scroll in flight - a key or a
         dot click in that window started the next scene on top of this one,
         or two scroll animations that fought. Re-aligning to the section we
         are already on (after a resize) is not a move and is always allowed. */
      if ((busy.current || isClipBusy()) && i !== indexRef.current) return;
      const from = window.scrollY;
      const to = sectionTop(i);
      if (i === indexRef.current && Math.abs(from - to) < 2) return;

      /* A gate can hold the move open - the hero plays its exit to black
         before the keyboard arrives. Stay busy for the whole wait so a second
         gesture cannot queue another jump behind it, and land INSTANTLY when
         it resolves: the screen is already black by then, and animating a
         scroll nobody can see just delays the next section. */
      const held = gateRef.current?.(indexRef.current, i);
      if (held) {
        busy.current = true;
        /* The nav must NEVER be left locked by a gate.
           `busy` is only cleared when the held move lands, so a gate that
           REJECTS - or one that simply never settles, which is easy to write
           when the resolver hangs off an animation callback that might not
           fire - stranded the page: every later wheel, key and swipe was
           dropped and scrolling looked completely dead until a reload.

           Land on EITHER outcome, once, with a failsafe on top for the
           never-settles case. */
        let landed = false;
        const land = () => {
          if (landed) return;
          landed = true;
          setIndex(i);
          window.scrollTo(0, sectionTop(i));
          window.setTimeout(() => (busy.current = false), COOLDOWN);
        };
        held.then(land, (err) => {
          console.error("[nav] gate rejected; landing anyway", err);
          land();
        });
        window.setTimeout(land, GATE_FAILSAFE);
        return;
      }

      setIndex(i);
      if (!animate) {
        window.scrollTo(0, to);
        return;
      }

      busy.current = true;
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / DURATION);
        window.scrollTo(0, from + (to - from) * ease(p));
        if (p < 1) requestAnimationFrame(step);
        else {
          /* land on where the section is NOW: a resize during the glide
             moves it, and `to` was measured before */
          window.scrollTo(0, sectionTop(i));
          window.setTimeout(() => (busy.current = false), COOLDOWN);
        }
      };
      requestAnimationFrame(step);
    },
    [count]
  );

  /* RELOAD. The page and the nav are set together, by us, never left to the
     browser: a reload comes back to the section this tab was on, ARRIVED AT the
     way a progress-dot jump arrives (the nav starts at the hero for one render
     and then moves, so the app's arrival logic runs - the machine boots, the
     keyboard plays its intro, the index draws its titles). Before this, a
     reload could leave the page scrolled to one section while the nav sat on
     the hero: nothing on screen was ever activated, and it read as a black,
     broken page. A new tab still starts at the hero (sessionStorage), and the
     clip-plate renderer (?frame=) positions itself. */
  useEffect(() => {
    if (!enabled) return;
    let back = 0;
    try {
      back = Number(sessionStorage.getItem(SECTION_KEY)) || 0;
    } catch {
      /* storage blocked: start at the hero */
    }
    const plate = new URLSearchParams(location.search).has("frame");
    if (!plate && back > 0 && back < count && indexRef.current === 0) {
      indexRef.current = back;
      setIndex(back);
    }
    const realign = () => window.scrollTo(0, sectionTop(indexRef.current));
    realign();
    /* ...and again whenever the browser might have put the scroll back on its
       own: at `load` (a restore applied late, after the first frame) and on
       `pageshow` (a page brought back from the back/forward cache). A page
       scrolled to one section while the nav believes another is the black,
       "broken on reload" page - nothing on that section was ever activated. */
    window.addEventListener("load", realign);
    window.addEventListener("pageshow", realign);
    return () => {
      window.removeEventListener("load", realign);
      window.removeEventListener("pageshow", realign);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    try {
      sessionStorage.setItem(SECTION_KEY, String(index));
    } catch {
      /* ignore */
    }
  }, [index]);

  useEffect(() => {
    if (!enabled) return;
    const flick = { lastT: -1e9, lastAbs: 0, spent: false };
    let edgeTimer = 0;
    const hintEdge = (zone: HTMLElement, dy: number) => {
      zone.dataset.edge = dy > 0 ? "down" : "up";
      window.clearTimeout(edgeTimer);
      edgeTimer = window.setTimeout(() => delete zone.dataset.edge, EDGE_HINT_MS);
    };
    const onWheel = (e: WheelEvent) => {
      /* Ctrl + wheel is a zoom, and a trackpad pinch arrives as exactly that:
         it was flipping sections and blocking the browser's zoom. */
      if (e.ctrlKey) return;
      const box = boxOf(e.target);
      if (box && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways in a box is the box's
      const abs = Math.abs(e.deltaY);
      if (e.timeStamp - flick.lastT > NEW_GESTURE_GAP || abs > flick.lastAbs * GROWTH + 4) {
        flick.spent = false; // a new gesture
      }
      flick.lastT = e.timeStamp;
      flick.lastAbs = abs;
      /* On the machine's screen the wheel is the text's, never the page's (see
         zoneOf). The gesture is spent too, so a flick's tail that drifts off
         the screen with the pointer does not turn the page either. */
      const zone = zoneOf(e.target);
      if (zone) {
        flick.spent = true;
        const roomy = scrollersAt(e.target).find((el) => roomIn(el, e.deltaY) > 1);
        if (roomy && roomy === box) return; // the box under the pointer scrolls itself
        e.preventDefault();
        if (roomy) roomy.scrollTop += wheelPx(e);
        else hintEdge(zone, e.deltaY);
        return;
      }
      /* A scrollable box keeps the wheel only while it can move that way
         (see roomIn); the rest of that gesture is its too, so the tail of a
         flick that scrolled the note to its end does not then turn the page. */
      if (box && roomIn(box, e.deltaY) > 1) {
        flick.spent = true;
        return;
      }
      e.preventDefault();
      /* No cooldown, no gesture debouncing. There used to be a quiet-period
         rule here meant to stop one flick walking through several sections,
         and it was the thing breaking scrolling: it only answered an event
         that FOLLOWED a pause, but a trackpad fires continuously while a
         finger moves - and people keep scrolling when nothing happens - so
         the pause never arrived and the nav went dead for as long as anyone
         kept trying. A mouse wheel hit it too, via the same timestamp.

         `busy` is the only lock now: while a move or a scene is running,
         input is ignored; the moment it is free, the next event moves. */
      /* `busy` covers the move itself; isClipBusy() covers the rest of the
         transition - the overlay fade and the section arriving under it. A
         gesture during 1->2 must not start 2->3 while it is still playing
         out. No cooldown beyond that: the instant the scene is off screen,
         the next input moves. */
      if (busy.current || isClipBusy() || abs < WHEEL_MIN) return;
      if (flick.spent) return; // the tail of the flick that already moved us
      flick.spent = true;
      goTo(indexRef.current + (e.deltaY > 0 ? 1 : -1));
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      /* Typing is left alone - except Up/Down and Page Up/Down in a one-line
         input, which do nothing there. The machine's prompt keeps focus after
         a question (and after any click on its screen), and the arrows used
         to do nothing at all until the visitor clicked away. */
      /* Home/End move the caret - but only in a field with something in it;
         in the empty prompt (which also takes focus when the LLM switch on the
         glass is clicked) they did nothing at all. */
      const emptyField = tag === "INPUT" && !(t as HTMLInputElement).value;
      const lineKey =
        ["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(e.key) || (emptyField && (e.key === "Home" || e.key === "End"));
      if (tag === "TEXTAREA" || t?.isContentEditable) return;
      if (tag === "INPUT" && !(lineKey && ((t as HTMLInputElement).type === "text" || (t as HTMLInputElement).type === "search"))) return;
      /* Space advances - except in development, where the transition scrubber
         (lib/debugPause.ts) owns it. */
      const key = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1, ...(import.meta.env.DEV ? {} : { " ": 1 }) }[e.key];
      const next = key && e.key === " " && e.shiftKey ? -key : key; // Shift+Space goes back, as in any page
      if (next) {
        e.preventDefault();
        /* a long answer on the machine's screen reads on before the page turns */
        const main = document
          .querySelectorAll<HTMLElement>(".panel")
          [indexRef.current]?.querySelector<HTMLElement>("[data-scroll-zone] [data-scroll-main]");
        if (main && roomIn(main, next) > 1) {
          main.scrollBy({ top: next * (e.key.startsWith("Arrow") ? 48 : main.clientHeight * 0.85), behavior: "smooth" });
          return;
        }
        if (!busy.current) goTo(indexRef.current + next);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(count - 1);
      }
    };

    /* A swipe works like the wheel: a box on the glass keeps it while it can
       scroll, and a swipe that scrolled a box does not ALSO turn the page
       (it used to do both: the fragments list moved and the section flipped). */
    let touchY = 0;
    let lastY = 0;
    let touchBox: HTMLElement | null = null;
    let boxMoved = false;
    const onTouchStart = (e: TouchEvent) => {
      touchY = lastY = e.touches[0].clientY;
      touchBox = boxOf(e.target);
      boxMoved = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? lastY;
      const dy = lastY - y; // > 0: the finger goes up, the content down
      lastY = y;
      if (touchBox && dy && roomIn(touchBox, dy) > 1) {
        boxMoved = true;
        return;
      }
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const dy = touchY - (e.changedTouches[0]?.clientY ?? touchY);
      if (boxMoved || busy.current || Math.abs(dy) < 40) return;
      goTo(indexRef.current + (dy > 0 ? 1 : -1));
    };

    /* Keep the index honest if anything else moves the page (anchor, refresh,
       going fullscreen). Deferred two frames rather than run on the event:
       resize fires before the panels have been laid out at the new height, so
       realigning immediately just snaps to the OLD geometry. */
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => goTo(indexRef.current, false))
      );
    };

    /* Anything else that scrolls the page. Tab moves focus into the next
       section's links and the browser scrolls them into view; find-in-page
       does the same; some browsers scroll on Ctrl+wheel instead of zooming.
       The page was left between sections with the dots still on the old one,
       and the sections it passed never arrived - no boot, no index, a dark
       page (Tab from the hero: scrollY 2090, dot still "top"). Once the page
       has stopped, the nav takes over: back onto its own section at once, so
       the move starts from where every scene expects to, then a normal move
       to whichever section the page had got nearest to. */
    let drift = 0;
    const follow = () => {
      /* mid-move: look again once it is over, or focus tabbed onward during
         the move is never followed (the page ended on contact, dot on work) */
      if (busy.current || isClipBusy() || isNavLocked()) {
        drift = window.setTimeout(follow, 300);
        return;
      }
      const y = window.scrollY;
      const cur = indexRef.current;
      if (Math.abs(y - sectionTop(cur)) < 3) return;
      let near = 0;
      for (let i = 1; i < count; i++) if (Math.abs(sectionTop(i) - y) < Math.abs(sectionTop(near) - y)) near = i;
      window.scrollTo(0, sectionTop(cur));
      goTo(near, near !== cur);
    };
    const onScroll = () => {
      window.clearTimeout(drift);
      drift = window.setTimeout(follow, 160);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("resize", onResize);
    // Fullscreen does not always emit a plain resize; these do.
    document.addEventListener("fullscreenchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(drift);
      window.removeEventListener("wheel", onWheel);
      window.clearTimeout(edgeTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [enabled, goTo, count]);

  return { index, goTo };
}
