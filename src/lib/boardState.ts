/* Whether the keyboard has finished standing up.

   The keyboard->machine clip's first frame is the board STANDING, so the
   clip must not start while it is still lying flat or rising (a visible
   snap). App's gate reads this; Keyboard3D writes it. It lives here, not in
   Keyboard3D, because that module is lazy-loaded with three.js and importing
   from it would pull the whole 3D chunk into the main bundle. */
let standing = false;

export function setBoardStanding(on: boolean) {
  standing = on;
}

export function boardStanding() {
  return standing;
}

/** resolves once the board is standing, or after `ms` whatever it is doing */
export function whenBoardStanding(ms: number) {
  return new Promise<void>((done) => {
    const t0 = performance.now();
    const tick = () => (standing || performance.now() - t0 > ms ? done() : requestAnimationFrame(tick));
    tick();
  });
}

/* ---------------------------------------------------------------------------
   Where the standing board is on screen.

   The keyboard <-> machine clips are pre-rendered video: their keyboard sits
   wherever it sat in the frames. The live board is WebGL, placed by a camera
   fit, the canvas's measured size and the section's 16:9 surface - and any
   change to those (a pose tweak, a canvas mis-measure, a layout quirk on some
   device) moved it off the clip's by a few pixels: the "slight shift" at the
   seams, found twice by eye. So the player no longer assumes where the board
   is: it asks, and fits the clip's board onto the live one (TransitionPlayer
   seamTransform).

   Keyboard3D registers the measure (it owns the camera); it lives here so the
   player can read it without importing the lazy three.js chunk.
   --------------------------------------------------------------------------- */
export type BoardPlacement = {
  /** the standing board's bounding box, as fractions of the canvas (0..1) */
  n: { x0: number; y0: number; x1: number; y1: number };
  /** the canvas's box relative to its section, in CSS px - i.e. on screen,
   *  once the section is the one in view */
  canvas: { x: number; y: number; w: number; h: number };
};

let measureBoard: (() => BoardPlacement | null) | null = null;

export function registerBoardPlacement(fn: (() => BoardPlacement | null) | null) {
  measureBoard = fn;
}

export function boardPlacement(): BoardPlacement | null {
  try {
    return measureBoard?.() ?? null;
  } catch {
    return null;
  }
}

/* development only: lets a scratch probe read the placement */
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __boardPlacement: typeof boardPlacement }).__boardPlacement = boardPlacement;
