import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { retrieve, chunks, addChunk, hasEvidence, MIN_EVIDENCE, type Retrieval, type ScoredChunk } from "../lib/bm25";
import { assemblePrompt, userMessage, type PromptParts } from "../lib/ragPrompt";
import {
  engineState,
  subscribe,
  preload,
  requestModel,
  generate,
  backend,
  mb,
  llmOptedIn,
  setLlmOptIn,
  type EngineState,
} from "../lib/ragEngine";
import { extractAnswer, type Quote } from "../lib/extract";

import Apple2Front from "./Apple2Front";
import FeedShred from "./FeedShred";

/* ---------------------------------------------------------------------------
   The RAG section, performed on a front-view Apple ][-style illustration.

   The machine is a flat SVG drawing (Apple2Front) with its shading painted
   on; the green-phosphor terminal is a live DOM subtree placed on the drawn
   monitor face, square-on so it reads like a real screen. At rest the whole machine is on
   stage; when a question fires, the camera pushes into the glass and the
   pipeline - the archive tearing into fragments, the BM25 scan, the
   answer quoted word for word (or, switched on, the model speaking) - plays
   out full-size. The hardware is
   honest: the LED is wired to the real engine state, the status line
   reports the actual model, and every number on the glass is the live
   pipeline's. The pipeline logic is unchanged from the previous stagings.
   --------------------------------------------------------------------------- */

const ease = [0.16, 1, 0.3, 1] as const;

type Act = "rest" | "tear" | "scan" | "fuse" | "speak";

const SUGGESTIONS = [
  "What did Brian do at his compiler internship?",
  "Tell me about his AI project",
  "What security work has he done?",
  "Does he know React?",
];

interface Answer {
  mode: "model" | "extractive" | "none";
  text: string;
  /* the archive's own sentences: the whole answer when quoting, and the
     check printed under a model's answer */
  quotes?: Quote[];
  stats?: { tokens: number; seconds: number };
  done: boolean;
  /* why the model didn't answer, when it didn't */
  fallback?: "loading" | "absent" | "stumbled";
  /* the evidence came (at least partly) from something a visitor typed */
  fromVisitor?: boolean;
}

interface Run {
  query: string;
  retrieval: Retrieval;
  prompt: PromptParts;
}

/** Enough evidence to spend GPU cycles? Below the floor the model is never
 *  invoked - a canned refusal costs nothing and cannot hallucinate. */

/* One line of stage direction per act, in the machine's voice. */
function narration(act: Act, run: Run | null, answer: Answer | null, engine: EngineState): string {
  switch (act) {
    case "rest":
      return "";
    case "tear":
      return `TEARING ARCHIVE INTO ${chunks.length} FRAGMENTS…`;
    case "scan":
      return "SCANNING FRAGMENTS FOR YOUR TERMS…";
    case "fuse": {
      if (!run || !hasEvidence(run.retrieval)) return "NOTHING SCORED ABOVE THE EVIDENCE FLOOR.";
      const n = run.retrieval.top.length;
      return `${n} FRAGMENT${n > 1 ? "S" : ""} SURVIVED — ASSEMBLING BRIEFING…`;
    }
    case "speak":
      if (answer?.mode === "extractive")
        return answer.fallback === "loading"
          ? "MODEL STILL LOADING — QUOTING THE ARCHIVE MEANWHILE:"
          : answer.fallback === "stumbled"
            ? "MODEL STUMBLED ON THAT ONE — QUOTING THE ARCHIVE:"
            : answer.fallback === "absent"
              ? "NO MODEL ON THIS MACHINE — QUOTING THE ARCHIVE:"
              : "QUOTING THE ARCHIVE, WORD FOR WORD:";
      if (answer?.mode === "none") return "ARCHIVE MISS.";
      if (engine.phase === "generating" || !answer?.done) return "MODEL READING BRIEFING…";
      return "DONE. EVERY STEP ABOVE WAS REAL.";
  }
}

/* The screen's status line + the case LED read the same engine state. */
function engineStatus(engine: EngineState): { text: string; led: "off" | "busy" | "on" } {
  switch (engine.phase) {
    case "idle":
      return { text: "MODEL: NOT LOADED — QUOTING THE ARCHIVE", led: "off" };
    case "queued":
      /* requested, waiting out something brief (a clip still fading, a tab
         switched away) - the machine is waiting, not broken, and says so */
      return { text: "MODEL: STARTING…", led: "busy" };
    case "unavailable":
      /* no WebGPU at all, or a GPU that cannot run this model (no
         shader-f16, or software only) - said plainly either way */
      return {
        text: engine.detail.startsWith("no WebGPU in")
          ? "MODEL: NO WEBGPU HERE — QUOTING THE ARCHIVE"
          : "MODEL: NEEDS WEBGPU WITH SHADER-F16, NOT AVAILABLE HERE — QUOTING THE ARCHIVE",
        led: "off",
      };
    case "downloading":
      return {
        text: notYet(engine)
          ? "MODEL: STARTING…"
          : engine.stage === "fetch"
            ? `MODEL: DOWNLOADING ${pct(engine.progress)}% · ${mb(engine.bytes)} MB`
            : `MODEL: LOADING ONTO YOUR GPU ${pct(engine.progress)}%`,
        led: "busy",
      };
    case "compiling":
      return { text: "MODEL: COMPILING SHADERS ON YOUR GPU…", led: "busy" };
    case "ready":
      return { text: `MODEL: ${backend.name} · GPU: YOURS · UPLINK: NONE`, led: "on" };
    case "generating":
      return { text: "MODEL: GENERATING ON YOUR GPU", led: "on" };
    case "error":
      return engine.detail.startsWith("connection lost")
        ? { text: "MODEL: CONNECTION LOST — RETRYING…", led: "busy" }
        : { text: "MODEL: FAULT — QUOTING THE ARCHIVE", led: "off" };
  }
}

const pct = (f: number) => Math.floor(f * 100);

/* The load has begun but the runtime has not reported anything yet - no byte
   has arrived and no stage has been named. A cached model goes straight to
   the GPU stage from here, so printing "DOWNLOADING 0%" in this gap would
   announce a download that is not happening. */
const notYet = (e: EngineState) =>
  e.phase === "downloading" && e.stage === "fetch" && e.bytes === 0 && e.progress === 0;

/* The boot screen's progress bar. It draws the model's load exactly as the
   runtime reports it - the stage it is in and that stage's own fraction -
   and nothing else: no easing toward a guess, no fake minimum. WebLLM counts
   its download in whole weight shards, so on a cold load the bar moves in
   steps of a shard; that is the runtime's granularity, shown as it is.
   `fill` null is a stage the runtime gives no count for. */
function loadLine(engine: EngineState): { label: string; fill: number | null } {
  switch (engine.phase) {
    case "queued":
      return { label: `STARTING ${backend.name}…`, fill: 0 };
    case "downloading":
      if (notYet(engine)) return { label: `STARTING ${backend.name}…`, fill: 0 };
      return engine.stage === "fetch"
        ? { label: `DOWNLOADING ${backend.name} ${pct(engine.progress)}% · ${mb(engine.bytes)} MB`, fill: engine.progress }
        : { label: `LOADING WEIGHTS ONTO YOUR GPU ${pct(engine.progress)}%`, fill: engine.progress };
    case "compiling":
      return engine.progress === null
        ? { label: "COMPILING ON YOUR GPU…", fill: null }
        : { label: `COMPILING SHADERS ${pct(engine.progress)}%`, fill: engine.progress };
    case "ready":
    case "generating":
      return { label: `${backend.name} LOADED`, fill: 1 };
    case "unavailable":
      return {
        label: engine.detail.startsWith("no WebGPU in")
          ? "NO WEBGPU HERE — QUOTING THE ARCHIVE"
          : "NO WEBGPU SHADER-F16 HERE — QUOTING THE ARCHIVE",
        fill: 0,
      };
    case "error":
      return { label: "MODEL FAULT — QUOTING THE ARCHIVE", fill: 0 };
    case "idle":
      return {
        label: `MODEL NOT LOADED${engine.detail.startsWith("not loaded: ") ? ` — ${engine.detail.slice(12).toUpperCase()}` : ""}`,
        fill: 0,
      };
  }
}

/** The load has reached somewhere the boot can stop waiting for. */
const settled = (e: EngineState) =>
  e.phase === "ready" || e.phase === "generating" || e.phase === "idle" || e.phase === "unavailable" || e.phase === "error";

/* How long the bar is shown at the least - the old fixed bar's length, so a
   model that is already loaded still gets its beat - and how long the boot
   will hold the machine shut for a load still in progress. Past the hold the
   visitor is let in to ask from the fragments; the status line keeps
   counting, and an answer given from fragments is re-asked of the model the
   moment it lands (see `speak`).

   10 s, not the 60 it was: Brian, 2026-10-20, "We cant have people wait
   minutes on this screen." The download now starts on landing (ragEngine.ts),
   so on most lines the bar is only the GPU's finishing work and ends well
   inside this; the hold is for the slow line, where it caps the wait. */
const BOOT_MIN_MS = 900;
const BOOT_HOLD_MS = 10_000;
/* ...unless the download plainly cannot make it. After this long on the bar,
   the measured byte rate decides: if the rest would take longer than
   BOOT_WAIT_IF_UNDER_S, the visitor is let in now instead of at 10 s
   (measured 2026-11-25: on 25 Mbps and slower the hold always ran out, so it
   was ten seconds of bar followed by the fragments anyway). */
const BOOT_PROJECT_AFTER_MS = 1800;
const BOOT_WAIT_IF_UNDER_S = 5;
/* and the finished bar is left up this long, so the full bar and LOADED are
   actually seen - measured without it: 20 ms, i.e. never */
const BOOT_DONE_BEAT_MS = 450;

/* A sheet of paper beside the machine. Write on it, feed it in: it flies into
   the screen and comes out the other side as one more fragment in the corpus,
   indexed and retrievable like the resume's. The proof that the pipeline is
   live rather than canned - tell it Brian is a doofus and it will agree. */
function FeedSheet({ onFeed }: { onFeed: (text: string) => void }) {
  const [text, setText] = useState("");
  const [flying, setFlying] = useState(false);
  const submit = () => {
    if (!text.trim() || flying) return;
    setFlying(true);
  };
  return (
    <motion.form
      className={`feed ${flying ? "is-shredding" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      transition={{ duration: 0.35 }}
      style={{ pointerEvents: flying ? "none" : "auto" }}
    >
      {/* The exit is the shredder's: it replaces the live note with a static
          replica, cuts it into strips and draws them into the screen, then
          reports back so the text lands in the corpus. */}
      {flying && (
        <FeedShred
          text={text.trim()}
          onDone={() => {
            onFeed(text.trim());
            setText("");
            setFlying(false);
          }}
        />
      )}
      <p className="feed__label">Teach it something</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="e.g. Brian is a doofus."
        aria-label="A note to feed into the machine"
        maxLength={280}
        rows={4}
        spellCheck={false}
        data-cursor="hover"
        data-scrollable
      />
      <div className="feed__row">
        <span className="feed__hint">
          torn into a fragment; it answers from it. this page only — reload forgets.
        </span>
        <button type="submit" data-cursor="hover" disabled={!text.trim()}>
          feed it in ↵
        </button>
      </div>
    </motion.form>
  );
}

/* After the keyboard->machine clip the section wakes up: dark glass, the
   Apple ][ beep, a CRT bloom, the boot menu typing itself in, and only then
   the page chrome. Phases are wall-clock, like the keyboard's lamp. */
/* black glass -> tube on (blank green) -> the progress bar, which is the
   model actually loading, held until the load settles -> the boot text types
   in. */
type BootPhase = "done" | "off" | "on" | "loading" | "typing";

export default function RagSection({ active, boot = 0, leaving = 0 }: { active: boolean; boot?: number; leaving?: number }) {
  const reduce = useReducedMotion();

  const [input, setInput] = useState("");
  const [act, setAct] = useState<Act>("rest");
  const [run, setRun] = useState<Run | null>(null);
  const [order, setOrder] = useState<ScoredChunk[] | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [engine, setEngine] = useState<EngineState>(engineState());
  /* the visitor's choice: quotes (default), or the LLM on top */
  const [llmOn, setLlmOn] = useState(llmOptedIn);
  const [confirming, setConfirming] = useState(false);
  /* documents the visitor has fed in this session */
  const [fed, setFed] = useState(0);
  const [ingested, setIngested] = useState<string | null>(null);
  const ingestTimer = useRef<number>(0);

  const abortRef = useRef<AbortController | null>(null);
  /* unsubscribe for a pending "ask it again once the model lands" watch */
  const upgradeRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const [bootPhase, setBootPhase] = useState<BootPhase>("done");
  /* scrolling up into the reverse clip: black the glass at once so the clip's
     first frame (machine, dark screen) covers it with no visible change */
  useEffect(() => {
    if (leaving) setBootPhase("off");
  }, [leaving]);
  useEffect(() => {
    if (!boot) return;
    /* the clip ended on a dark, silent machine at rest: match it exactly */
    abortRef.current?.abort();
    upgradeRef.current?.();
    upgradeRef.current = null;
    timersRef.current.forEach(clearTimeout);
    setAct("rest");
    setRun(null);
    setAnswer(null);
    setBootPhase("off");
    const t1 = window.setTimeout(() => setBootPhase("on"), 380); // tube warms: blank green
    const t2 = window.setTimeout(() => {
      /* Coming back to a model that is already loaded: there is nothing to
         load, so there is no bar - a bar here would read as the machine
         loading itself all over again. The tube warms and the menu types
         in, and that is all. */
      /* Quotes need nothing loaded, and neither does a model that already
         is: straight to the menu. */
      const p = engineState().phase;
      if (!llmOptedIn() || p === "ready" || p === "generating") {
        setBootPhase("typing");
        return;
      }
      loadingSince.current = performance.now();
      setBootPhase("loading"); // the model's own progress, held below
    }, 900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [boot]);

  /* The hold. The bar stays up until the load settles (or BOOT_HOLD_MS runs
     out), and for at least BOOT_MIN_MS. Keyed on the PHASE, not the progress,
     so the timer is re-armed when the load changes stage and left alone while
     it is merely counting. */
  const loadingSince = useRef(0);
  useEffect(() => {
    if (bootPhase !== "loading") return;
    const elapsed = performance.now() - loadingSince.current;
    const wait = settled(engine)
      ? Math.max(BOOT_DONE_BEAT_MS, BOOT_MIN_MS - elapsed)
      : Math.max(0, BOOT_HOLD_MS - elapsed);
    const t = window.setTimeout(() => setBootPhase("typing"), wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootPhase, engine.phase]);
  useEffect(() => {
    if (bootPhase !== "typing") return;
    const t = window.setTimeout(() => setBootPhase("done"), 1300);
    return () => clearTimeout(t);
  }, [bootPhase]);

  /* the download's real rate, from the runtime's own byte counts */
  const rate = useRef<{ t: number; bytes: number }[]>([]);
  useEffect(() => {
    if (engine.phase !== "downloading" || engine.stage !== "fetch" || engine.bytes <= 0) return;
    const r = rate.current;
    r.push({ t: performance.now(), bytes: engine.bytes });
    while (r.length > 2 && r[r.length - 1].t - r[0].t > 3000) r.shift();
  }, [engine]);
  useEffect(() => {
    if (bootPhase !== "loading") return;
    const iv = window.setInterval(() => {
      const e = engineState();
      if (e.phase !== "downloading" || e.stage !== "fetch") return;
      if (performance.now() - loadingSince.current < BOOT_PROJECT_AFTER_MS) return;
      const r = rate.current;
      if (r.length < 2) return;
      const a = r[0];
      const b = r[r.length - 1];
      const bps = (b.bytes - a.bytes) / Math.max(0.001, (b.t - a.t) / 1000);
      const total = e.progress > 0.01 ? e.bytes / e.progress : backend.bytes;
      const left = bps > 0 ? (total - e.bytes) / bps : Infinity;
      if (left > BOOT_WAIT_IF_UNDER_S) setBootPhase("typing");
    }, 400);
    return () => window.clearInterval(iv);
  }, [bootPhase]);

  /* ON DEMAND: reaching the machine is what asks for the model. Under reduced
     motion the section nav is off and `active` never moves, so there it is
     the section scrolling into view that asks. */
  useEffect(() => {
    if (active && llmOn) requestModel();
  }, [active, llmOn]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reduce || !rootRef.current) return;
    const io = new IntersectionObserver(
      (es) => es.some((e) => e.isIntersecting) && llmOptedIn() && requestModel(),
      { threshold: 0.5 }
    );
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, [reduce]);

  useEffect(() => subscribe(setEngine), []);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      upgradeRef.current?.();
      timersRef.current.forEach(clearTimeout);
    },
    []
  );

  const ask = (q: string) => {
    const query = q.trim();
    if (!query) return;
    abortRef.current?.abort();
    upgradeRef.current?.();
    upgradeRef.current = null;
    timersRef.current.forEach(clearTimeout);
    const ac = new AbortController();
    abortRef.current = ac;

    const retrieval = retrieve(query, 4);
    const prompt = assemblePrompt(query, retrieval.top);
    const thisRun = { query, retrieval, prompt };
    setRun(thisRun);
    setInput("");
    setAnswer(null);
    setOrder(retrieval.scored);

    /* Real work takes microseconds; the screen replays it at human speed. */
    const at = (ms: number, fn: () => void) =>
      timersRef.current.push(window.setTimeout(fn, reduce ? 0 : ms));
    setAct("tear");
    at(1000, () => setAct("scan"));
    at(2400, () => {
      setOrder([...retrieval.scored].sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id));
      setAct("fuse");
    });
    at(3400, () => {
      setAct("speak");
      void speak(thisRun, ac.signal);
    });
  };

  const speak = async (r: Run, signal: AbortSignal) => {
    /* The evidence floor is also the compute floor: a question the documents
       can't answer never reaches the model. No tokens, no GPU, no chance to
       hallucinate - the refusal is canned. */
    if (!hasEvidence(r.retrieval)) {
      setAnswer({
        mode: "none",
        text: !r.retrieval.understood
          ? "There are no words in that I can look up — no question, just punctuation. Try a few real ones: his work, his stack, his projects."
          : "My documents don't cover that, and this machine doesn't spend GPU cycles on general knowledge — it only speaks about Brian, from evidence. Ask about his work, his stack, or his projects.",
        done: true,
      });
      return;
    }
    /* THE ANSWER: the archive's own best sentences, word for word, each with
       its source (extract.ts). Microseconds, no download, nothing to get
       wrong - the default for everyone since 2026-11-25. */
    const quotes = extractAnswer(r.retrieval);
    const quoted = (fallback?: Answer["fallback"]): Answer => ({
      mode: "extractive",
      fallback,
      quotes,
      fromVisitor: quotes.some((q) => q.visitor),
      text: quotes.map((q) => q.text).join(" "),
      done: true,
    });
    if (!llmOptedIn()) {
      setAnswer(quoted());
      return;
    }
    /* a visitor's note counts as evidence like anything else - but the
       answer must say where it came from, and that is decided here, not
       left to the model's discretion */
    const fromVisitor = r.retrieval.top.some((s) => s.chunk.section === "Visitor" && s.score >= MIN_EVIDENCE);
    const result = await generate(
      r.prompt.system,
      userMessage(r.prompt),
      (text) => !signal.aborted && setAnswer({ mode: "model", text, quotes, done: false, fromVisitor }),
      signal
    );
    if (signal.aborted) return;
    if (result) {
      setAnswer((a) => a && { ...a, stats: { tokens: result.tokens, seconds: result.seconds }, done: true });
    } else {
      const phase = engineState().phase;
      const fallback =
        phase === "downloading" || phase === "compiling"
          ? "loading"
          : phase === "ready" || phase === "generating"
            ? "stumbled"
            : "absent";
      /* Quoting raw fragments because the weights had not landed yet is a
         PROVISIONAL answer, not a verdict. The visitor who scrolls straight
         to the machine and types immediately used to be the one person who
         never saw it work: the quote they got at four seconds stayed on
         screen while the model finished loading behind it. Now the same
         question is asked again the moment the engine reports ready, and the
         quote is replaced in place. Nothing is armed when there will never be
         a model to wait for. */
      if (engineState().phase !== "unavailable" && llmOptedIn()) {
        upgradeRef.current?.();
        let ignoredFirst = false;
        const off = subscribe((st) => {
          /* subscribe() replays the current state synchronously; that one is
             the state we already know about */
          if (!ignoredFirst) {
            ignoredFirst = true;
            return;
          }
          if (st.phase !== "ready" || !llmOptedIn()) return;
          off();
          upgradeRef.current = null;
          if (!signal.aborted) void speak(r, signal);
        });
        upgradeRef.current = off;
      }
      setAnswer(quoted(fallback));
    }
  };

  const feed = (text: string) => {
    const chunk = addChunk("Visitor", `Visitor note #${fed + 1}`, text);
    setFed((n) => n + 1);
    setIngested(`* DOCUMENT RECEIVED — TORN INTO 1 FRAGMENT: #${chunk.id} ${chunk.title.toUpperCase()}`);
    window.clearTimeout(ingestTimer.current);
    ingestTimer.current = window.setTimeout(() => setIngested(null), 6000);
  };

  const pickedIds = new Set(run?.retrieval.top.map((s) => s.chunk.id));
  const maxScore = run ? Math.max(...run.retrieval.scored.map((s) => s.score), 0.001) : 1;
  const performing = act !== "rest";
  const line = narration(act, run, answer, engine);
  const status = llmOn
    ? engineStatus(engine)
    : { text: "ANSWERS: QUOTED FROM THE ARCHIVE · UPLINK: NONE", led: "on" as const };
  const load = loadLine(engine);

  /* ?frame=case|grow33|grow66|off|tilt renders a clean plate for the
     transition clips (docs/transition-kb-machine.md): no page chrome, the
     machine in the requested state. Never set in normal use. */
  const frame = new URLSearchParams(location.search).get("frame");
  const grow = frame?.match(/^grow(\d+)$/);
  const fallM = frame?.match(/^fall(\d+)$/);
  const blobM = frame?.match(/^blob(\d+)$/);
  const frameProps =
    frame === "case"
      ? { monitor: 0 }
      : frame === "off"
        ? { screenOff: true }
        : grow
          ? { monitor: Number(grow[1]) / 100, screenOff: true }
          : fallM
            ? { monitor: 0, fall: Number(fallM[1]) / 100 }
            : blobM
              ? { monitor: 0, blob: Number(blobM[1]) / 100 }
              : {};

  const screen = (
    <div
      className={`a2-crt ${active ? "is-powered" : ""} ${bootPhase === "off" ? "a2-crt--off" : ""} ${bootPhase === "on" || bootPhase === "loading" ? "a2-crt--bloom" : ""}`}
      data-cursor="hover"
      onClick={() => inputRef.current?.focus()}
    >
      {/* boot screen */}
      {!performing && (
        <div className={`a2-boot ${bootPhase === "typing" ? "a2-boot--typing" : ""} ${bootPhase === "off" || bootPhase === "on" || bootPhase === "loading" ? "a2-boot--blank" : ""}`}>
          <p className="a2-boot__title">FU ][ PERSONAL ARCHIVE</p>
          <p className="a2-boot__sub">RETRIEVAL TERMINAL · REV 1</p>
          <p className="a2-boot__line">
            {chunks.length - fed} FRAGMENTS INDEXED FROM BRIAN'S ARCHIVE{fed > 0 ? ` + ${fed} FED BY YOU` : ""}
          </p>
          <p className="a2-boot__line a2-boot__line--dim">
            {llmOn ? (
              <>
                THE MODEL RUNS ON <b>YOUR</b> GPU. NOTHING YOU TYPE LEAVES THIS PAGE.
              </>
            ) : (
              <>
                ANSWERS ARE QUOTED, <b>WORD FOR WORD</b>. NOTHING YOU TYPE LEAVES THIS PAGE.
              </>
            )}
          </p>
          <p className="a2-boot__line">ASK ANYTHING ABOUT BRIAN, OR PICK:</p>
          <ol className="a2-boot__menu">
            {SUGGESTIONS.map((s, i) => (
              <li key={s}>
                <button type="button" data-cursor="hover" onClick={() => ask(s)}>
                  <span>{i + 1}.</span> {s.toUpperCase()}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* the performance */}
      {performing && (
        <div className="a2-perf">
          <p className="a2-perf__query">] {run?.query.toUpperCase()}</p>
          <AnimatePresence mode="wait">
            {line && (
              <motion.p
                key={act + (answer?.mode ?? "")}
                className="a2-perf__direction"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                * {line}
                {act !== "tear" && run && (
                  <span className="a2-perf__terms">
                    {" "}
                    [{run.retrieval.tokens.filter((t) => t.term).map((t) => t.raw.toUpperCase()).join(" ")}]
                    {run.retrieval.expanded.length > 0 && (
                      <span className="a2-perf__expanded"> +{run.retrieval.expanded.map((t) => t.toUpperCase()).join(" ")}</span>
                    )}
                  </span>
                )}
              </motion.p>
            )}
          </AnimatePresence>

          {order && act !== "speak" && (
            <div className="a2-frags" data-scrollable>
              {act === "scan" && !reduce && <div className="a2-scanline" />}
              {order.map((s, i) => {
                const picked = pickedIds.has(s.chunk.id);
                const scored = act === "scan" || act === "fuse";
                const judged = act === "fuse";
                return (
                  <motion.div
                    key={s.chunk.id}
                    layout
                    className={`a2-frag ${judged ? (picked ? "is-picked" : "is-dead") : ""} ${s.chunk.section === "Visitor" ? "is-visitor" : ""}`}
                    initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      duration: 0.35,
                      ease,
                      delay: act === "tear" ? i * 0.05 : 0,
                      layout: { duration: 0.45, ease },
                    }}
                  >
                    <span className="a2-frag__bar" style={{ transform: `scaleX(${scored ? s.score / maxScore : 0})` }} />
                    <span className="a2-frag__title">{s.chunk.title.toUpperCase()}</span>
                    <span className="a2-frag__score">
                      {scored && s.chunk.section === "Visitor" && s.score > 0 && (
                        <span className="a2-frag__fresh">FRESH </span>
                      )}
                      {scored && s.score > 0 ? s.score.toFixed(2) : ""}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          )}

          {act === "speak" && (
            <motion.div
              className="a2-speech"
              data-scrollable
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              {answer?.mode === "extractive" && answer.quotes ? (
                answer.quotes.map((q, i) => (
                  <p key={i} className={`a2-quote ${q.visitor ? "is-visitor" : ""}`}>
                    “{q.text}”<span className="a2-quote__src">— {q.visitor ? "A VISITOR NOTE" : q.source.toUpperCase()}</span>
                  </p>
                ))
              ) : (
                <p className={`a2-speech__text ${answer && answer.mode !== "model" ? "is-quote" : ""}`}>
                  {answer?.text}
                  {(!answer || !answer.done) && <span className="a2-caret" />}
                </p>
              )}
              {answer?.mode === "model" && answer.done && (
                <div className="a2-speech__check">
                  <p>⚠ WRITTEN BY A {backend.params} MODEL ON YOUR GPU — IT CAN GET THINGS WRONG. THE ARCHIVE SAYS:</p>
                  {answer.quotes?.map((q, i) => (
                    <p key={i} className="a2-quote">
                      “{q.text}”<span className="a2-quote__src">— {q.visitor ? "A VISITOR NOTE" : q.source.toUpperCase()}</span>
                    </p>
                  ))}
                </div>
              )}
              {answer?.fromVisitor && answer.done && (
                <p className="a2-speech__source">
                  ⚠ SOURCED FROM A VISITOR NOTE — TYPED BY SOMEONE ON THIS PAGE, NOT FROM BRIAN'S DOCUMENTS.
                </p>
              )}
              {answer?.stats && (
                <p className="a2-speech__stats">
                  {answer.stats.tokens} TOKENS · {(answer.stats.tokens / Math.max(answer.stats.seconds, 0.001)).toFixed(0)} TOK/S · ON YOUR GPU
                </p>
              )}
              {run && answer && answer.mode === "model" && (
                <details className="a2-briefing">
                  <summary data-cursor="hover">VIEW THE EXACT BRIEFING SENT TO THE MODEL</summary>
                  <pre data-scrollable>
                    {run.prompt.system}
                    {"\n\n"}
                    {run.prompt.contextBlocks.map((b) => `${b.label}\n${b.text}\n\n`).join("")}
                    Visitor's question: {run.query}
                  </pre>
                </details>
              )}
            </motion.div>
          )}
        </div>
      )}

      {bootPhase === "loading" && (
        <div className={`a2-progress ${load.fill === null ? "is-indeterminate" : ""}`} role="progressbar"
          aria-label={load.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={load.fill === null ? undefined : pct(load.fill)}
        >
          <span className="a2-progress__label">{load.label}</span>
          <span className="a2-progress__track">
            {/* whole blocks, like a character-cell bar: 32 cells */}
            <span
              className="a2-progress__fill"
              style={{ width: `${(Math.floor((load.fill ?? 1) * 32) / 32) * 100}%` }}
            />
          </span>
        </div>
      )}
      {ingested && <p className="a2-ingest">{ingested}</p>}

      {/* The prompt arrives WITH the rest of the boot, not ahead of it: while
          the tube is warming and the progress bar is running there is nothing
          to ask yet, and an input sitting live under a loading bar reads as a
          half-drawn screen.

          Gated by not rendering rather than by opacity, because an invisible
          input is still focusable and still in the tab order - a keyboard
          visitor could land in it mid-boot. `bootPhase` starts at "done", so
          the normal (non-booting) case is unaffected. */}
      {bootPhase === "done" && (
      <form
        className="a2-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <span>]</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={performing ? "ASK ANOTHER…" : "TYPE A QUESTION…"}
          aria-label="Ask a question about Brian"
          maxLength={200}
          spellCheck={false}
        />
      </form>
      )}

      {/* status line + engine loader */}
      <div className="a2-status">
        <span>{status.text}</span>
        <span className="a2-status__ctl">
          {llmOn && (engine.phase === "queued" || engine.phase === "error") && (
            <button type="button" data-cursor="hover" onClick={() => void preload(true)}>
              {engine.phase === "error" ? "[RETRY]" : "[LOAD IT NOW]"}
            </button>
          )}
          <button
            type="button"
            className={`a2-llm ${llmOn ? "is-on" : ""}`}
            role="switch"
            aria-checked={llmOn}
            data-cursor="hover"
            onClick={() => {
              if (llmOn) {
                setLlmOptIn(false);
                setLlmOn(false);
              } else setConfirming(true);
            }}
          >
            [LLM {llmOn ? "● ON" : "○ OFF"}]
          </button>
        </span>
      </div>

      {/* the opt-in, said plainly before anything is fetched */}
      {confirming && (
        <div className="a2-optin" role="dialog" aria-label="Turn on the LLM">
          <p className="a2-optin__head">TURN ON THE LLM?</p>
          <p>A SMALL LANGUAGE MODEL ({backend.name}) WRITES THE ANSWERS INSTEAD OF QUOTING THEM.</p>
          <ul>
            <li>A ONE-TIME DOWNLOAD OF {mb(backend.bytes)} MB, KEPT IN THIS BROWSER.</li>
            <li>IT RUNS ON YOUR GPU: IT TAKES A WHILE TO LOAD AND USES REAL PROCESSING POWER.</li>
            <li>IT CAN GET THINGS WRONG. THE QUOTES IT WORKED FROM ARE PRINTED UNDER EVERY ANSWER.</li>
          </ul>
          <p className="a2-optin__row">
            <button
              type="button"
              data-cursor="hover"
              onClick={() => {
                setConfirming(false);
                setLlmOn(true);
                setLlmOptIn(true);
              }}
            >
              [TURN IT ON]
            </button>
            <button type="button" data-cursor="hover" onClick={() => setConfirming(false)}>
              [KEEP QUOTES]
            </button>
          </p>
        </div>
      )}
      <div className="a2-crt__scanlines" aria-hidden />
      <div className="a2-crt__vignette" aria-hidden />
    </div>
  );

  return (
    <div ref={rootRef} className={`section shell rag ${frame ? "is-framing" : ""} ${bootPhase !== "done" ? "is-booting" : ""}`}>
      <p className="section__label">Ask the machine</p>

      <div className="rag__scene">
        <Apple2Front led={status.led} active={active} screen={screen} {...frameProps} />
        {!frame && <FeedSheet onFeed={feed} />}
      </div>

      <p className="field-note rag__foot">
        BM25 scoring and word-for-word quotes, in your browser; a {backend.params} model on your own GPU if you switch it on.{" "}
        <span className="dim">Every number on the glass is the actual machinery.</span>
      </p>
    </div>
  );
}
