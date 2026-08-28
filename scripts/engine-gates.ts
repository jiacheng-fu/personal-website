/* Auto-load gate tests for the RAG model.
 *
 *   npm run rag:gates
 *
 * The bug this exists to prevent: the model reported MODEL NOT LOADED on some
 * page loads and not others, with no way back short of a reload. The cause was
 * `navigator.connection.effectiveType` - a rolling estimate of RECENT
 * throughput - being read while the page was still pulling three.js, a GLB and
 * four video clips. On a fast connection that reads "3g", and a single bad
 * reading used to write the model off for the entire visit.
 *
 * None of this needs a GPU, so it runs anywhere: the browser is mocked out
 * from under the module and WebLLM is never reached - every case here is
 * decided by the gate, before a byte would be fetched.
 */
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
    addEventListener: () => {},
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
Object.defineProperty(globalThis, "location", { value: { search: "" }, configurable: true });

const engine = await import("../src/lib/ragEngine");
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
  clips.setClipBusy(false);
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

console.log("auto-load gates\n");

/* 1. The reported bug: one bad connection reading may not be final. */
{
  const r = await run("flaky", {}, { effectiveType: "3g" });
  check("a slow reading defers instead of refusing", r.count("queued") > 1,
    `${r.count("queued")} retries, ended ${r.last}`);
}

/* 2. The recovery that matters: the storm passes and the model loads without
      the visitor having to touch anything. */
{
  reset({}, { effectiveType: "3g" });
  /* the page finishes its own asset load three retries in, and the reading
     goes back to what the connection always actually was */
  onRetry = (n) => { if (n === 3) conn.effectiveType = "4g"; };
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  off();
  check("recovers on its own once the line clears", seen.includes("downloading"),
    `phases: ${[...new Set(seen)].join(" -> ")}`);
}

/* 2b. A visitor scrolling down to the machine fires a transition clip at every
       section boundary. Those waits are short and self-clearing and must not
       spend the budget meant for a bad connection - the whole point is that
       the model is ready by the time they arrive. */
{
  reset();
  clips.setClipBusy(true);
  /* twenty clips' worth of waiting on the way down, then they arrive */
  onRetry = (n) => { if (n === 20) clips.setClipBusy(false); };
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  off();
  check("clips on the way down do not exhaust the budget", seen.includes("downloading"),
    `${seen.filter((p) => p === "queued").length} waits, phases: ${[...new Set(seen)].join(" -> ")}`);
}

/* 2c. It has to be patient: the machine is the third section, and a visitor
       spends minutes getting there. Eager at first, then backing off, and
       still asking long after a reasonable browse. */
{
  const r = await run("patience", {}, { effectiveType: "3g" });
  const line = delays.filter((d) => d > CLIP_MS);
  const grows = line.length > 3 && line[1] > line[0] && line[3] > line[1];
  const caps = Math.max(...line) <= 30_000;
  const total = line.reduce((a, b) => a + b, 0);
  check("re-checks back off instead of stopping", grows && caps,
    `${line[0]}ms -> ${line[1]}ms -> ... -> ${Math.max(...line)}ms`);
  /* the attempt cap must not be what ends the waiting - the ten-minute clock
     should get there first, which it only does if the scheduled delays add up
     to well past it */
  check("the clock ends the waiting, not the attempt cap", total > 10 * 60_000,
    `${Math.round(total / 60_000)} min of re-checks scheduled across ${line.length} attempts`);
  check("and it does eventually stop", r.last === "idle", r.last);
}

/* 2d. A tab opened in the background and read later: coming back to it must
       restart the asking rather than inherit whatever was decided in private. */
{
  reset({}, { effectiveType: "3g" });
  pauseAfter = 3; // three re-checks in, the visitor switches away
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  const stalled = seen[seen.length - 1];
  /* the visitor comes back, and by now the line is fine */
  pauseAfter = Infinity;
  conn.effectiveType = "4g";
  doc.visibilityState = "visible";
  listeners.visibilitychange?.forEach((fn) => fn());
  await settle();
  off();
  check("returning to the tab asks again immediately", stalled === "queued" && seen.includes("downloading"),
    `${stalled} -> ${seen[seen.length - 1]}`);
}

/* 2e. 400 MB is not a decision to make on one optimistic reading. */
{
  reset({}, { effectiveType: "4g", downlink: 10 });
  pauseAfter = 0; // let the first check run, then hold
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  off();
  check("one good reading does not commit the download", !seen.includes("downloading"),
    `after one check: ${seen[seen.length - 1]}`);
}
{
  /* the same conditions, but the re-check timer is allowed to fire once */
  reset({}, { effectiveType: "4g", downlink: 10 });
  pauseAfter = 1;
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  off();
  check("a second reading, seconds later, does", seen.includes("downloading"),
    `${[...new Set(seen)].join(" -> ")}`);
}

/* 2e2. ...and two calls in the same tick are not two readings. This is how
        React StrictMode's double-invoked effect used to walk straight past
        the confirmation and start the download at +611ms. */
{
  reset({}, { effectiveType: "4g", downlink: 10 });
  pauseAfter = 0;
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  void engine.preload(false); // the StrictMode twin, same millisecond
  void engine.preload(false);
  await settle();
  off();
  check("duplicate calls cannot stand in for the second reading", !seen.includes("downloading"),
    `three calls in one tick: ${seen[seen.length - 1]}`);
}

/* 2f. "4g" promises about 700 kbps, at which 400 MB takes over an hour. */
{
  const r = await run("slow 4g", {}, { effectiveType: "4g", downlink: 1.2 });
  check("a '4g' line estimated at 1.2 Mbps waits", !r.seen.includes("downloading"),
    `ended ${r.last}`);
}

/* 2g. Nobody is looking at this tab. */
{
  reset({}, { effectiveType: "4g", downlink: 10 });
  doc.visibilityState = "hidden";
  pauseAfter = 2;
  const seen: string[] = [];
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  off();
  check("a background tab is not downloaded into", !seen.includes("downloading"), `ended ${seen[seen.length - 1]}`);
}

/* 2h. An iPad reports itself as a Macintosh. */
{
  const r = await run("ipad", { maxTouchPoints: 5 }, { effectiveType: "4g", downlink: 10 });
  check("an iPad is not treated as a desktop", r.last === "idle" && !r.seen.includes("downloading"), r.last);
}

/* 2i. Filling someone's disk to the brim and then failing is worse than not
       starting. */
{
  storage = { quota: 20e9, usage: 19.8e9 };
  const seen: string[] = [];
  reset({}, { effectiveType: "4g", downlink: 10 });
  storage = { quota: 20e9, usage: 19.8e9 };
  const off = engine.subscribe((s) => seen.push(s.phase));
  void engine.preload(false);
  await settle();
  await settle();
  off();
  check("no room in browser storage stops before fetching", !seen.includes("compiling"),
    `ended ${seen[seen.length - 1]}`);
}

/* 3. Facts about the machine are still final - no pointless retrying. */
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

/* 4. A connection API that says nothing must not be read as bad news. */
{
  const r = await run("no connection api", {}, null);
  check("an absent connection API loads anyway", r.seen.includes("downloading"),
    `phases: ${[...new Set(r.seen)].join(" -> ")}`);
}

/* 5. The visitor's own click outranks every gate except WebGPU. */
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
