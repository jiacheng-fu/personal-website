/* The generation stage: Qwen3-0.6B running in the visitor's browser.
 *
 * Everything about this model is local. The weights (~400 MB, quantized)
 * stream from Hugging Face's CDN into the browser's Cache API storage, the
 * shaders compile on the visitor's own GPU via WebGPU, and inference never
 * leaves the machine. There is no API key anywhere in this repo and the
 * site stays static files - which is the reason this path was chosen over
 * a serverless proxy.
 *
 * The engine is a plain module singleton with a subscriber list rather than
 * a React context: the section component mounts and unmounts as the visitor
 * scrolls, but a 400 MB download must belong to the page, not to a
 * component's lifetime.
 *
 * WebLLM is imported dynamically inside preload(), so none of its ~1 MB
 * reaches the main chunk (same policy as three.js in App.tsx).
 */

import { isClipBusy } from "./transitions";

// One string to swap models. Must exist in WebLLM's prebuilt list.
export const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";
export const MODEL_LABEL = "Qwen3 0.6B · q4f16 · ~400 MB";

export type EngineState =
  | { phase: "idle"; detail: string } // gates not yet consulted / declined
  | { phase: "queued"; detail: string } // deferred on a transient signal, retrying
  | { phase: "unavailable"; detail: string } // no WebGPU etc - permanent
  | { phase: "downloading"; detail: string; progress: number }
  | { phase: "compiling"; detail: string }
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
   Pulling 400 MB uninvited is only defensible when every signal says the
   visitor won't feel it. But a failed gate is now two different things, and
   conflating them was a real bug: some signals are facts about the machine
   and some are weather.

   `navigator.connection.effectiveType` is the weather. It is a rolling
   estimate of RECENT throughput, and this page opens by pulling three.js, a
   GLB, four video clips, fonts and reels - during which a gigabit connection
   cheerfully reports "3g". The auto-load ran on an idle callback right in the
   middle of that storm, read the number, wrote the model off for the whole
   visit and left the section saying MODEL NOT LOADED. Reload with a warm
   cache, less traffic, "4g", and it worked - which is exactly the "sometimes"
   in the bug report.

   So a transient verdict now DEFERS and is asked again; only a permanent one
   refuses, and only WebGPU refuses forever. */
export type Verdict = { ok: true } | { ok: false; reason: string; permanent: boolean };

/* "4g" is a much weaker promise than it sounds: the spec's threshold is about
   700 kbps, at which 400 MB takes over an hour. It is the right check for
   "not on a train", and the wrong one for "can afford this download", so the
   estimated bandwidth is checked too. Browsers cap `downlink` at 10 Mbps for
   fingerprinting reasons, so 5 is a real bar and not an unreachable one. */
const MIN_DOWNLINK_MBPS = 5;

/* And one good reading is not enough to commit 400 MB. Deferring on a bad
   reading (rather than giving up, as this used to) means the auto-load is now
   watching for its moment - so it must not take a single optimistic blip on
   an otherwise poor connection as its moment. Two readings in a row, seconds
   apart, are cheap insurance against that. */
const CONFIRMATIONS = 2;
let goodReadings = 0;

export function autoloadVerdict(): Verdict {
  const nav = navigator as Navigator & {
    gpu?: unknown;
    connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
    deviceMemory?: number;
    maxTouchPoints?: number;
  };

  /* ---- facts about the machine, and the visitor's stated preference ---- */
  if (!nav.gpu) return { ok: false, reason: "no WebGPU in this browser", permanent: true };
  if (nav.connection?.saveData) return { ok: false, reason: "Data Saver is on", permanent: true };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4)
    return { ok: false, reason: "device reports <4 GB RAM", permanent: true };
  /* iPadOS calls itself a Macintosh, and an iPad with WebGPU would otherwise
     sail through every one of these checks and start pulling 400 MB over
     someone's cellular plan. A pointing device that reports ten fingers is
     not a desktop. */
  const handheld =
    /Mobi|Android/i.test(navigator.userAgent) ||
    ((nav.maxTouchPoints ?? 0) > 1 && /Macintosh/.test(navigator.userAgent));
  if (handheld) return { ok: false, reason: "handheld device", permanent: true };

  /* ---- weather: worth waiting out, never worth overriding ---- */
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return { ok: false, reason: "the tab is in the background", permanent: false };
  const conn = nav.connection;
  if (conn?.effectiveType && conn.effectiveType !== "4g")
    return { ok: false, reason: `connection reports ${conn.effectiveType}`, permanent: false };
  if (typeof conn?.downlink === "number" && conn.downlink < MIN_DOWNLINK_MBPS)
    return { ok: false, reason: `connection estimates ${conn.downlink} Mbps`, permanent: false };
  return { ok: true };
}

/* ~400 MB of weights, and the browser needs room to store and unpack them. If
   there is not that much space left, starting the download fills the
   visitor's remaining quota to the brim and then fails on the last chunk -
   worse for them than never having started. */
const MODEL_BYTES = 420 * 1024 * 1024;

async function storageShortfall(): Promise<string | null> {
  const store = navigator.storage;
  if (!store?.estimate) return null; // browser won't say; not grounds to refuse
  try {
    const { quota = 0, usage = 0 } = await store.estimate();
    if (!quota) return null;
    const free = quota - usage;
    return free < MODEL_BYTES * 1.25
      ? `only ${Math.round(free / 1e6)} MB of browser storage left, and the model needs ~400 MB`
      : null;
  } catch {
    return null;
  }
}

/* How long the auto-load keeps asking - and it should ask for a long time.
   The machine is the THIRD section. Between arriving and scrolling to it a
   visitor reads a hero, watches a keyboard assemble itself and goes through
   the work index, which is minutes, not seconds. Nothing is gained by giving
   up inside the first one: a re-check costs a property read, and the download
   only starts when the answer is finally yes.

   So the retry backs OFF rather than stopping - eagerly at first, because the
   most common case by far is a connection reading polluted by the page's own
   asset load and clearing within seconds, then slower and slower, settling
   into a half-minute pulse it can hold for the rest of the visit.

   The attempt cap is a runaway backstop, not a policy: at this backoff it
   sits well beyond the ten minutes of patience, so what actually ends the
   waiting in a browser is the clock. */
const CLIP_RETRY_MS = 600;
const LINE_FIRST_MS = 2500;
const LINE_BACKOFF = 1.4;
const LINE_MAX_MS = 30_000;
const PATIENCE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 60;

let attempts = 0;
let waitingSince = 0;
let lineDelay = LINE_FIRST_MS;
let retryTimer = 0;

function defer(kind: "line" | "clip", reason: string) {
  if (retryTimer || enginePromise) return;
  if (!waitingSince) waitingSince = Date.now();
  const waited = Date.now() - waitingSince;
  if (++attempts > MAX_ATTEMPTS || waited > PATIENCE_MS) {
    set({
      phase: "idle",
      detail: `auto-load gave up after ${Math.round(waited / 1000)}s of ${reason}`,
    });
    return;
  }
  let ms = CLIP_RETRY_MS;
  if (kind === "line") {
    ms = lineDelay;
    lineDelay = Math.min(Math.round(lineDelay * LINE_BACKOFF), LINE_MAX_MS);
  }
  set({ phase: "queued", detail: `waiting to auto-load — ${reason}` });
  retryTimer = window.setTimeout(() => {
    retryTimer = 0;
    void preload(false);
  }, ms);
}

/* A tab opened in the background and read later is the other way this used to
   go wrong: the checks happen while nobody is looking, on a throttled timer,
   and the visitor arrives to a machine that gave up in private. Coming back
   to the tab restarts the asking at full eagerness - whatever was true about
   the connection while it was hidden is not news any more. */
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (enginePromise || state.phase !== "queued") return;
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }
    lineDelay = LINE_FIRST_MS;
    void preload(false);
  });
}

type Engine = import("@mlc-ai/web-llm").MLCEngine;
let enginePromise: Promise<Engine | null> | null = null;

/** Start loading the model. Idempotent; safe to call from a button after the
 *  auto-preload already began. force=true skips the etiquette gates (it is
 *  the visitor's own click) but never the WebGPU one. */
export function preload(force = false): Promise<Engine | null> {
  if (enginePromise) return enginePromise;
  /* An attempt is already queued, so this call is a duplicate - and it must
     not be allowed to stand in as the confirming second reading. The two
     readings have to be SECONDS apart to mean anything; two in the same tick
     mean nothing at all. React's StrictMode double-invokes effects in
     development and did exactly that, turning "check twice before committing
     400 MB" into "check twice in one millisecond and commit". */
  if (!force && retryTimer) return Promise.resolve(null);
  if (force && retryTimer) {
    window.clearTimeout(retryTimer); // the visitor's own click outranks the queue
    retryTimer = 0;
  }

  if (!force) {
    /* Never start the download/compile while a transition clip is on screen -
       it competes with video decode and the compositor and makes the clip
       drop frames. A "not yet", asked again shortly. */
    if (isClipBusy()) {
      defer("clip", "a transition clip is playing");
      return Promise.resolve(null);
    }

    const verdict = autoloadVerdict();
    if (!verdict.ok) {
      if (!verdict.permanent) {
        goodReadings = 0; // the streak is broken; start counting again
        defer("line", verdict.reason);
        return Promise.resolve(null);
      }
      const noGpu = verdict.reason.includes("WebGPU");
      set(
        noGpu
          ? { phase: "unavailable", detail: verdict.reason }
          : { phase: "idle", detail: `auto-load skipped: ${verdict.reason}` }
      );
      if (!noGpu) return Promise.resolve(null); // the button still works
      enginePromise = Promise.resolve(null); // no point re-checking WebGPU
      return enginePromise;
    }
    if (++goodReadings < CONFIRMATIONS) {
      defer("line", "confirming the connection can carry 400 MB");
      return Promise.resolve(null);
    }
  } else if (!(navigator as { gpu?: unknown }).gpu) {
    set({ phase: "unavailable", detail: "no WebGPU in this browser" });
    enginePromise = Promise.resolve(null);
    return enginePromise;
  }

  enginePromise = (async () => {
    try {
      const shortfall = await storageShortfall();
      if (shortfall) {
        set({ phase: "idle", detail: `auto-load skipped: ${shortfall}` });
        enginePromise = null; // they may free space; the button still works
        return null;
      }
      set({ phase: "downloading", detail: "fetching weights", progress: 0 });
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (p) => {
          /* WebLLM's text is chatty; keep the raw line as the detail (it is
             exactly the kind of guts this section exists to show) and split
             the phases on it. */
          if (/loading gpu|shader/i.test(p.text) || p.progress >= 1)
            set({ phase: "compiling", detail: p.text });
          else set({ phase: "downloading", detail: p.text, progress: p.progress });
        },
      });
      set({ phase: "ready", detail: "weights cached in this browser" });
      return engine;
    } catch (e) {
      set({ phase: "error", detail: e instanceof Error ? e.message : String(e) });
      /* Let go of the failed attempt. A dropped connection mid-download, a GPU
         that was busy, a tab that was backgrounded at the wrong moment - all
         transient, and all of them used to be permanent for the rest of the
         visit, because the rejected promise stayed cached here and every
         later call, including the visitor's own retry button, was handed the
         same failure. Nothing retries on its own; the next deliberate call
         starts clean. */
      enginePromise = null;
      return null;
    }
  })();
  return enginePromise;
}

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
  goodReadings = 0;
  waitingSince = 0;
  lineDelay = LINE_FIRST_MS;
  enginePromise = null;
  inflight = null;
  state = { phase: "idle", detail: "model not requested yet" };
}

/** Start the model as early as the page can afford it.
 *
 *  Not tied to the RAG section: by the time a visitor scrolls down to the
 *  machine the weights should already be in the browser's cache, and which
 *  section they happen to be looking at has nothing to do with it.
 *
 *  "As early as it can afford" means the page's own load event, not an idle
 *  callback with an eight second timeout - on a busy main thread that idle
 *  window arrived late, in the middle of the asset storm, and got a bad
 *  connection reading for its trouble. After `load` the site's own fetches
 *  are done and the line is genuinely clear.
 */
export function scheduleAutoPreload() {
  /* ?rag=off keeps the model away entirely - for testing the extractive
     fallback (and screenshots) without a GPU-resident model. */
  const q = new URLSearchParams(location.search);
  if (q.get("rag") === "off" || q.has("frame")) return;
  const kick = () => window.setTimeout(() => void preload(false), 250);
  if (document.readyState === "complete") kick();
  else window.addEventListener("load", kick, { once: true });
}

export interface GenerationResult {
  aborted: boolean;
  tokens: number;
  seconds: number;
}

/* WebLLM runs one generation at a time. A second question while the first
   is still streaming used to throw, which flipped the state to "error" for
   good - every later question fell back to raw fragments until reload. Now
   a new request interrupts the old one and waits for it to unwind, and a
   failed generation reports itself and leaves the model READY. */
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
  const engine = await enginePromise!;
  if (!engine) return null;

  if (inflight) {
    try {
      await engine.interruptGenerate();
    } catch {
      /* nothing to interrupt */
    }
    await inflight.catch(() => null);
  }
  if (signal?.aborted) return null;

  const run = (async (): Promise<GenerationResult | null> => {
    set({ phase: "generating", detail: "sampling tokens on your GPU" });
    let fatal = "";
    const t0 = performance.now();
    let tokens = 0;
    let text = "";
    try {
      const stream = await engine.chat.completions.create({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: true,
        max_tokens: 220,
        temperature: 0.3,
        /* Qwen3 is a reasoning model by default; its <think> monologue at 0.6B
           is long and rarely improves a grounded answer. Belt (option) and
           suspenders (strip tags below). */
        extra_body: { enable_thinking: false },
      });
      for await (const delta of stream) {
        if (signal?.aborted) {
          await engine.interruptGenerate();
          break;
        }
        const piece = delta.choices[0]?.delta?.content ?? "";
        if (!piece) continue;
        tokens++;
        text += piece;
        onToken(text.replace(/<think>[\s\S]*?(<\/think>|$)/, "").trimStart());
      }
      return { aborted: !!signal?.aborted, tokens, seconds: (performance.now() - t0) / 1000 };
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
