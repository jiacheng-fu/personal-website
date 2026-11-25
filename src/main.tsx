import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/* ---------------------------------------------------------------------------
   The safety net. A render error anywhere unmounts the whole tree, and this
   site with nothing mounted is a black page with no way forward.

   - Development: a hot update that adds or removes a hook (e.g. in a custom
     hook like useSectionNav) can leave App with a different hook order than
     its last render - "Rendered more hooks than during the previous render" -
     and the open tab went black until a manual reload. Those reload
     themselves, once (a reload within 5 s is not retried, so a real bug
     cannot loop).
   - Anywhere: anything else shows a quiet line and a reload button instead
     of black.
   --------------------------------------------------------------------------- */
const HOOK_ORDER = /Rendered (more|fewer) hooks|order of Hooks|change in the order of Hooks/i;
const RELOAD_KEY = "app:auto-reloaded-at";

class SafetyNet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (import.meta.env.DEV && HOOK_ORDER.test(msg)) {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last > 5000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        location.reload();
      }
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#050505",
          color: "#ece9e2",
          font: "500 13px/1.6 ui-monospace, 'JetBrains Mono', Menlo, monospace",
          letterSpacing: "0.08em",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div>
          <p style={{ margin: "0 0 1.2rem" }}>SOMETHING ON THIS PAGE BROKE.</p>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{
              font: "inherit",
              letterSpacing: "inherit",
              color: "inherit",
              background: "none",
              border: "1px solid rgba(236,233,226,0.35)",
              borderRadius: 999,
              padding: "0.55rem 1.2rem",
              cursor: "pointer",
            }}
          >
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}

/* Development: a saved file reloads the page instead of being hot-swapped in.
   This site is a stateful film (a booted machine, a lit keyboard, a scene
   mid-play), and a live swap kept the section while resetting what was on it -
   a dark machine or a black keyboard under dots that still said section 2 or 3.
   A reload lands back on the same section, properly (useSectionNav, RELOAD). */
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", () => location.reload());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SafetyNet>
      <App />
    </SafetyNet>
  </StrictMode>
);
