/* ---------------------------------------------------------------------------
   Gestures that belong to the thing under the finger, not to the page.

   A swipe or a press that starts on the keyboard - pressing keys, dragging
   across them - used to turn the page (Brian, 2026-11-25: "if you were trying
   to press the buttons on the keyboard or swipe it could trigger the
   transition to the next page"). The board is a WebGL canvas, so the DOM
   cannot say whether a touch landed on it; three.js's raycast can. The board
   claims the gesture on its pointerdown, which fires just before the
   browser's touchstart, and the section nav leaves any claimed gesture alone.
   --------------------------------------------------------------------------- */

let claimedAt = -Infinity;

/** The current gesture is the board's: the page must not turn on it. */
export function claimGesture() {
  claimedAt = performance.now();
}

/** Was the gesture that started at `startedAt` (performance.now()) claimed?
 *  pointerdown runs a moment before touchstart, so a little slack before. */
export function gestureClaimed(startedAt: number) {
  return claimedAt >= startedAt - 150;
}
