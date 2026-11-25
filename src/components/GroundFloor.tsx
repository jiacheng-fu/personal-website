import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { profile } from "../data/content";
import { backend } from "../lib/ragEngine";
import "./GroundFloor.css";

/* ---------------------------------------------------------------------------
   The last page: a cork notice board.

   Everything the old building directory said is still here, each line as
   its own pinned thing: the credits on a clapperboard, the jokes on sticky
   notes, the attributions the site owes on a typed card, a Polaroid, a
   ticket stub to the observation deck. One of them is a call panel: press ▲
   and it counts up to 520 ft and takes you back to the top (the hero photo
   is the Space Needle's observation deck, 520 ft up).

   History: "print contact.txt" (parked in media/abandoned-contact/), then an
   elevator lobby (media/abandoned-ground-floor-lobby/; Brian, 2026-11-25:
   "make the entire thing like a scrapbook/bulletin board ... the content
   currently on the directory ... as different post it notes, pinned things").
   The Polaroid is the other hero candidate, the one not used (the Chihuly
   glasshouse at Seattle Center; Brian: "use the other background image").

   Cork, paper, tape and pins are gradients over two small generated textures
   (scripts/gen-grain.cjs). Layout is in 1760x990 design units (--u) on a 16:9
   stage, so the collage scales as one piece. Every line is true, or plainly
   a joke.
   --------------------------------------------------------------------------- */

/** the observation deck, where the hero was taken */
const TOP_FT = 520;

type Ride = "idle" | "riding" | "leaving" | "arriving";
type Pin = "red" | "blue" | "yellow" | "green" | "white";

/** One pinned thing, placed in design units, a hair crooked. */
function Item({
  x,
  y,
  w,
  r,
  z,
  className = "",
  children,
  zoom,
  onPick,
  label,
}: {
  x: number;
  y: number;
  w: number;
  r: number;
  z?: number;
  className?: string;
  children: ReactNode;
  /** set while this item is picked up and held to the screen */
  zoom?: Zoom | null;
  /** makes the item a button that picks it up (Polaroids) */
  onPick?: (el: HTMLDivElement) => void;
  label?: string;
}) {
  const style = {
    "--x": x,
    "--y": y,
    "--w": w,
    "--r": `${r}deg`,
    zIndex: z,
    ...(zoom ? { "--zx": `${zoom.dx}px`, "--zy": `${zoom.dy}px`, "--zs": zoom.s } : {}),
  } as CSSProperties;
  if (!onPick)
    return (
      <div className={`nb__item ${className}`} style={style}>
        {children}
      </div>
    );
  return (
    <div
      className={`nb__item nb__item--pick ${zoom ? "is-zoomed" : ""} ${className}`}
      style={style}
      role="button"
      tabIndex={0}
      aria-pressed={!!zoom}
      aria-label={zoom ? `Put back: ${label}` : `Pick up: ${label}`}
      data-cursor="hover"
      onClick={(e) => onPick(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(e.currentTarget);
        }
      }}
    >
      {children}
    </div>
  );
}

/** A Polaroid held up to the screen: how far to move it, and how big. */
type Zoom = { key: string; dx: number; dy: number; s: number };
const PinHead = ({ c, at = 50 }: { c: Pin; at?: number }) => (
  <i className={`nb__pin nb__pin--${c}`} style={{ left: `${at}%` }} aria-hidden />
);
const Tape = ({ x, y, r, w = 110 }: { x: string; y: string; r: number; w?: number }) => (
  <i
    className="nb__tape"
    style={{ left: x, top: y, "--tw": w, transform: `translate(-50%, -50%) rotate(${r}deg)` } as CSSProperties}
    aria-hidden
  />
);
const ext = { target: "_blank", rel: "noreferrer" } as const;

export default function GroundFloor({ active, onRideUp }: { active: boolean; onRideUp: () => void }) {
  const [ride, setRide] = useState<Ride>("idle");
  const [ft, setFt] = useState(0);
  /* Click a Polaroid and it comes off the board to the middle of the
     screen, straightened and big; click again (or the dimmed board, or Esc)
     and it goes back on its pin (Brian, 2026-11-25: "clicking on images
     should make them zoom in/pop out and clicking again should put them
     back, like a video game"). Measured from where the item sits in the
     layout, not from its hover tilt. */
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const pick = (key: string) => (el: HTMLDivElement) => {
    if (zoom) {
      setZoom(null);
      return;
    }
    const board = el.offsetParent as HTMLElement | null;
    if (!board) return;
    const b = board.getBoundingClientRect();
    const cx = b.left + el.offsetLeft + el.offsetWidth / 2;
    const cy = b.top + el.offsetTop + el.offsetHeight / 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    /* as big as fits: most of the height, never more than half the width */
    const s = Math.min((vh * 0.8) / el.offsetHeight, (vw * 0.5) / el.offsetWidth);
    setZoom({ key, dx: vw / 2 - cx, dy: vh / 2 - cy, s });
  };
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  /* scrolled away: everything goes back on the board */
  useEffect(() => {
    if (!active) setZoom(null);
  }, [active]);
  const held = (key: string) => (zoom?.key === key ? zoom : null);
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
    const CLIMB = 1150;
    setFt(0);
    setRide("riding");
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / CLIMB);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      setFt(Math.round(e * TOP_FT));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    /* arrived: a quick fade over the screen, the jump happens behind it */
    at(CLIMB + 250, () => setRide("leaving"));
    at(CLIMB + 250 + 320, () => {
      onRideUp();
      setRide("arriving");
    });
    at(CLIMB + 250 + 320 + 520, () => setRide("idle"));
  };

  const riding = ride !== "idle";

  return (
    <div className={`section shell nb ${active ? "is-in" : ""}`}>
      <div className="nb__stage">
        <div className="nb__board">
          {/* the board dims behind a picked-up Polaroid; clicking it puts it back */}
          {zoom && <div className="nb__dim" onClick={() => setZoom(null)} aria-hidden="true" />}
          {/* a few spare pins, as every board has */}
          <i className="nb__pin nb__pin--yellow nb__pin--loose" style={{ left: "21.6%", top: "48.6%" }} aria-hidden />
          <i className="nb__pin nb__pin--green nb__pin--loose" style={{ left: "77.4%", top: "92.2%" }} aria-hidden />
          <i className="nb__pin nb__pin--blue nb__pin--loose" style={{ left: "46.2%", top: "95.6%" }} aria-hidden />

          {/* the board's own label, punched out on label-maker tape */}
          <Item x={26} y={30} w={300} r={-2.5} z={5} className="nb__dymo">
            <p className="section__label">Notice board</p>
          </Item>

          {/* filmed on location */}
          <Item x={40} y={112} w={285} r={-6} className="nb__polaroid" zoom={held("glass")} onPick={pick("glass")} label="the glasshouse photo">
            <PinHead c="red" />
            <img
              src="/board/polaroid.webp"
              srcSet="/board/polaroid.webp 600w, /board/polaroid-940.webp 940w"
              sizes={zoom?.key === "glass" ? "70vh" : "18vw"}
              alt="Brian under a glass sculpture in a glasshouse in Seattle"
              loading="lazy"
              decoding="async"
            />
            <p>
              <small>filmed on location:</small> Seattle, not Austin
            </p>
          </Item>

          {/* his name, the long way */}
          <Item x={52} y={530} w={240} r={3} className="nb__hello">
            <p className="nb__helloHead">
              <b>Hello</b>
              <span>my name is</span>
            </p>
            <p className="nb__helloName">
              Jiacheng
              <small>(call me Brian)</small>
            </p>
          </Item>

          {/* the observation deck */}
          <Item x={30} y={790} w={330} r={-3} className="nb__ticket">
            <Tape x="50%" y="2%" r={-3} w={90} />
            <div className="nb__ticketMain">
              <span className="nb__ticketKicker">Admit one</span>
              <strong>Observation deck</strong>
              <span>
                {TOP_FT} ft ▲ <em>one way, up</em>
              </span>
            </div>
            <div className="nb__ticketStub">
              <span>Nº</span>
              <b>000{TOP_FT}</b>
            </div>
          </Item>

          {/* directed by, written by, stunt head */}
          <Item x={372} y={46} w={390} r={2.5} className="nb__clap">
            <PinHead c="white" at={86} />
            <div className="nb__clapStick" aria-hidden />
            <div className="nb__clapBody">
              <dl>
                <dt>Production</dt>
                <dd>this website</dd>
                <dt>Directed by</dt>
                <dd>{profile.name}</dd>
                <dt>Written by</dt>
                <dd>{profile.name}</dd>
                <dt>Stunt head</dt>
                <dd>{profile.name}</dd>
              </dl>
              <p className="nb__clapFoot">
                <span>Scene: the end</span>
                <span>Take: 1</span>
              </p>
            </div>
          </Item>

          {/* bugs */}
          <Item x={362} y={420} w={165} r={-7} className="nb__sticky nb__sticky--yellow">
            <p>
              <small>bugs:</small> also Brian
            </p>
          </Item>

          {/* a fortune */}
          <Item x={828} y={500} w={225} r={5} className="nb__fortune">
            <p>You will scroll back up.</p>
            <span>Lucky numbers: 46 · {TOP_FT}</span>
          </Item>

          {/* Xi'an, from the photo's own metadata: the Drum Tower, June 2024 */}
          <Item x={560} y={402} w={232} r={4} className="nb__polaroid" zoom={held("xian")} onPick={pick("xian")} label="the Xi'an photo">
            <PinHead c="green" />
            <img
              src="/board/xian.webp"
              srcSet="/board/xian.webp 600w, /board/xian-1200.webp 1200w"
              sizes={zoom?.key === "xian" ? "70vh" : "15vw"}
              alt="The Drum Tower in Xi'an, under a tree"
              loading="lazy"
              decoding="async"
            />
            <p>Xi&apos;an, summer 2024</p>
          </Item>

          {/* a meme, and the machine's opt-in */}
          <Item x={1295} y={60} w={200} r={6} className="nb__polaroid" zoom={held("glow")} onPick={pick("glow")} label="the glowing meme">
            <Tape x="50%" y="1%" r={-4} w={80} />
            <img src="/board/glow.webp" alt="A blown-out, glowing meme photo" loading="lazy" decoding="async" />
            <p>your GPU, LLM on</p>
          </Item>

          {/* special thanks */}
          <Item x={372} y={750} w={330} r={1.5} className="nb__notebook">
            <Tape x="18%" y="4%" r={-8} w={80} />
            <p>
              <small>special thanks:</small>
              <br />
              you, for scrolling this far <span className="nb__heart">♥</span>
            </p>
          </Item>

          {/* sound design */}
          <Item x={722} y={786} w={160} r={-4} className="nb__sticky nb__sticky--pink">
            <p>
              <small>sound design:</small> none
              <br />
              (we tried)
            </p>
          </Item>

          {/* the machine, its understudy */}
          <Item x={808} y={50} w={395} r={-2} className="nb__card nb__cast">
            <PinHead c="blue" at={12} />
            <h3>Cast</h3>
            <p>
              <span>The machine</span>
              <i />
              <span>BM25 (unpaid)</span>
            </p>
            <p>
              <span>Its understudy</span>
              <i />
              <span>{backend.name} (opt-in)</span>
            </p>
          </Item>

          {/* the keyboard */}
          <Item x={826} y={252} w={200} r={5} className="nb__kraft">
            <Tape x="50%" y="3%" r={4} w={100} />
            <span className="nb__keycap" aria-hidden>
              <span>46</span>
            </span>
            <p>
              <small>keyboard:</small> 46 keys, 0 clicks
            </p>
          </Item>

          {/* the to-do list */}
          <Item x={884} y={596} w={272} r={-3} className="nb__todo">
            <PinHead c="red" at={50} />
            <p className="nb__todoHead">to do:</p>
            <ul>
              <li className="is-done">build this website</li>
              <li className="is-done">teach the machine to quote</li>
              <li className="is-done">keep the phone number off it</li>
              <li>graduate (Dec 2027)</li>
              <li>
                2027 internship <em>← you?</em>
              </li>
            </ul>
          </Item>

          {/* the flyer, with tabs to tear off */}
          <Item x={1052} y={232} w={250} r={-2} className="nb__flyer">
            <PinHead c="yellow" at={50} />
            <p className="nb__flyerKicker">Now accepting</p>
            <p className="nb__flyerHead">2027 internships</p>
            <p className="nb__flyerBody">
              Software engineer · CS at Texas A&amp;M, graduating December 2027 · no visa sponsorship needed
            </p>
            <div className="nb__tabs">
              {Array.from({ length: 6 }, (_, i) =>
                i === 2 ? (
                  <span key={i} className="nb__tab is-torn" aria-hidden />
                ) : (
                  <a key={i} className="nb__tab" href={`mailto:${profile.email}`} data-cursor="hover">
                    email Brian
                  </a>
                ),
              )}
            </div>
          </Item>

          {/* complaints */}
          <Item x={1530} y={640} w={160} r={7} z={3} className="nb__sticky nb__sticky--blue">
            <a href={`mailto:${profile.email}`} data-cursor="hover">
              <small>complaints:</small> email me ↗
            </a>
          </Item>

          {/* the way back up */}
          <Item x={1500} y={110} w={245} r={-3} z={4} className="nb__panel">
            <PinHead c="red" />
            <div className="nb__led" aria-hidden>
              <span className={`nb__ledArrow ${riding ? "is-on" : ""}`}>▲</span>
              <span>{ride === "idle" ? "G" : `${ft} FT`}</span>
            </div>
            <div className="nb__buttons">
              <button
                type="button"
                className={`nb__call ${riding ? "is-lit" : ""}`}
                onClick={goUp}
                data-cursor="hover"
                aria-label={`Ride back up to the top (${TOP_FT} ft)`}
              >
                <span>▲</span>
              </button>
              <button
                type="button"
                className="nb__call nb__call--down"
                disabled
                title="You are already at the bottom"
                aria-label="Down (you are already at the bottom)"
              >
                <span>▼</span>
              </button>
            </div>
            <p className="nb__engrave">Press ▲ for the top</p>
          </Item>

          {/* the elevator's certificate, taped under its panel */}
          <Item x={1508} y={390} w={232} r={2} z={3} className="nb__slip">
            <Tape x="50%" y="0%" r={-2} w={70} />
            <h3>Certificate of operation</h3>
            <p>capacity: 1 recruiter</p>
            <p>inspected by: B. Fu</p>
            <p>maintained by: the sole maintainer</p>
            <p>rise: {TOP_FT} ft, one stop</p>
            <span className="nb__stamp" aria-hidden>
              Passed
            </span>
          </Item>

          {/* the attributions the site owes */}
          <Item x={1172} y={668} w={350} r={2.5} className="nb__card nb__thanks">
            <Tape x="8%" y="6%" r={-35} w={80} />
            <Tape x="92%" y="6%" r={35} w={80} />
            <h3>Borrowed, with thanks</h3>
            <p>
              <span>Keyboard idea &amp; keycaps</span>
              <a href="https://github.com/Naresh-Khatri/3d-portfolio" {...ext} data-cursor="hover">
                Naresh Khatri (MIT) ↗
              </a>
            </p>
            <p>
              <span>Logos</span>
              <span className="nb__links">
                <a href="https://simpleicons.org" {...ext} data-cursor="hover">
                  Simple Icons
                </a>{" "}
                ·{" "}
                <a href="https://devicon.dev" {...ext} data-cursor="hover">
                  Devicon
                </a>
              </span>
            </p>
          </Item>

          {/* lost & found */}
          <Item x={1420} y={812} w={160} r={-5} z={4} className="nb__sticky nb__sticky--green">
            <a href={profile.github} {...ext} data-cursor="hover">
              <small>lost &amp; found:</small> GitHub ↗
            </a>
          </Item>
        </div>
      </div>

      {/* the jump to the top happens behind a quick fade */}
      {(ride === "leaving" || ride === "arriving") &&
        createPortal(<div className={`nb__curtain is-${ride}`} aria-hidden="true" />, document.body)}
    </div>
  );
}
