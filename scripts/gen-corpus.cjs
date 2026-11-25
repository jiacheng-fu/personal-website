/* Build the RAG corpus from the machine's archive.
 *
 * Usage: node scripts/gen-corpus.cjs
 * Reads: src/data/corpus.md (hand-written prose, one "## Section | Title |
 *        Dates" heading per card)
 * Writes: src/data/corpus.json
 *
 * The archive used to be parsed out of the resume HTML (that generator is
 * parked in media/abandoned-corpus-gen/). Since 2026-11-25 the machine QUOTES
 * the archive as its answer, so the archive is written for quoting: prose
 * that answers the questions visitors ask, every sentence standing on its own.
 *
 * Two guards run on every build:
 *  - REDACT: no phone number reaches the bundle, whatever gets typed into
 *    corpus.md. Everything in corpus.json is public the moment the site is
 *    deployed (readable in devtools or by curling the asset).
 *  - FACTS: every number in the prose must appear in a source of truth - the
 *    resumes in resume/ (gitignored; checked when present) or the projects
 *    page in src/data/content.ts - or in SITE_NUMBERS below. A typo'd "1,800
 *    tests" fails the build instead of going live. "Nothing on this site may
 *    be untrue."
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src", "data", "corpus.md");
const OUT = path.join(ROOT, "src", "data", "corpus.json");
const RESUMES = [
  path.join(ROOT, "resume", "Brian_Fu_Resume_2026-11.html"),
  path.join(ROOT, "resume", "Brian_Fu_Resume_Updated.html"),
];
const TRUTH = [...RESUMES, path.join(ROOT, "src", "data", "content.ts")];
/* numbers that are facts about the site itself, not about Brian's record */
const SITE_NUMBERS = ["3", "25"]; // "Three.js", "BM25"

const SECTIONS = new Set(["About", "Overview", "Education", "Experience", "Projects", "Skills"]);

const REDACT = [[/\+?\d{0,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[redacted]"]];
const redact = (t) => REDACT.reduce((acc, [re, to]) => acc.replace(re, to), t);

/* -- parse ----------------------------------------------------------------- */
const md = fs.readFileSync(SRC, "utf8").replace(/<!--[\s\S]*?-->/g, "");
const chunks = [];
let cur = null;
for (const line of md.split("\n")) {
  const h = line.match(/^##\s+(.+)$/);
  if (h) {
    const [section, title, dates = ""] = h[1].split("|").map((s) => s.trim());
    if (!SECTIONS.has(section)) throw new Error(`unknown section "${section}" in: ${line}`);
    if (!title) throw new Error(`heading without a title: ${line}`);
    cur = { id: chunks.length, section, title, dates, text: "" };
    chunks.push(cur);
  } else if (line.trim()) {
    if (!cur) throw new Error(`text before the first heading: ${line.slice(0, 60)}`);
    cur.text += (cur.text ? " " : "") + line.trim();
  }
}
for (const c of chunks) {
  if (!c.text) throw new Error(`empty card: ${c.title}`);
  c.text = redact(c.text);
}

/* -- facts ------------------------------------------------------------------ */
const numbers = (s) =>
  (s.replace(/<[^>]+>/g, " ").match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]$/, ""));
const present = TRUTH.filter((f) => fs.existsSync(f));
const missing = TRUTH.filter((f) => !fs.existsSync(f));
if (missing.length)
  console.warn(`! fact check without ${missing.map((f) => path.relative(ROOT, f)).join(", ")} (not on this machine)`);
const known = new Set([...SITE_NUMBERS, ...present.flatMap((f) => numbers(fs.readFileSync(f, "utf8")))]);
const unknown = [];
for (const c of chunks)
  for (const n of numbers(c.text)) if (!known.has(n)) unknown.push(`  ${c.title}: ${n}`);
if (unknown.length && !missing.some((f) => RESUMES.includes(f)))
  throw new Error(`numbers in corpus.md that no source of truth has:\n${unknown.join("\n")}`);

fs.writeFileSync(
  OUT,
  JSON.stringify({ generated_from: [path.relative(ROOT, SRC), ...present.map((f) => path.relative(ROOT, f))], chunks }, null, 2) + "\n",
);
console.log(`${chunks.length} cards -> ${path.relative(ROOT, OUT)}`);
for (const c of chunks) console.log(`  ${c.section.padEnd(10)} ${c.title.padEnd(34)} ${String(c.text.length).padStart(5)} chars`);
