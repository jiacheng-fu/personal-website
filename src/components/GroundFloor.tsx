import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { profile } from "../data/content";
import { backend } from "../lib/ragEngine";
import "./GroundFloor.css";

/* ---------------------------------------------------------------------------
   The last page: the ground floor.

   The site opens 520 ft up, on the Space Needle's observation deck (the hero
   photo). It ends at the bottom of it: an elevator lobby. The building
   directory is the credits - the jokes, and the real attributions - and the
   call button rides you back up to the top: the doors close over the screen,
   a floor counter climbs to 520 FT, and they open on the hero.

   Replaced "print contact.txt" (Brian, 2026-11-25: the nav carries GitHub,
   Email and LinkedIn now, so a page of the same three links was redundant).
   That sheet is parked in media/abandoned-contact/.

   Flat CSS, no images: steel, felt and paper are gradients. Every line is
   true (or plainly a joke): 46 keys, no sounds, BM25 doing the talking and
   the model on the bench until a visitor switches it on.
   --------------------------------------------------------------------------- */

/** the observation deck, where the hero was taken */
const TOP_FT = 520;

type Row = { k: string; v: string; href?: string };

/* The directory. Plain jokes, and the attributions the site owes. */
const ROWS: Row[] = [
  { k: "Observation deck", v: `${TOP_FT} ft ▲` },
  { k: "Directed by", v: profile.name },
  { k: "Written by", v: profile.name },
  { k: "Bugs", v: "also Brian" },
  { k: "Stunt head", v: profile.name },
  { k: "The machine", v: "BM25 (unpaid)" },
  { k: "Its understudy", v: `${backend.name} (opt-in)` },
  { k: "Keyboard", v: "46 keys, 0 clicks" },
  { k: "Sound design", v: "none (we tried)" },
  { k: "Filmed on location", v: "Seattle, not Austin" },
  { k: "Keyboard idea & keycaps", v: "Naresh Khatri (MIT)", href: "https://github.com/Naresh-Khatri/3d-portfolio" },
  { k: "Logos", v: "Simple Icons · Devicon", href: "https://simpleicons.org" },
  { k: "Complaints", v: "email ↗", href: `mailto:${profile.email}` },
  { k: "Lost & found", v: "GitHub ↗", href: profile.github },
  { k: "Special thanks", v: "you, for scrolling this far" },
];

/* a hand-placed letterboard: every row sits a hair crooked, and always the
   same hair (seeded, so it does not jitter between renders) */
const tilt = (i: number) => (((i * 7919) % 13) - 6) * 0.09;

type Ride = "idle" | "closing" | "riding" | "opening";

export default function GroundFloor({ active, onRideUp }: { active: boolean; onRideUp: () => void }) {
  const [ride, setRide] = useState<Ride>("idle");
  const [ft, setFt] = useState(0);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  const goUp = () => {
    if (ride !== "idle") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onRideUp();
      return;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    setFt(0);
    setRide("closing");
    /* doors shut (550 ms), then the counter climbs */
    at(560, () => {
      setRide("riding");
      const t0 = performance.now();
      const DUR = 1300;
      const tick = (now: number) => {
        const x = Math.min(1, (now - t0) / DUR);
        const e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; // ease in-out
        setFt(Math.round(e * TOP_FT));
        if (x < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    });
    /* arrived: jump to the top behind the closed doors, then open on it */
    at(560 + 1300 + 180, () => {
      onRideUp();
      setRide("opening");
    });
    at(560 + 1300 + 180 + 700, () => setRide("idle"));
  };

  return (
    <div className={`section shell gf ${active ? "is-in" : ""}`}>
      <p className="section__label">Ground floor</p>

      <div className="gf__lobby">
        {/* the directory: the credits */}
        <div className="gf__board" role="list" aria-label="Building directory">
          <p className="gf__boardHead">Directory</p>
          {ROWS.map((r, i) => {
            const inner = (
              <>
                <span className="gf__k">{r.k}</span>
                <span className="gf__dots" aria-hidden />
                <span className="gf__v">{r.v}</span>
              </>
            );
            return (
              <div key={r.k} role="listitem" className="gf__row" style={{ transform: `rotate(${tilt(i)}deg)` }}>
                {r.href ? (
                  <a
                    href={r.href}
                    {...(r.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    data-cursor="hover"
                  >
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </div>
            );
          })}
        </div>

        {/* the doors, with the floor indicator over them */}
        <div className="gf__shaft" aria-hidden="true">
          <div className="gf__indicator">
            <span className="gf__arrow">▲</span>
            <span className="gf__floor">G</span>
          </div>
          <div className="gf__doors">
            <i />
            <i />
          </div>
        </div>

        {/* the call panel, and the certificate pinned beside it */}
        <div className="gf__side">
          <div className="gf__panel">
            <button
              type="button"
              className={`gf__call ${ride !== "idle" ? "is-lit" : ""}`}
              onClick={goUp}
              data-cursor="hover"
              aria-label={`Ride the elevator back up to the top (${TOP_FT} ft)`}
            >
              ▲
            </button>
            <button
              type="button"
              className="gf__call gf__call--down"
              disabled
              title="You are already at the bottom"
              aria-label="Down (you are already at the bottom)"
            >
              ▼
            </button>
            <p className="gf__engrave">Press ▲ for the top</p>
          </div>

          <div className="gf__cert">
            <p className="gf__certHead">Elevator certificate</p>
            <dl>
              <dt>Capacity</dt>
              <dd>1 recruiter</dd>
              <dt>Inspected by</dt>
              <dd>B. Fu</dd>
              <dt>Maintained by</dt>
              <dd>the sole maintainer</dd>
              <dt>Rise</dt>
              <dd>{TOP_FT} ft, one stop</dd>
            </dl>
          </div>
        </div>
      </div>

      {/* the ride itself: doors over the whole screen */}
      {ride !== "idle" &&
        createPortal(
          <div className={`gf__ride is-${ride}`} aria-hidden="true">
            <i />
            <i />
            <div className="gf__counter">
              <span className="gf__counterArrow">▲</span>
              <span className="gf__counterFt">{ft} FT</span>
              <span className="gf__counterTo">Observation deck</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
