/* ---------------------------------------------------------------------------
   Motion, without the browser's accelerated animations.

   Motion hands opacity and transform animations to the Web Animations API.
   In WebKit - every iPhone browser, Chrome included - the last frame of each
   one snapped back: a fade-in vanished for a frame as it landed, a fade-out
   flashed fully on again before it went. Measured frame by frame (2026-11-26)
   on the nav's entrance, the projects' label and card, and the machine's
   answer phases; Brian saw the projects' text "show up, disappear, then
   appear again".

   Motion only uses WAAPI when the component has no onUpdate (it cannot read a
   WAAPI value every frame), so giving each animated element this no-op keeps
   it on Motion's own per-frame renderer, which does not snap.
   --------------------------------------------------------------------------- */
export const JS_ANIM = { onUpdate: () => {} } as const;
