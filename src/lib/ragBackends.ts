/* The models the machine can run, behind one interface.
 *
 * The engine (ragEngine.ts) owns WHEN a model loads and what the screen says
 * about it; this file owns HOW each one loads and speaks. Keeping them apart
 * is what lets scripts/model-bench.ts load several models in one page, run the
 * same briefings through both, and compare them, without touching the
 * singleton the site uses.
 *
 *   qwen3  Qwen3-0.6B on WebLLM. The shipped model.
 *
 * LFM2.5-350M (Liquid AI, March 2026) was benchmarked against it on
 * 2026-10-20 and lost on truthfulness - docs/rag-model-bench.md. Its backend
 * lives on in scripts/bench-lfm.ts, implementing this same interface, so the
 * bench can run it; nothing of it ships.
 *
 * Every number reported through LoadReport is the runtime's own: bytes the
 * runtime says it fetched, fractions the runtime computed. The progress bar on
 * the glass draws these directly, so nothing here is allowed to be estimated.
 */

export type BackendId = "qwen3";

/** One step of a model load, as the runtime itself reports it.
 *
 *  fetch    weights coming over the network (or read back from the browser's
 *           cache, for runtimes that do not tell the two apart)
 *  upload   weights already in the browser, being copied onto the GPU
 *  compile  GPU programs being built. `progress` is null when the runtime
 *           gives no count, which is ONNX Runtime's case. */
export type LoadReport =
  | { stage: "fetch"; progress: number; bytes: number; text: string }
  | { stage: "upload"; progress: number; text: string }
  | { stage: "compile"; progress: number | null; text: string };

export interface GenerationStats {
  tokens: number;
  /** wall time from the request to the last token */
  seconds: number;
  /** wall time from the request to the first token, or null if none came */
  firstTokenS: number | null;
}

export interface Runner {
  /** Stream one answer. onText receives the whole text so far, not deltas. */
  generate(
    system: string,
    user: string,
    onText: (text: string) => void,
    signal?: AbortSignal
  ): Promise<GenerationStats>;
  interrupt(): Promise<void>;
  /** Free the GPU memory. The bench loads two models in one page. */
  dispose(): Promise<void>;
}

export interface Backend {
  /** a BackendId for the site's own; the bench adds parked candidates */
  id: string;
  /** as printed on the glass */
  name: string;
  /** parameter count, as printed in the caption under the machine */
  params: string;
  quant: string;
  runtime: string;
  /** What a first visit downloads, MEASURED (see each entry), in bytes. Used
   *  for the load button's label and the storage-space check only; the
   *  progress bar never uses it. */
  bytes: number;
  load(report: (r: LoadReport) => void): Promise<Runner>;
  /** Fetch part of the model's files in the background, ahead of load(). Never
   *  touches the GPU. `mayStart` is asked before each new file. Optional: a
   *  backend that cannot split its download has none. */
  warm?(part: WarmPart, mayStart: () => boolean): Promise<void>;
  /** True when every file is already in the browser, so loading is GPU work
   *  only. Must not touch the network. */
  cached?(): Promise<boolean>;
}

/** Most tokens one answer may run to. Two or three sentences is ~80. */
export const MAX_TOKENS = 220;

/* ------------------------------- Qwen3-0.6B ------------------------------- */

export const QWEN_MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

/* Where WebLLM 0.2.84 would get this model from by itself: the `model` and
   `model_lib` of QWEN_MODEL_ID's record in its prebuiltAppConfig.
   scripts/engine-gates.ts fails if these drift from the installed package,
   because the mirror below is a copy of exactly these files. */
export const QWEN_UPSTREAM_MODEL_URL = "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC";
export const QWEN_UPSTREAM_LIB_URL =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm";

/* ...and where the site actually gets it (Brian, 2026-10-20: "a real gain is
   still a real gain, if it works seamlessly its free performance").

   The four small files are mirrored onto the site by scripts/mirror-model.cjs
   under public/llm/, because Vercel compresses JSON and WebAssembly on the
   fly and Hugging Face and GitHub serve them raw: tokenizer.json 11.4 MB and
   the WebGPU library 5.5 MB shrink to ~1.5 MB and ~0.5 MB with brotli. The
   335 MB of weights stay on Hugging Face (4-bit weights compress to ~90% at
   best); the mirrored tensor-cache.json names each shard by its absolute
   Hugging Face URL, and WebLLM is handed these addresses as its appConfig.

   The revision suffix is part of the URL on purpose: browsers keep these in
   the Cache API by URL indefinitely, so a changed file needs a new folder. */
export const QWEN_HOSTED_DIR = "qwen3-0.6b-q4f16_1-r1";
const LIB_FILE = QWEN_UPSTREAM_LIB_URL.slice(QWEN_UPSTREAM_LIB_URL.lastIndexOf("/") + 1);

/** The mirror's absolute URLs. WebLLM needs absolute ones (its cleanModelUrl
 *  calls `new URL(model)`), so they are built from the page's own origin. The
 *  `resolve/main/` segment is load-bearing: WebLLM appends one if it is
 *  missing. */
export function qwenHosted() {
  const origin =
    typeof location !== "undefined" && location.href ? new URL(location.href).origin : "http://localhost";
  const root = `${origin}/llm/${QWEN_HOSTED_DIR}/`;
  return { base: `${root}resolve/main/`, model: `${root}resolve/main/`, lib: `${root}${LIB_FILE}` };
}
/* the Cache API stores WebLLM reads from (ArtifactCache scopes in 0.2.84) */
const CACHE_MODEL = "webllm/model";
const CACHE_CONFIG = "webllm/config";
const CACHE_WASM = "webllm/wasm";

/* ---- the download, in parts ----------------------------------------------

   The site fetches WebLLM's files ITSELF, for two reasons.

   1. Progress. WebLLM stores files with Cache.add(), which fetches where no
      page code can count the bytes, and reports only as each ~32 MB shard
      completes. Measured cold: the bar sat at 39% for fifteen seconds, then
      jumped to 81%.
   2. Timing. Brian, 2026-10-20: "loading should start the instant they land
      on the website, the final loading/finishing touches should be the
      progress bar. We cant have people wait minutes on this screen." So the
      bytes are fetched long before WebLLM is asked to do anything, and by the
      time a visitor reaches the machine, ideally all that is left is the GPU.

   Every file goes into the exact cache entry WebLLM checks: same cache, same
   URL key (cleanModelUrl, hasTensorInCache and ArtifactCache in web-llm
   0.2.84). WebLLM then finds everything present and fetches nothing. If that
   ever stops matching, nothing breaks; WebLLM fetches what it does not find.

   THE PARTS
     landing   the shard list and the largest shard - the vocabulary table,
               78 MB of the 335 - the instant the page loads
     rest      everything else, as soon as the visitor moves past the hero
     arrival   whatever is still missing, at full priority, under the
               machine's progress bar; then WebLLM's GPU upload and compile

   One registry of files, so the parts JOIN rather than repeat: a file the
   landing part is halfway through is finished by it, and every byte already
   in hand counts on the bar. The background parts fetch at low network
   priority, so the page's own assets win, and they do not start a new file
   while the engine says to wait (a transition clip on screen). Neither ever
   touches the GPU. */

/** Measured 2026-10-20, so the bar's total is right before each file's
 *  headers arrive. A file's real size replaces its hint as soon as known. */
const SIZE_HINT: Record<string, number> = {
  "tensor-cache.json": 51_503, // the mirror's rewritten copy
  "mlc-chat-config.json": 2_075,
  "tokenizer.json": 11_422_654,
  [LIB_FILE]: 5_535_989,
};
const PARALLEL = 4;
/* a background file waits at most this many polls for a clip to clear; the
   player's own failsafe ends a stuck clip in 15 s, so this is a backstop */
const WAIT_POLL_MS = 400;
const WAIT_POLLS_MAX = 60;

interface FileJob {
  url: string;
  cache: string;
  /** bytes: from the shard list, the response, or SIZE_HINT until then */
  size: number;
  loaded: number;
  state: "queued" | "fetching" | "done" | "failed";
  promise: Promise<void> | null;
}

const jobs = new Map<string, FileJob>();
const ticks = new Set<() => void>();
let shardList: Promise<{ dataPath: string; nbytes: number }[]> | null = null;
/** a visitor is at the machine, waiting on this */
let urgent = false;

const notify = () => ticks.forEach((t) => t());
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function job(url: string, cache: string, size = 0): FileJob {
  let j = jobs.get(url);
  if (!j) {
    const name = url.slice(url.lastIndexOf("/") + 1);
    j = { url, cache, size: size || SIZE_HINT[url] || SIZE_HINT[name] || 0, loaded: 0, state: "queued", promise: null };
    jobs.set(url, j);
  }
  return j;
}

/* The visitor switched the LLM off (ragEngine.setLlmOptIn): no file starts,
   and a file mid-stream is cut off at its next chunk - a "no" stops the
   download now, not 300 MB later. Off again: everything resumes from what is
   already cached. */
let halted = false;
export function haltDownloads(on: boolean) {
  halted = on;
}

/** Fetch one file into its cache, counting bytes as they stream. Joins an
 *  attempt already under way. */
function runJob(j: FileJob, mayStart?: () => boolean): Promise<void> {
  if (j.state === "done") return Promise.resolve();
  if (j.promise) return j.promise;
  j.promise = (async () => {
    const cache = await caches.open(j.cache);
    const hit = await cache.match(j.url);
    if (hit) {
      const len = Number(hit.headers.get("content-length"));
      j.size = len || j.size || (await hit.blob()).size;
      j.loaded = j.size;
      j.state = "done";
      notify();
      return;
    }
    for (let i = 0; !urgent && mayStart && !mayStart() && i < WAIT_POLLS_MAX; i++) await sleep(WAIT_POLL_MS);
    if (halted) throw new Error("download halted: LLM switched off");
    j.state = "fetching";
    /* `priority` is Fetch Priority (Chrome 101+); elsewhere it is ignored */
    const res = await fetch(j.url, { priority: urgent ? "high" : "low" } as RequestInit);
    if (!res.ok || !res.body) throw new Error(`${res.status} fetching ${j.url}`);
    const encoded = (res.headers.get("content-encoding") ?? "identity") !== "identity";
    const wire = Number(res.headers.get("content-length"));
    if (wire && !encoded) j.size = wire;
    let n = 0;
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          if (halted) return ctl.error(new Error("download halted: LLM switched off"));
          n += chunk.byteLength;
          j.loaded = n;
          notify();
          ctl.enqueue(chunk);
        },
      })
    );
    /* the stored body is the decoded bytes, so headers describing the wire
       encoding would lie about it */
    const headers = new Headers(res.headers);
    if (encoded) {
      headers.delete("content-encoding");
      headers.delete("content-length");
    }
    await cache.put(j.url, new Response(counted, { status: 200, statusText: "OK", headers }));
    j.size = n;
    j.loaded = n;
    j.state = "done";
    notify();
  })().catch((err) => {
    j.state = "failed";
    j.loaded = 0;
    j.promise = null; // the next part, or the arrival, tries again
    notify();
    throw err;
  });
  return j.promise;
}

function shards() {
  shardList ??= (async () => {
    const j = job(`${qwenHosted().base}tensor-cache.json`, CACHE_MODEL);
    await runJob(j);
    const res = await (await caches.open(CACHE_MODEL)).match(j.url);
    if (!res) throw new Error("tensor-cache.json missing after fetch");
    return ((await res.json()) as { records: { dataPath: string; nbytes: number }[] }).records;
  })().catch((err) => {
    shardList = null;
    throw err;
  });
  return shardList;
}

export type WarmPart = "landing" | "rest";

async function filesFor(part: WarmPart | "all"): Promise<FileJob[]> {
  const list = await shards();
  const h = qwenHosted();
  const largest = list.reduce((a, b) => (b.nbytes > a.nbytes ? b : a));
  /* WebLLM's own resolution, `new URL(dataPath, base)`: the mirror's
     dataPaths are absolute, so shards keep their Hugging Face URLs */
  const shardJob = (s: { dataPath: string; nbytes: number }) =>
    job(new URL(s.dataPath, h.base).href, CACHE_MODEL, s.nbytes);
  const landing = [job(`${h.base}tensor-cache.json`, CACHE_MODEL), shardJob(largest)];
  const rest = [
    job(`${h.base}mlc-chat-config.json`, CACHE_CONFIG),
    job(`${h.base}tokenizer.json`, CACHE_MODEL),
    job(h.lib, CACHE_WASM),
    ...list.filter((s) => s !== largest).map(shardJob),
  ];
  return part === "landing" ? landing : part === "rest" ? rest : [...landing, ...rest];
}

/** Four at a time, as WebLLM itself does it. Background failures are left for
 *  the next part to retry; at arrival they are thrown. */
async function pool(list: FileJob[], mayStart?: () => boolean) {
  const queue = [...list];
  let firstError: unknown = null;
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      try {
        await runJob(j, mayStart);
      } catch (err) {
        firstError ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (firstError && urgent) throw firstError;
}

async function warmQwen(part: WarmPart, mayStart: () => boolean) {
  if (typeof caches === "undefined" || typeof fetch === "undefined") return;
  await pool(await filesFor(part), mayStart);
}

/** Is every file already in the browser - a refresh, or a return visit?
 *  Answered from the caches alone: it fetches nothing, not even the shard
 *  list, so asking costs no bandwidth. */
async function qwenCached(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const h = qwenHosted();
  const listUrl = `${h.base}tensor-cache.json`;
  const list = await (await caches.open(CACHE_MODEL)).match(listUrl);
  if (!list) return false;
  const { records } = (await list.json()) as { records: { dataPath: string }[] };
  const want: [string, string][] = [
    [CACHE_CONFIG, `${h.base}mlc-chat-config.json`],
    [CACHE_MODEL, `${h.base}tokenizer.json`],
    [CACHE_WASM, h.lib],
    ...records.map((r): [string, string] => [CACHE_MODEL, new URL(r.dataPath, h.base).href]),
  ];
  for (const [name, url] of want) if (!(await (await caches.open(name)).match(url))) return false;
  return true;
}

/** Fetch whatever is still missing, reporting every byte in hand. Silent if
 *  nothing actually has to come over the network - a return visit, or a
 *  visitor whose background download finished - so the bar never flashes a
 *  download that is not happening. */
async function finishQwenDownload(report: (r: LoadReport) => void) {
  if (typeof caches === "undefined") return;
  urgent = true;
  const all = await filesFor("all");
  let last = 0;
  let spoke = false;
  const tick = (force = false) => {
    const now = performance.now();
    if (!force && now - last < 100) return; // ten a second is plenty
    if (!spoke && !all.some((j) => j.state === "fetching")) return;
    last = now;
    spoke = true;
    let size = 0;
    let loaded = 0;
    for (const j of all) {
      size += j.size;
      loaded += j.state === "done" ? j.size : j.loaded;
    }
    report({
      stage: "fetch",
      progress: size ? Math.min(1, loaded / size) : 0,
      bytes: loaded,
      text: `${Math.round(loaded / 1e6)} of ${Math.round(size / 1e6)} MB`,
    });
  };
  ticks.add(tick);
  try {
    await pool(all);
  } finally {
    ticks.delete(tick);
  }
  if (spoke) tick(true);
}

/** Put the download registry back to nothing. For scripts/engine-gates.ts. */
export function __resetDownloadsForTests() {
  halted = false;
  jobs.clear();
  ticks.clear();
  shardList = null;
  urgent = false;
}

const qwen3: Backend = {
  id: "qwen3",
  name: "QWEN3-0.6B",
  params: "0.6B",
  quant: "q4f16",
  runtime: "WebLLM",
  /* Measured 2026-10-20 - exactly what WebLLM fetches: 335,372,288 bytes of
     weight shards, tokenizer.json 11,422,654, tensor-cache.json 129,391,
     mlc-chat-config.json 2,075, and the 5,535,989-byte WebGPU library. */
  bytes: 352_462_397,

  warm: warmQwen,
  cached: qwenCached,

  async load(report) {
    try {
      await finishQwenDownload(report);
    } catch (err) {
      /* Nothing lost: whatever did land is in the caches WebLLM reads, and it
         fetches the rest itself - with its coarser progress. */
      console.warn("[rag] download failed; WebLLM will fetch the rest", err);
    }
    /* WebLLM runs in its own thread (ragWorker.ts): the page never parses
       its 6 MB, and loading or answering never freezes scrolling. */
    const worker = new Worker(new URL("./ragWorker.ts", import.meta.url), { type: "module" });
    const h = qwenHosted();
    /* WebLLM loads in three stages and says which one it is in only in its
       text, so the stage is read from there (lib/index.js in 0.2.84):
         "Fetching param cache[i/N]: XMB fetched. P% completed"   network
         "Loading model from cache[i/N]: XMB loaded. P% ..."      onto the GPU
         "Loading GPU shader modules[i/N]: P% completed"          compile
       and `progress` restarts from 0 at each one. After the prefetch above
       the first stage is normally skipped. "Start to fetch params" carries
       nothing (it is progress 0 even with every shard cached) and would flash
       the bar back to empty, so it is not reported. */
    const onProgress = (progress: number, t: string) => {
      if (/^Fetching param cache/.test(t)) {
        const mbs = Number(/(\d+)MB fetched/.exec(t)?.[1] ?? 0);
        report({ stage: "fetch", progress, bytes: mbs * 1024 * 1024, text: t });
      } else if (/^Loading model from cache/.test(t)) {
        report({ stage: "upload", progress, text: t });
      } else if (/shader/i.test(t)) {
        report({ stage: "compile", progress, text: t });
      } else if (/^Finish loading/.test(t)) {
        report({ stage: "compile", progress: 1, text: t });
      }
    };
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === "progress") onProgress(m.progress, m.text);
        else if (m.type === "loaded") resolve();
        else if (m.type === "error") reject(new Error(m.message));
        else if (m.type === "warn") console.warn(`[rag] ${m.message}`, { model: m.model, model_lib: m.model_lib });
      };
      worker.onerror = (e) => reject(new Error(e.message || "the model worker failed to start"));
      worker.postMessage({
        type: "load",
        id: QWEN_MODEL_ID,
        model: h.model,
        lib: h.lib,
        upstreamModel: QWEN_UPSTREAM_MODEL_URL,
        upstreamLib: QWEN_UPSTREAM_LIB_URL,
      });
    }).catch((err) => {
      worker.terminate();
      throw err;
    });

    /* answers stream back by request id */
    type Pending = { onText: (t: string) => void; resolve: (s: GenerationStats) => void; reject: (e: Error) => void };
    const pending = new Map<number, Pending>();
    let nextId = 0;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "text") p.onText(m.text);
      else if (m.type === "done") {
        pending.delete(m.id);
        p.resolve(m.stats);
      } else if (m.type === "gen-error") {
        pending.delete(m.id);
        p.reject(new Error(m.message));
      }
    };
    /* a worker that dies (the GPU lost, out of memory) fails every pending
       answer with words the engine knows to treat as fatal */
    worker.onerror = (e) => {
      const err = new Error(`GPU device lost: ${e.message || "the model worker stopped"}`);
      pending.forEach((p) => p.reject(err));
      pending.clear();
    };

    return {
      generate(system, user, onText, signal) {
        const id = ++nextId;
        return new Promise<GenerationStats>((resolve, reject) => {
          pending.set(id, { onText, resolve, reject });
          signal?.addEventListener("abort", () => worker.postMessage({ type: "interrupt" }), { once: true });
          worker.postMessage({ type: "generate", id, system, user, maxTokens: MAX_TOKENS });
        });
      },
      interrupt: async () => worker.postMessage({ type: "interrupt" }),
      dispose: async () => {
        worker.postMessage({ type: "dispose" });
        await new Promise((r) => setTimeout(r, 100));
        worker.terminate();
      },
    };
  },
};

export const BACKENDS: Record<BackendId, Backend> = { qwen3 };
