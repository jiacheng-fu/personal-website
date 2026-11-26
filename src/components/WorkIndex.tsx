import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { projects, profile } from "../data/content";
import "./WorkIndex.css";

/* ---------------------------------------------------------------------------
   Selected work, as an index

   The previous version put the projects inside a 3D scene, which meant the
   work itself was competing with the furniture around it. This is the other
   way round: the titles ARE the composition, set at display size, and the
   only thing that moves is the selection.

   One row is always selected - there is no empty state - so the panel on the
   right never sits blank waiting to be hovered. Pointer and focus both drive
   the same selection, which is what makes it work on a trackpad and on a
   keyboard without two separate code paths.
   --------------------------------------------------------------------------- */

const ease = [0.16, 1, 0.3, 1] as const;
const pad = (n: number) => String(n + 1).padStart(2, "0");

export default function WorkIndex({
  active,
  handed = false,
  lifting = false,
}: {
  active: boolean;
  /** Arrived via the terminal handoff, which has already flown the titles into
   *  position and is cross-fading off them. Replaying the row entrance under
   *  that puts moving text behind still text - the "jar" at the join. The rows
   *  therefore arrive already placed, and everything around them animates in. */
  handed?: boolean;
  /** The handoff has borrowed these titles to fly them back into the machine,
   *  so the index must not also be drawing them. A PROP and not a class added
   *  from outside: this className is built from state, and React rewrites the
   *  whole attribute on every render - an imperative class on it survives
   *  exactly until the next one, which is why both titles were on screen. */
  lifting?: boolean;
}) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const shown = projects[i];
  const media = !!(shown.reel.clip || shown.reel.still);

  /* Leaving and coming back should replay the reveal from the top rather than
     resuming wherever the pointer happened to leave it. */
  useEffect(() => {
    if (!active) setI(0);
  }, [active]);

  const on = active || reduce;

  return (
    <div className={`section shell wx ${handed ? "is-handed" : ""} ${lifting ? "is-lifting" : ""}`}>
      <motion.p
        className="wx__label"
        initial={{ opacity: 0, y: 12 }}
        animate={on ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: handed ? 0.85 : 0.7, ease, delay: handed ? 0.25 : 0 }}
      >
        Selected work
      </motion.p>

      <div className="wx__body">
        <ol className="wx__list">
          {projects.map((p, n) => (
            <motion.li
              key={p.title}
              initial={handed ? false : { opacity: 0, y: 26 }}
              animate={on ? { opacity: 1, y: 0 } : { opacity: 0, y: 26 }}
              transition={
                handed
                  ? { duration: 0 }
                  : { duration: 0.75, ease, delay: on ? 0.12 + n * 0.08 : 0 }
              }
            >
              <button
                type="button"
                className={`wx__row ${n === i ? "is-on" : ""}`}
                data-cursor="hover"
                aria-current={n === i}
                onMouseEnter={() => setI(n)}
                onFocus={() => setI(n)}
                /* With a mouse, hover selects and a click opens the repo. A
                   phone has no hover: there a tap is the selection, and the
                   repo is the card's own link (Brian, 2026-11-25: tapping a
                   project "sends you straight to github"). */
                onClick={() => {
                  if (window.matchMedia("(hover: hover)").matches) window.open(p.repo, "_blank", "noopener");
                  else setI(n);
                }}
              >
                <span className="wx__num">{pad(n)}</span>
                <span className="wx__title">{p.title}</span>
                <span className="wx__rule" aria-hidden="true" />
                <span className="wx__yr">{p.years}</span>
              </button>
            </motion.li>
          ))}
        </ol>

        <div className="wx__detail">
          {/* The selected number, blown up and pushed almost all the way back.
              It is the only thing that tells you WHERE you are once the rows
              scroll out of the corner of your eye. */}
          {media ? (
            <div className="wx__frame" aria-hidden="true">
              {/* `key` on the element, not just the parent: without it React
                  reuses the same <video> node across projects and the browser
                  keeps showing the previous clip's last decoded frame until
                  the new source buffers. */}
              {shown.reel.clip && !reduce ? (
                <video
                  key={shown.reel.clip}
                  className="wx__media"
                  src={shown.reel.clip}
                  poster={shown.reel.still}
                  autoPlay
                  muted
                  loop
                  playsInline
                  /* Nothing is fetched until the project is actually selected,
                     so landing on the section costs one still, not four clips. */
                  preload="none"
                />
              ) : (
                <img key={shown.reel.still} className="wx__media" src={shown.reel.still} alt="" />
              )}
              <span className="wx__frameNum">{pad(i)}</span>
            </div>
          ) : (
            /* No footage for this one. The numeral is the honest fallback -
               it says "nothing to show yet" without a broken black rectangle. */
            <span className="wx__ghost" aria-hidden="true">{pad(i)}</span>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={shown.title}
              className="wx__card"
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.32, ease }}
            >
              <p className="wx__yr wx__yr--card">{shown.years}</p>
              <p className="wx__blurb">{shown.blurb}</p>
              <ul className="wx__stack">
                {shown.stack.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <a
                className="wx__repo"
                href={shown.repo}
                target="_blank"
                rel="noreferrer"
                data-cursor="hover"
              >
                View repository
                <span aria-hidden="true">&#8599;</span>
              </a>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <motion.p
        className="wx__aside"
        initial={{ opacity: 0 }}
        animate={on ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.8, ease, delay: on ? (handed ? 0.5 : 0.5) : 0 }}
      >
        All of it is on{" "}
        <a href={profile.github} target="_blank" rel="noreferrer" data-cursor="hover">
          GitHub
        </a>
        . <span className="dim">I&rsquo;d rather show you one that works.</span>
      </motion.p>
    </div>
  );
}
