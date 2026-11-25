import { useEffect, useRef, useState } from "react";

/**
 * Custom pointer: a thin crosshair, 1:1 with the mouse (no lag). It turns
 * into an x over anything tagged [data-cursor="hover"] - links, buttons, the
 * hero's name and doodles - and tightens on press. White with a hairline dark
 * edge, so it reads on the photo, the black keyboard and the paper sections
 * alike. Replaced the old trailing ring + red dot (2026-11-25), a leftover
 * from the site's earlier look. Off on touch / coarse pointers.
 */
export default function Cursor() {
  const el = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) setEnabled(true);
  }, []);

  useEffect(() => {
    const c = el.current;
    if (!enabled || !c) return;
    let raf = 0;
    let x = -100;
    let y = -100;
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      c.classList.toggle("is-hover", !!(e.target as Element | null)?.closest?.('[data-cursor="hover"]'));
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          c.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        });
    };
    const onDown = () => c.classList.add("is-down");
    const onUp = () => c.classList.remove("is-down");
    const onLeave = () => c.classList.add("is-away");
    const onEnter = () => c.classList.remove("is-away");
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.documentElement.addEventListener("pointerenter", onEnter);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.documentElement.removeEventListener("pointerenter", onEnter);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div ref={el} className="cursor cursor--cross" aria-hidden="true">
      <span className="cursor__mark">
        <i />
        <i />
      </span>
    </div>
  );
}
