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
