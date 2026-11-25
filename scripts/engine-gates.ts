/* Load gate tests for the RAG model.
 *
 *   npm run rag:gates
 *
 * Since 2026-10-20 the model loads ON DEMAND: reaching the machine section is
 * the request (RagSection calls requestModel()), and nothing loads in the
 * background. So the gates left are the ones a request should still respect -
 * facts about the machine and the visitor's stated preference - plus two
 * brief waits (a transition clip still on screen, a background tab).
 *
 * The connection-weather gates are gone, and the cases that used to assert
 * them now assert the opposite on purpose: `navigator.connection` readings
 * were the cause of the original bug here (MODEL NOT LOADED on some page
 * loads and not others - a rolling throughput estimate read "3g" on a fast
 * line while the page was busy), and an arrival must never be turned away
 * by one.
 *
 * None of this needs a GPU, so it runs anywhere: the browser is mocked out
 * from under the module, and the model runtimes are never reached - a case
 * that gets as far as "downloading" has passed every gate.
 */
/* Imported before ANY browser global is mocked below: web-llm resolves its own
   module URL from `location` when first evaluated, and the mocked `location`
   has no href. Used for the URL drift check; later imports get this same,
   already-evaluated module. */
const webllm = await import("@mlc-ai/web-llm");

const winListeners: Record<string, (() => void)[]> = {};
let offline = false;

const conn: { effectiveType?: string; saveData?: boolean; downlink?: number } = {};
let storage: { quota: number; usage: number } | null = { quota: 20e9, usage: 1e9 };
const nav: Record<string, unknown> = {};
let scheduled = 0;
/* Retries fire as microtasks here, so "a few seconds later" has to be
   expressed as "a few retries in" - this hook is how a case changes the
   weather mid-run. */
let onRetry: ((n: number) => void) | null = null;
/* every delay the module asked to wait, in order - the backoff is the thing
   under test in one of the cases below */
let delays: number[] = [];
/* Stop firing retries after N, leaving one pending forever - which is what a
   real browser looks like at any given moment: queued, timer ticking. */
let pauseAfter = Infinity;

Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: {
    /* timers fire immediately: the retry schedule is minutes of wall clock
       and the thing under test is the sequence, not the calendar */
    setTimeout: (fn: () => void, ms: number) => {
      const n = ++scheduled;
      delays.push(ms);
      if (n <= pauseAfter) queueMicrotask(() => { onRetry?.(n); fn(); });
      return n;
    },
    clearTimeout: () => {},
    /* kept, so a case can fire them - "online" is registered at import */
    addEventListener: (k: string, fn: () => void) => { (winListeners[k] ??= []).push(fn); },
  },
  configurable: true,
});
const listeners: Record<string, (() => void)[]> = {};
const doc = {
  readyState: "complete",
  visibilityState: "visible",
  addEventListener: (k: string, fn: () => void) => { (listeners[k] ??= []).push(fn); },
};
Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
const loc = { search: "", href: "https://site.test/" };
Object.defineProperty(globalThis, "location", { value: loc, configurable: true });

/* The network and the Cache API, mocked. The download now starts on landing
   and the arrival finishes it (ragBackends.ts), so without these an arrival
   case would reach Hugging Face for real. A tiny fake model: three shards,
   the largest first-but-not-by-position so "largest" is actually chosen. */
const SHARDS = [
  { dataPath: "params_shard_0.bin", nbytes: 300 },
  { dataPath: "params_shard_1.bin", nbytes: 800 },
  { dataPath: "params_shard_2.bin", nbytes: 300 },
];
const fetched: string[] = [];
const stores = new Map<string, Map<string, ArrayBuffer>>();
const fileName = (url: string) => url.slice(url.lastIndexOf("/") + 1);
Object.defineProperty(globalThis, "caches", {
  value: {
    open: async (name: string) => {
      const m = stores.get(name) ?? new Map<string, ArrayBuffer>();
      stores.set(name, m);
      return {
        match: async (url: string) => {
          const b = m.get(url);
          return b ? new Response(b.slice(0), { headers: { "content-length": String(b.byteLength) } }) : undefined;
        },
        put: async (url: string, res: Response) => {
          m.set(url, await res.arrayBuffer());
        },
      };
    },
  },
  configurable: true,
});
Object.defineProperty(globalThis, "fetch", {
  value: async (url: string) => {
    if (offline) throw new TypeError("Failed to fetch");
    fetched.push(url);
    const name = fileName(url);
    const body =
      name === "tensor-cache.json"
        ? new TextEncoder().encode(JSON.stringify({ records: SHARDS }))
        : new Uint8Array(SHARDS.find((s) => s.dataPath === name)?.nbytes ?? 64);
    return new Response(body, { headers: { "content-length": String(body.byteLength) } });
  },
  configurable: true,
  writable: true,
});

const engine = await import("../src/lib/ragEngine");
const backends = await import("../src/lib/ragBackends");
const clips = await import("../src/lib/transitions");

/* A healthy desktop, then whatever this case wants changed. `connection` is
   spelled separately because it is a live object the tests mutate mid-run. */
function reset(over: Record<string, unknown> = {}, connOver: typeof conn | null = {}) {
  for (const k of Object.keys(nav)) delete nav[k];
  delete conn.effectiveType;
  delete conn.saveData;
  delete conn.downlink;
  storage = { quota: 20e9, usage: 1e9 };
  Object.assign(conn, connOver ?? {});
  Object.assign(nav, {
    gpu: {},
    connection: connOver === null ? undefined : conn,
    deviceMemory: 16,
    maxTouchPoints: 0,
    storage: { estimate: async () => storage ?? {} },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  }, over);
  scheduled = 0;
  delays = [];
  onRetry = null;
  pauseAfter = Infinity;
  doc.visibilityState = "visible";
  loc.search = "";
  clips.setClipBusy(false);
  stores.clear();
  fetched.length = 0;
  offline = false;
  engine.__resetForTests();
}

const settle = () => new Promise((r) => setTimeout(r, 60));
const CLIP_MS = 600;
let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(52)} ${detail}`);
}

async function run(
  name: string,
  setup: Record<string, unknown>,
  connOver: typeof conn | null = {},
  act?: () => void
) {
  reset(setup, connOver);
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  act?.();
  await settle();
  off();
  return { seen, last: seen[seen.length - 1], count: (p: string) => seen.filter((x) => x === p).length };
}

console.log("load gates (on demand)\n");

/* 0. The download starts on landing, in parts, and never touches the GPU
      before the machine asks (ragEngine.ts, WHEN IT LOADS). */
{
  reset();
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.warmModel("landing");
  await settle();
  const landing = fetched.map(fileName);
  check("landing fetches the shard list and the LARGEST shard only",
    landing.length === 2 && landing.includes("tensor-cache.json") && landing.includes("params_shard_1.bin"),
    landing.join(", "));

  engine.warmModel("rest");
  await settle();
  const all = fetched.map(fileName);
  const dupes = all.filter((f, i) => all.indexOf(f) !== i);
  const want = ["mlc-chat-config.json", "tokenizer.json", "params_shard_0.bin", "params_shard_2.bin"];
  check("moving past the hero fetches everything else",
    want.every((f) => all.includes(f)) && all.some((u) => u.endsWith(".wasm")),
    `${all.length} files`);
  check("...and nothing twice", dupes.length === 0, dupes.join(", ") || "no repeats");
  off();
  check("the background parts never start the model", seen.every((p) => p === "idle"),
    `phases: ${[...new Set(seen)].join(" -> ")}`);

  const before = fetched.length;
  const states: engine.EngineState[] = [];
  const off2 = engine.subscribe((s) => states.push(s));
  engine.requestModel();
  await settle();
  off2();
  check("arrival after both parts downloads nothing more", fetched.length === before,
    `${fetched.length - before} extra fetch(es)`);
  /* the engine's own "downloading, 0 bytes, 0%" opener reads STARTING on the
     glass; any download report beyond it would be a download that is not
     happening */
  const phantom = states.filter((s) => s.phase === "downloading" && (s.bytes > 0 || s.progress > 0));
  check("...and reports no download that is not happening", phantom.length === 0,
    phantom.length ? `${phantom.length} report(s), e.g. ${phantom[0].detail}` : "none");
  check("the old page-load preload is gone", !("scheduleAutoPreload" in engine), "no scheduleAutoPreload export");
}
{
  /* arrival before the rest has been asked for: it finishes the job itself,
     joining the landing part rather than repeating it */
  reset();
  engine.warmModel("landing");
  engine.requestModel();
  await settle();
  const all = fetched.map(fileName);
  const dupes = all.filter((f, i) => all.indexOf(f) !== i);
  check("an early arrival finishes the download without repeats",
    dupes.length === 0 && all.includes("params_shard_0.bin") && all.includes("tokenizer.json"),
    dupes.join(", ") || `${all.length} files, no repeats`);
}
{
  /* a transition clip on screen holds the next background file */
  reset();
  clips.setClipBusy(true);
  let atClear: string[] = [];
  onRetry = (n) => {
    if (n === 3) {
      atClear = fetched.map(fileName);
      clips.setClipBusy(false);
    }
  };
  engine.warmModel("landing");
  await settle();
  const after = fetched.map(fileName);
  check("a clip on screen holds the next background file",
    !atClear.includes("params_shard_1.bin") && after.includes("params_shard_1.bin"),
    `before the clip cleared: ${atClear.join(", ") || "nothing"}`);
}
{
  /* the background download obeys the arrival's facts, and the URL switches */
  const cases: [string, Record<string, unknown>, typeof conn | null, string][] = [
    ["no WebGPU", { gpu: undefined }, {}, ""],
    ["Data Saver", {}, { saveData: true }, ""],
    ["a phone", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobi" }, {}, ""],
    ["an iPad", { maxTouchPoints: 5 }, {}, ""],
    ["a 2 GB device", { deviceMemory: 2 }, {}, ""],
    ["?rag=off", {}, {}, "?rag=off"],
    ["plate rendering", {}, {}, "?frame=off"],
  ];
  const leaked: string[] = [];
  for (const [label, over, connOver, search] of cases) {
    reset(over, connOver);
    loc.search = search;
    engine.warmModel("landing");
    engine.warmModel("rest");
    await settle();
    if (fetched.length) leaked.push(`${label}: ${fetched.length}`);
  }
  check("phones, Data Saver, no WebGPU etc. download nothing in the background", leaked.length === 0,
    leaked.join("; ") || `${cases.length} cases, 0 bytes`);
}
{
  reset();
  storage = { quota: 20e9, usage: 19.9e9 };
  engine.warmModel("landing");
  await settle();
  check("no room in browser storage: nothing in the background either", fetched.length === 0,
    `${fetched.length} fetch(es)`);
}
{
  /* a link opened in a background tab is the visitor this helps most */
  reset();
  doc.visibilityState = "hidden";
  engine.warmModel("landing");
  await settle();
  check("a background tab still gets the download", fetched.length > 0, `${fetched.length} file(s)`);
}
{
  /* the early download only helps if its URLs are WebLLM's own */
  const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === backends.QWEN_MODEL_ID);
  const ok = !!rec && rec.model === backends.QWEN_UPSTREAM_MODEL_URL && rec.model_lib === backends.QWEN_UPSTREAM_LIB_URL;
  check("the mirror copies WebLLM's own model and library", ok,
    ok ? `web-llm ${webllm.modelVersion}` : `drifted: ${rec?.model} / ${rec?.model_lib}`);

  /* and the mirror on disk is a faithful copy of exactly those files */
  const fs = await import("node:fs");
  const crypto = await import("node:crypto");
  const dir = `public/llm/${backends.QWEN_HOSTED_DIR}`;
  const problems: string[] = [];
  let source: { upstream_lib_url?: string; files?: Record<string, { bytes: number; sha256: string }> } = {};
  try {
    source = JSON.parse(fs.readFileSync(`${dir}/SOURCE.json`, "utf8"));
  } catch {
    problems.push("no SOURCE.json - run node scripts/mirror-model.cjs");
  }
  if (source.upstream_lib_url && source.upstream_lib_url !== backends.QWEN_UPSTREAM_LIB_URL)
    problems.push(`mirrored library is from ${source.upstream_lib_url}`);
  for (const [name, f] of Object.entries(source.files ?? {})) {
    try {
      const b = fs.readFileSync(`${dir}/${name}`);
      const sum = crypto.createHash("sha256").update(b).digest("hex");
      if (b.length !== f.bytes || sum !== f.sha256) problems.push(`${name} changed since mirroring`);
    } catch {
      problems.push(`${name} missing`);
    }
  }
  try {
    const m = JSON.parse(fs.readFileSync(`${dir}/resolve/main/tensor-cache.json`, "utf8"));
    const base = `${backends.QWEN_UPSTREAM_MODEL_URL}/resolve/main/`;
    const stray = m.records.filter((r: { dataPath: string }) => !r.dataPath.startsWith(base));
    if (stray.length) problems.push(`${stray.length} shard path(s) not on Hugging Face`);
  } catch {
    problems.push("mirrored tensor-cache.json unreadable");
  }
  check("the mirror on disk matches its SOURCE.json, shards point at Hugging Face", problems.length === 0,
    problems.join("; ") || `${Object.keys(source.files ?? {}).length} files verified`);

  const h = backends.qwenHosted();
  check("hosted URLs keep the resolve/main/ segment WebLLM requires",
    /\/resolve\/main\/$/.test(h.model) && h.lib.startsWith("https://site.test/llm/"), `${h.model}`);
}

/* 0b. A refresh, or a return visit: every file is already on disk, so the
       landing part goes straight to the GPU load - without fetching a byte -
       and the machine is ready when the visitor gets there. */
{
  reset();
  engine.warmModel("landing");
  engine.warmModel("rest");
  await settle();
  const before = fetched.length;
  /* the page reloads: the module starts over, the browser's caches do not */
  engine.__resetForTests();
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.warmModel("landing");
  await settle();
  off();
  check("a return visit loads onto the GPU from the hero", seen.includes("downloading") || seen.includes("compiling"),
    `phases: ${[...new Set(seen)].join(" -> ")}`);
  check("...without fetching anything", fetched.length === before, `${fetched.length - before} fetch(es)`);
}
{
  /* ...but a first visit never starts the model from the hero */
  reset();
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.warmModel("landing");
  await settle();
  off();
  check("a first visit only downloads on the hero", seen.every((p) => p === "idle"), `phases: ${[...new Set(seen)].join(" -> ")}`);
}

/* 0c. The connection drops mid-load and comes back: it carries on by itself
       (measured 2026-10-21 - a sleeping laptop left the machine on its fault
       screen until someone clicked RETRY). */
{
  reset();
  offline = true;
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.warmModel("landing");
  engine.requestModel();
  await settle();
  const failedWith = seen.at(-1);
  const startsBefore = seen.filter((p) => p === "queued").length;
  offline = false;
  winListeners.online?.forEach((fn) => fn());
  await settle();
  off();
  const startsAfter = seen.filter((p) => p === "queued").length;
  check("a dropped connection resumes when the browser is back online",
    failedWith === "error" && startsAfter > startsBefore && fetched.length > 0,
    `failed as ${failedWith}, then ${startsAfter - startsBefore} new start(s), ${fetched.length} file(s) fetched`);
}

{
  /* ...and when the browser never says "online" (a laptop waking from
     sleep): the load retries on a backoff timer by itself */
  reset();
  offline = true;
  onRetry = (n) => { if (n === 2) offline = false; };
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.requestModel();
  await settle();
  await settle();
  off();
  const firstError = seen.indexOf("error");
  const recovered = firstError >= 0 && seen.slice(firstError).includes("downloading");
  check("a failed load retries on its own, with backoff", recovered && delays.includes(3000),
    `retry delays ${delays.filter((d) => d >= 3000).slice(0, 3).join(", ")} ms; phases ${[...new Set(seen)].join(" -> ")}`);
}

/* 1. Arrival on a healthy desktop starts at once - no second reading, no
      confirmation delay: the visitor is looking at the progress bar. */
{
  reset({}, { effectiveType: "4g", downlink: 10 });
  pauseAfter = 0; // no re-check is allowed to run: it must start on the first ask
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.requestModel();
  await settle();
  off();
  check("arrival starts the download on the first ask", seen.includes("downloading"),
    `phases: ${[...new Set(seen)].join(" -> ")}`);
}

/* 2. The weather does not turn an arrival away. Each of these used to keep
      the model off; each must now load. */
{
  const r = await run("flaky", {}, { effectiveType: "3g" });
  check("a '3g' reading does not block an arrival", r.seen.includes("downloading"), `ended ${r.last}`);
}
{
  const r = await run("slow 4g", {}, { effectiveType: "4g", downlink: 1.2 });
  check("a 1.2 Mbps estimate does not block an arrival", r.seen.includes("downloading"), `ended ${r.last}`);
}
{
  const r = await run("2g", {}, { effectiveType: "2g", downlink: 0.1 });
  check("not even '2g' - the bar shows the real rate", r.seen.includes("downloading"), `ended ${r.last}`);
}

/* 3. The arrival call lands as the keyboard->machine clip ends, while the
      overlay is still fading. That is waited out, briefly, and then it loads -
      never under a playing clip. */
{
  reset();
  clips.setClipBusy(true);
  const seen: string[] = [];
  let clearedAt = -1;
  onRetry = (n) => {
    if (n === 2) {
      clips.setClipBusy(false);
      clearedAt = seen.length;
    }
  };
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.requestModel();
  await settle();
  off();
  const firstDl = seen.indexOf("downloading");
  check("a clip on screen is waited out, then it loads", firstDl > clearedAt && clearedAt >= 0,
    `${seen.filter((p) => p === "queued").length} waits, phases: ${[...new Set(seen)].join(" -> ")}`);
}
{
  /* a clip that never clears (the player's own failsafe would) cannot keep
     the engine asking forever */
  reset();
  clips.setClipBusy(true);
  const r = { seen: [] as string[] };
  const off = engine.subscribe((s) => r.seen.push(s.phase));
  engine.requestModel();
  await settle();
  off();
  check("a stuck clip ends the waiting, not the page", r.seen.at(-1) === "idle" && !r.seen.includes("downloading"),
    `ended ${r.seen.at(-1)} after ${r.seen.filter((p) => p === "queued").length} waits`);
}

/* 4. Nobody is looking at this tab - and then somebody is. */
{
  reset();
  doc.visibilityState = "hidden";
  pauseAfter = 2;
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.requestModel();
  await settle();
  const hidden = !seen.includes("downloading");
  pauseAfter = Infinity;
  doc.visibilityState = "visible";
  listeners.visibilitychange?.forEach((fn) => fn());
  await settle();
  off();
  check("a hidden tab does not start the model", hidden, hidden ? "held" : "started while hidden");
  check("returning to the tab starts it at once", seen.includes("downloading"), `ended ${seen.at(-1)}`);
}

/* 5. Two calls in one tick are one load. React StrictMode double-invokes the
      arrival effect in development. A load reports progress many times, so
      what is counted is loads STARTED (the engine's "starting" opener) and
      files fetched. */
{
  reset();
  const states: engine.EngineState[] = [];
  const off = engine.subscribe((s) => states.push(s));
  engine.requestModel();
  engine.requestModel();
  engine.requestModel();
  await settle();
  off();
  /* only up to the first failure: after it, the automatic retries start
     loads of their own, which is a different behaviour (tested below) */
  const firstFail = states.findIndex((s) => s.phase === "error");
  const starts = states
    .slice(0, firstFail < 0 ? undefined : firstFail)
    .filter((s) => s.phase === "queued" && s.detail === "starting").length;
  const names = fetched.map(fileName);
  const dupes = names.filter((f, i) => names.indexOf(f) !== i);
  check("duplicate arrivals start one load", starts === 1 && dupes.length === 0,
    `${starts} load(s) started, ${dupes.length} repeated fetch(es)`);
}

/* 6. Facts about the machine are final, and are not retried around. */
{
  const r = await run("ipad", { maxTouchPoints: 5 }, { effectiveType: "4g", downlink: 10 });
  check("an iPad is not treated as a desktop", r.last === "idle" && !r.seen.includes("downloading"), r.last);
}
{
  const r = await run("no webgpu", { gpu: undefined });
  check("no WebGPU refuses once, permanently", r.last === "unavailable" && r.count("queued") === 0, r.last);
}
{
  const r = await run("data saver", {}, { saveData: true });
  check("Data Saver is respected, not retried around", r.last === "idle" && r.count("queued") === 0, r.last);
}
{
  const r = await run("mobile", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobi" });
  check("mobile is left alone", r.last === "idle" && r.count("queued") === 0, r.last);
}
{
  const r = await run("small device", { deviceMemory: 2 });
  check("a 2 GB device is left alone", r.last === "idle" && r.count("queued") === 0, r.last);
}

/* 7. Filling someone's disk to the brim and then failing is worse than not
      starting. */
{
  reset({}, { effectiveType: "4g", downlink: 10 });
  storage = { quota: 20e9, usage: 19.8e9 };
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.requestModel();
  await settle();
  await settle();
  off();
  check("no room in browser storage stops before fetching", !seen.includes("downloading"),
    `ended ${seen[seen.length - 1]}`);
}

/* 8. A connection API that says nothing must not be read as bad news. */
{
  const r = await run("no connection api", {}, null);
  check("an absent connection API loads anyway", r.seen.includes("downloading"),
    `phases: ${[...new Set(r.seen)].join(" -> ")}`);
}

/* 9. ?rag=off keeps arrivals away (screenshots, the fragment fallback) but
      the visitor's own click still works. */
{
  reset();
  loc.search = "?rag=off";
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  engine.requestModel();
  await settle();
  const held = !seen.includes("downloading");
  void engine.preload(true);
  await settle();
  off();
  check("?rag=off stops the arrival load", held, held ? "held" : "loaded");
  check("...but not the load button", seen.includes("downloading"), `ended ${seen.at(-1)}`);
}

/* 10. The visitor's own click outranks every gate except WebGPU. */
{
  reset({}, { effectiveType: "2g", saveData: true });
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(true);
  await settle();
  off();
  check("the load button ignores the etiquette gates", seen.includes("downloading"),
    `phases: ${[...new Set(seen)].join(" -> ")}`);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall gates behave");
if (failed) process.exitCode = 1;
