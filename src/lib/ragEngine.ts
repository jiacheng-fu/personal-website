/* The generation stage: a small language model running in the visitor's
 * browser. Which model is ragBackends.ts's business; WHEN it loads, and what
 * the machine says about it while it does, is this file's.
 *
 * Everything about the model is local. The weights stream from Hugging Face's
 * CDN into the browser's Cache API storage, the GPU programs are built on the
 * visitor's own GPU via WebGPU, and inference never leaves the machine. There
 * is no API key anywhere in this repo and the site stays static files - which
 * is the reason this path was chosen over a serverless proxy.
 *
 * WHEN IT LOADS (Brian, 2026-10-20). In three parts:
 *
 *   landing   warmModel("landing") the instant the page mounts: the largest
 *             weight file (the vocabulary table, 78 MB) starts downloading
 *   rest      warmModel("rest") once the visitor moves past the hero: every
 *             other file
 *   arrival   requestModel() when the machine is reached: whatever is still
 *             missing, then the GPU upload and compile - the "finishing
 *             touches" the boot screen's progress bar shows
 *
 * The first two only download, at low network priority, and never touch the
 * GPU; the files land in WebLLM's own caches (see ragBackends.ts). The GPU
 * work stays on demand, so nothing heavy runs while the hero and keyboard are
 * on screen. And nobody waits minutes on the boot screen: it lets the
 * visitor in after BOOT_HOLD_MS (RagSection), answers from fragments, and
 * re-asks the model the moment it lands.
 *
 * The engine is a plain module singleton with a subscriber list rather than
 * a React context: the section component mounts and unmounts as the visitor
 * scrolls, but a 350 MB download, once asked for, belongs to the page, not to
 * a component's lifetime. Leaving the section mid-download does not stop it.
 *
 * The runtimes are imported dynamically inside the backends, so none of their
 * weight reaches the main chunk (same policy as three.js in App.tsx).
 */

import { isClipBusy } from "./transitions";
import {
  BACKENDS,
  __resetDownloadsForTests,
  type Backend,
  type LoadReport,
  type Runner,
  type WarmPart,
} from "./ragBackends";

/* The model on board. Qwen3-0.6B, chosen over LFM2.5-350M on 2026-10-20 -
   see docs/rag-model-bench.md for the numbers. */
export const backend: Backend = BACKENDS.qwen3;

/** Megabytes, as printed on the glass. Decimal, like the files' own sizes. */
export const mb = (bytes: number) => Math.round(bytes / 1e6);

export type EngineState =
  | { phase: "idle"; detail: string } // not requested, or a gate declined
  | { phase: "queued"; detail: string } // requested, waiting out something brief
  | { phase: "unavailable"; detail: string } // no WebGPU - permanent
  | {
      phase: "downloading";
      detail: string;
      /** fraction of the CURRENT stage, 0..1, as the runtime computed it */
      progress: number;
      /** fetch = over the network; upload = from the browser's cache to the GPU */
      stage: "fetch" | "upload";
      /** bytes fetched so far, as the runtime counted them (fetch only) */
      bytes: number;
    }
  | { phase: "compiling"; detail: string; progress: number | null }
  | { phase: "ready"; detail: string }
  | { phase: "generating"; detail: string }
  | { phase: "error"; detail: string };

let state: EngineState = { phase: "idle", detail: "model not requested yet" };
const listeners = new Set<(s: EngineState) => void>();

function set(s: EngineState) {
  state = s;
  listeners.forEach((l) => l(s));
}

export function engineState(): EngineState {
  return state;
}

export function subscribe(l: (s: EngineState) => void): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

/* ---- gates -------------------------------------------------------------
   Arriving at the machine is a request, so the gates left are the ones that
   no request should override without the visitor's own click: facts about
   the machine, and the visitor's stated preference.

   What is gone is everything that judged the CONNECTION - the "4g" check,
   the bandwidth floor, the two-readings confirmation and the ten minutes of
   patient re-asking. They existed to make an uninvited background download
   polite, and they were the source of the "sometimes MODEL NOT LOADED" bug:
   `effectiveType` is a rolling estimate that reads "3g" on a gigabit line
   while the page is busy. A download the visitor asked for by arriving does
   not need to guess at the weather. The bar shows the real rate, and on a
   slow line the boot stops holding after BOOT_HOLD_MS (RagSection) and lets
   the visitor in while the rest arrives. */
export type Verdict = { ok: true } | { ok: false; reason: string; permanent: boolean };

export function arrivalVerdict(): Verdict {
  const nav = navigator as Navigator & {
    gpu?: unknown;
    connection?: { saveData?: boolean };
    deviceMemory?: number;
    maxTouchPoints?: number;
  };

  /* ---- facts about the machine, and the visitor's stated preference ---- */
  if (!nav.gpu) return { ok: false, reason: "no WebGPU in this browser", permanent: true };
  if (nav.connection?.saveData) return { ok: false, reason: "Data Saver is on", permanent: true };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4)
    return { ok: false, reason: "device reports <4 GB RAM", permanent: true };
  /* iPadOS calls itself a Macintosh, and an iPad with WebGPU would otherwise
     sail through every one of these checks and start pulling 350 MB over
     someone's cellular plan. A pointing device that reports ten fingers is
     not a desktop. */
  const handheld =
    /Mobi|Android/i.test(navigator.userAgent) ||
    ((nav.maxTouchPoints ?? 0) > 1 && /Macintosh/.test(navigator.userAgent));
  if (handheld) return { ok: false, reason: "handheld device", permanent: true };

  /* ---- brief, and waited out ---- */
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return { ok: false, reason: "the tab is in the background", permanent: false };
  return { ok: true };
}

/* The browser needs room to store and unpack the weights. If there is not that
   much space left, starting the download fills the visitor's remaining quota
   to the brim and then fails on the last chunk - worse for them than never
   having started. */
const HEADROOM = 1.25;

async function storageShortfall(): Promise<string | null> {
  const store = navigator.storage;
  if (!store?.estimate) return null; // browser won't say; not grounds to refuse
  try {
    const { quota = 0, usage = 0 } = await store.estimate();
    if (!quota) return null;
    const free = quota - usage;
    return free < backend.bytes * HEADROOM
      ? `only ${mb(free)} MB of browser storage left, and the model needs ${mb(backend.bytes)} MB`
      : null;
  } catch {
    return null;
  }
}

/* The waits that are left are short and clear themselves: a transition clip
   still fading off the screen (the arrival call lands as the clip ends, and
   the overlay holds for ~0.7 s after), or a tab switched away. Starting a
   download and a GPU compile under a playing clip makes the clip drop frames,
   so those are waited out rather than talked over. The cap is a runaway
   backstop - the player's own failsafe clears a stuck clip in 15 s. */
const RETRY_MS = 600;
const MAX_ATTEMPTS = 60;

let attempts = 0;
let retryTimer = 0;

function defer(reason: string) {
  if (retryTimer || enginePromise) return;
  if (++attempts > MAX_ATTEMPTS) {
    set({ phase: "idle", detail: `gave up waiting: ${reason}` });
    return;
  }
  set({ phase: "queued", detail: `waiting — ${reason}` });
  retryTimer = window.setTimeout(() => {
    retryTimer = 0;
    void preload(false);
  }, RETRY_MS);
}

/* Coming back to the tab asks again at once instead of waiting for the timer. */
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (enginePromise || state.phase !== "queued") return;
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }
    void preload(false);
  });
}

let enginePromise: Promise<Runner | null> | null = null;

/** Map the runtime's own report onto the machine's state. */
function onReport(r: LoadReport) {
  if (r.stage === "fetch")
    set({ phase: "downloading", stage: "fetch", progress: r.progress, bytes: r.bytes, detail: r.text });
  else if (r.stage === "upload")
    set({ phase: "downloading", stage: "upload", progress: r.progress, bytes: 0, detail: r.text });
  else set({ phase: "compiling", progress: r.progress, detail: r.text });
}

/** Start loading the model. Idempotent: a second call while one is loading
 *  returns the same promise. force=true is the visitor's own click on the
 *  load button and skips every gate except WebGPU; force=false is the
 *  arrival request, which respects them. */
export function preload(force = false): Promise<Runner | null> {
  if (enginePromise) return enginePromise;
  asked = force ? "click" : (asked ?? "arrival");
  /* already waiting on something brief; the timer will ask again */
  if (!force && retryTimer) return Promise.resolve(null);
  if (force && retryTimer) {
    window.clearTimeout(retryTimer); // the visitor's own click outranks the wait
    retryTimer = 0;
  }

  if (!force) {
    /* ?rag=off keeps the model away entirely - for testing the extractive
       fallback (and screenshots: a GPU-resident model blocks Playwright's
       CDP captures). Plate rendering (?frame=) never wants it either. The
       button still works. */
    const q = typeof location === "undefined" ? "" : location.search;
    if (/[?&]rag=off/.test(q) || /[?&]frame=/.test(q)) {
      set({ phase: "idle", detail: "model off for this page (?rag=off)" });
      return Promise.resolve(null);
    }

    if (isClipBusy()) {
      defer("a transition clip is playing");
      return Promise.resolve(null);
    }

    const verdict = arrivalVerdict();
    if (!verdict.ok) {
      if (!verdict.permanent) {
        defer(verdict.reason);
        return Promise.resolve(null);
      }
      const noGpu = verdict.reason.includes("WebGPU");
      set(
        noGpu
          ? { phase: "unavailable", detail: verdict.reason }
          : { phase: "idle", detail: `not loaded: ${verdict.reason}` }
      );
      if (!noGpu) return Promise.resolve(null); // the button still works
      enginePromise = Promise.resolve(null); // no point re-checking WebGPU
      return enginePromise;
    }
  } else if (!(navigator as { gpu?: unknown }).gpu) {
    set({ phase: "unavailable", detail: "no WebGPU in this browser" });
    enginePromise = Promise.resolve(null);
    return enginePromise;
  }

  /* Said synchronously, before the first await: between here and the storage
     estimate the state would otherwise still read "idle", and the boot screen
     takes idle to mean "nothing is coming" and stops holding. */
  set({ phase: "queued", detail: "starting" });
  enginePromise = (async () => {
    try {
      const shortfall = await storageShortfall();
      if (shortfall) {
        set({ phase: "idle", detail: `not loaded: ${shortfall}` });
        enginePromise = null; // they may free space; the button still works
        return null;
      }
      set({ phase: "downloading", stage: "fetch", progress: 0, bytes: 0, detail: "starting" });
      const runner = await backend.load(onReport);
      netRetries = 0;
      set({ phase: "ready", detail: "weights cached in this browser" });
      return runner;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ phase: "error", detail: message });
      /* Let go of the failed attempt. A dropped connection mid-download, a GPU
         that was busy, a tab that was backgrounded at the wrong moment - all
         transient, and all of them used to be permanent for the rest of the
         visit, because the rejected promise stayed cached here and every
         later call, including the visitor's own retry button, was handed the
         same failure. Nothing retries on its own; the next deliberate call
         starts clean. */
      enginePromise = null;
      scheduleNetRetry(message);
      return null;
    }
  })();
  return enginePromise;
}

/** The arrival request: the visitor has reached the machine. */
export function requestModel(): void {
  void preload(false);
}

/* ---- background download ------------------------------------------------
   Same facts as an arrival - no WebGPU, Data Saver, a phone or tablet, under
   4 GB of RAM, too little browser storage, ?rag=off, plate rendering - and any
   one of them means nothing is fetched. A background tab is NOT a reason to
   wait here: this is only a download, and a link opened in a new tab and read
   later is exactly the visitor it helps most. Each part runs once a page. */
const warmed = new Set<WarmPart>();

export function warmModel(part: WarmPart): void {
  if (!backend.warm || warmed.has(part)) return;
  const q = typeof location === "undefined" ? "" : location.search;
  if (/[?&]rag=off/.test(q) || /[?&]frame=/.test(q)) return;
  const verdict = arrivalVerdict();
  if (!verdict.ok && verdict.permanent) return;
  warmed.add(part);
  void (async () => {
    /* A refresh, or a return visit: everything is already on disk, so the
       only work left is the GPU's, and it is done now, quietly, while the
       visitor is on the hero - the machine is simply ready when they get
       there. No browser keeps a model on the GPU across a reload; this is
       the nearest thing to it. Waits for the hero's own entrance to finish
       and for an idle moment, and goes through the arrival's gates (no
       clip on screen, tab visible). Never on a first visit: there, the GPU
       work stays on demand under the progress bar. */
    if (part === "landing" && (await backend.cached?.())) {
      const go = () => void preload(false);
      const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      window.setTimeout(() => (idle ? idle(go, { timeout: 2000 }) : go()), RETURN_VISIT_DELAY_MS);
      return;
    }
    if (await storageShortfall()) return;
    /* not while a transition clip is playing: the next file waits for it */
    await backend.warm!(part, () => !isClipBusy());
  })().catch((err) => {
    warmed.delete(part); // a later call may try again; the arrival will anyway
    console.warn(`[rag] background download (${part}) stopped; the machine will finish it`, err);
  });
}

/** After the hero's entrance (words rising, rules drawing) has played. */
const RETURN_VISIT_DELAY_MS = 1800;

/* ---- a dropped connection ------------------------------------------------
   A laptop that sleeps, or Wi-Fi that switches networks, kills every
   download in flight. Measured 2026-10-21/22 on Brian's own Mac, asleep on
   battery: ERR_NETWORK_IO_SUSPENDED, ERR_NETWORK_CHANGED,
   ERR_INTERNET_DISCONNECTED - and the machine sat on its fault screen until
   someone clicked RETRY. Chrome did NOT fire "online" afterwards (it never
   decided it had been offline), so that event alone is not enough.

   So a load that failed for any reason other than the GPU is retried on its
   own: on a backoff timer, the moment the tab is visible again (the laptop
   woke), and when the browser does say it is back online. Each retry
   re-runs the background parts too - finished files are skipped, failed
   ones fetched again - and asks for the model the way it was first asked. */
let asked: null | "arrival" | "click" = null;

/** Faults a retry cannot fix. Everything else is treated as the network. */
const GPU_FAULT = /device|adapter|webgpu|navigator\.gpu|out of memory|shader|destroyed/i;
const NET_RETRY_MS = [3_000, 10_000, 30_000, 60_000];
const NET_RETRY_MAX = 22; // about twenty minutes, then the RETRY button
let netRetries = 0;
let netTimer = 0;

function retryNow() {
  if (netTimer) {
    window.clearTimeout(netTimer);
    netTimer = 0;
  }
  for (const part of warmed) void backend.warm?.(part, () => !isClipBusy()).catch(() => {});
  if (state.phase === "error" && asked && !enginePromise) void preload(asked === "click");
}

function scheduleNetRetry(message: string) {
  if (!asked || netTimer || GPU_FAULT.test(message) || netRetries >= NET_RETRY_MAX) return;
  const ms = NET_RETRY_MS[Math.min(netRetries, NET_RETRY_MS.length - 1)];
  netRetries++;
  set({ phase: "error", detail: `connection lost — retrying in ${Math.round(ms / 1000)} s` });
  netTimer = window.setTimeout(() => {
    netTimer = 0;
    retryNow();
  }, ms);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function")
  window.addEventListener("online", retryNow);
if (typeof document !== "undefined" && typeof document.addEventListener === "function")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.phase === "error") retryNow();
  });

/** Put the module back to how it started.
 *
 *  Exists for scripts/engine-gates.ts, which runs every gate in one process
 *  and needs each case to begin from nothing. Deliberately not guarded by a
 *  build flag: a reachable reset is worth more than a clever one, and the
 *  cost of it existing in the bundle is a dozen bytes.
 */
export function __resetForTests() {
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = 0;
  attempts = 0;
  enginePromise = null;
  inflight = null;
  warmed.clear();
  asked = null;
  if (netTimer) window.clearTimeout(netTimer);
  netTimer = 0;
  netRetries = 0;
  __resetDownloadsForTests();
  state = { phase: "idle", detail: "model not requested yet" };
}

export interface GenerationResult {
  aborted: boolean;
  tokens: number;
  seconds: number;
}

/* One generation at a time. A second question while the first is still
   streaming used to throw, which flipped the state to "error" for good -
   every later question fell back to raw fragments until reload. Now a new
   request interrupts the old one and waits for it to unwind, and a failed
   generation reports itself and leaves the model READY. */
let inflight: Promise<GenerationResult | null> | null = null;

/* A lost GPU device does not heal, and every later question would fall back to
   raw fragments while the status line kept saying the model was ready. When
   the failure reads as fatal the engine is torn down and reported, so the
   section tells the truth and offers the visitor a way back. */
const FATAL = /device (is )?lost|destroyed|out of memory|adapter/i;

/** Stream an answer. Returns null if the model isn't ready (caller falls back
 *  to extractive mode). onToken receives the growing text, not deltas. */
export async function generate(
  system: string,
  user: string,
  onToken: (text: string) => void,
  signal?: AbortSignal
): Promise<GenerationResult | null> {
  if (state.phase !== "ready" && state.phase !== "generating") return null;
  const runner = await enginePromise!;
  if (!runner) return null;

  if (inflight) {
    try {
      await runner.interrupt();
    } catch {
      /* nothing to interrupt */
    }
    await inflight.catch(() => null);
  }
  if (signal?.aborted) return null;

  const run = (async (): Promise<GenerationResult | null> => {
    set({ phase: "generating", detail: "sampling tokens on your GPU" });
    let fatal = "";
    try {
      const stats = await runner.generate(system, user, onToken, signal);
      return { aborted: !!signal?.aborted, tokens: stats.tokens, seconds: stats.seconds };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (FATAL.test(msg)) {
        enginePromise = null;
        fatal = msg;
      } else {
        /* one bad generation is not a dead model */
        console.warn("[rag] generation failed; model stays loaded", err);
      }
      return null;
    } finally {
      set(
        fatal
          ? { phase: "error", detail: fatal }
          : { phase: "ready", detail: "weights cached in this browser" }
      );
    }
  })();

  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}
