import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useReducedMotion } from "motion/react";
import SkillField from "./SkillField";

/* three + react-three-fiber are ~215KB gzipped, which is more than the rest of
   the site put together. Splitting them into their own chunk and only fetching
   it when the section is actually approaching keeps the hero instant for
   anyone who never scrolls this far. */
const Keyboard3D = lazy(() => import("./Keyboard3D"));

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function KeyboardSection({
  skills,
  active = false,
  skipIntro = false,
  parkStanding = false,
  onLight,
}: {
  skills: string[];
  /** True while this is the section on screen; drives the reveal + rewind. */
  active?: boolean;
  /** Skip the intro and open on the lit, posed board (entered from below). */
  skipIntro?: boolean;
  /** the pose to hold while off-screen: standing if the next visit comes from below */
  parkStanding?: boolean;
  onLight?: (on: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(false);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();

  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(webglAvailable()), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !supported) return;

    // Two thresholds off one observer: a wide margin to start the download
    // early, and the plain intersection to park the render loop when the
    // board scrolls away.
    const preload = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setLoad(true);
          preload.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    const inView = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.01,
    });

    preload.observe(host);
    inView.observe(host);
    return () => {
      preload.disconnect();
      inView.disconnect();
    };
  }, [reduce, supported]);

  /* The flat field has no lamp to strike, so it reports the light on as soon
     as the section is entered. Without that, the section's own label and
     note (shown only when lit) never appeared, and the blackout staged for
     the lamp hid the nav and the dots for as long as the page was there
     (Reduce Motion on an iPhone, 2026-11-25). A frame late, so it lands after
     the scene's own entry effect, which is the one that stages the black. */
  const flat = !supported || failed;
  useEffect(() => {
    if (!flat || !active) return;
    const raf = requestAnimationFrame(() => onLight?.(true));
    return () => cancelAnimationFrame(raf);
  }, [flat, active, onLight]);

  /* No WebGL, or a chunk that fails to load: the full list, as the flat
     field. Reduced motion used to land here too, but Brian (Reduce Motion on
     his iPhone, 2026-11-25) wants the board: it gets the board, already
     standing and lit - no intro - and Keyboard3D drops the parallax. */
  if (flat) return <SkillField skills={skills} />;

  return (
    <div className="kb-host" ref={hostRef}>
      {/* The board is decorative; this is the copy that actually gets read. */}
      <ul className="visually-hidden">
        {skills.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <div aria-hidden="true">
        {load ? (
          <ErrorBoundary onError={() => setFailed(true)}>
            <Suspense fallback={<KeyboardSkeleton />}>
              <Keyboard3D
                paused={!visible || !active}
                active={active}
                instant={skipIntro || !!reduce}
                hidden={!visible}
                parkStanding={parkStanding}
                onLight={onLight}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <KeyboardSkeleton />
        )}
      </div>
    </div>
  );
}

function KeyboardSkeleton() {
  return <div className="kb kb--skeleton" />;
}

/* A WebGL context can still be refused after the check passes (blocklisted
   driver, too many live contexts). Falling back beats an empty section. */
class ErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(_err: Error, _info: ErrorInfo) {
    this.props.onError();
  }
  render() {
    return this.state.crashed ? null : this.props.children;
  }
}
