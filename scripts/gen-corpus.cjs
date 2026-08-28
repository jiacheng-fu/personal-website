/* Build the RAG corpus from the resume.
 *
 * Usage: node scripts/gen-corpus.cjs
 * Writes: src/data/corpus.json
 *
 * One chunk per resume entry (a job, a project, a skills category), not per
 * bullet and not per section. That granularity is chosen for the UI as much
 * as for retrieval: every chunk is a card the visitor can see scored, and a
 * dozen cards read as "the whole corpus" on screen. Per-bullet would be
 * confetti; per-section would make every score 0.9 vs 0.1.
 *
 * The parser is deliberately dumb string-walking over one known file. If the
 * resume's HTML shape changes, fix it here - it will fail loudly, not
 * silently misparse. Additional source files can be appended to SOURCES.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCES = [path.join(ROOT, "resume", "Brian_Fu_Resume_Updated.html")];
const OUT = path.join(ROOT, "src", "data", "corpus.json");

const decode = (s) =>
  s
    .replace(/&bull;/g, "•")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const text = (html) =>
  decode(html.replace(/<[^>]+>/g, " "))
    .replace(/•/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const html = fs.readFileSync(SOURCES[0], "utf8");
const body = html.slice(html.indexOf("<body>"));

const chunks = [];
let id = 0;
const push = (section, title, dates, content) => {
  if (!content) throw new Error(`empty chunk: ${title}`);
  chunks.push({ id: id++, section, title, dates, text: redact(content) });
};

/* Everything in this corpus is imported straight into the JS bundle, which
   means it is public the moment the site is deployed - readable in devtools,
   in view-source, or by curling the asset. The chat UI is a nice way to reach
   it, never a gate on it.

   So the rule is: only put in the corpus what is meant to be on the internet.
   This is the choke point that enforces it. Every chunk goes through here no
   matter which source file it came from, so a phone number cannot creep back
   in by editing the resume or adding a new SOURCE.

   Email is deliberately NOT redacted - it is already on the contact section
   of the site, and answering "how do I reach him" is the point. */
const REDACT = [
  // phone numbers, in any of the shapes a resume writes them
  [/\+?\d{0,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[redacted]"],
];
const redact = (t) => REDACT.reduce((acc, [re, to]) => acc.replace(re, to), t);

/* -- header: name + contact ---------------------------------------------- */
const header = body.match(/<div class="header">([\s\S]*?)<\/div>\s*<!--/);
if (!header) throw new Error("header not found");
push(
  "About",
  "Contact & basics",
  "",
  text(header[1]) +
    " Brian goes by Brian; his legal first name is Jiacheng." +
    /* phrased the way visitors actually ask - lexical retrieval can only
       find words that exist in a chunk */
    " Brian lives in Austin, Texas. Contact him or reach him by email at brian.fu123321@gmail.com." +
    " He studies Computer Science at Texas A&M University and graduates in December 2027."
);

/* -- entries: education, experience, projects ---------------------------- */
/* Walk section titles so each entry knows which section it belongs to. */
const sectionAt = (idx) => {
  const before = body.slice(0, idx);
  const m = [...before.matchAll(/<div class="section-title">([^<]+)<\/div>/g)].pop();
  if (!m) throw new Error("entry before any section title");
  const t = m[1].trim();
  return t.charAt(0) + t.slice(1).toLowerCase();
};

const entryRe = /<div class="entry">([\s\S]*?)<\/div>\s*(?=<div class="entry">|<!--|<div class="section-title">)/g;
let m;
const parsed = [];
while ((m = entryRe.exec(body))) {
  const e = m[1];
  const head = e.match(/<span>([\s\S]*?)<\/span>\s*<span class="dates">([\s\S]*?)<\/span>/);
  const role = e.match(/<div class="(?:role|edu-line)">([\s\S]*?)<\/div>/);
  if (!head) throw new Error("entry without header");
  const title = text(head[1]);
  const dates = text(head[2]);
  const bullets = [...e.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((b) => text(b[1]));
  const eduLines = [...e.matchAll(/<div class="(?:role|edu-line)">([\s\S]*?)<\/div>/g)].map((b) => text(b[1]));
  const bodyText = bullets.length ? [text(role ? role[1] : ""), ...bullets] : eduLines;
  parsed.push({ section: sectionAt(m.index), title, dates, role: text(role ? role[1] : ""), bodyText });
}
if (parsed.length < 6) throw new Error(`only ${parsed.length} entries parsed - resume shape changed?`);

/* -- overview: one chunk that answers the list questions ------------------
   "What companies has he worked at?" needs every employer in ONE passage;
   with three chunks per prompt, per-entry retrieval cannot guarantee that.
   Generated from the parsed entries so it can never drift from the resume. */
const jobs = parsed.filter((p) => p.section === "Experience");
const projects = parsed.filter((p) => p.section === "Projects");
const edu = parsed.find((p) => p.section === "Education");
const company = (t) => t.replace(/\s*\(.*?\)\s*/g, "").trim();
const name = (t) => t.split(" - ")[0].trim();
const employers = [...new Set(jobs.map((j) => company(j.title)))];
push(
  "Overview",
  "Career at a glance",
  "",
  `Overview of Brian's experience and background. ` +
    `Companies and employers Brian has worked at: ${employers.join(" and ")}. ` +
    `Jobs and internships Brian has worked: ` +
    jobs.map((j) => `${company(j.title)} as ${j.role.split(" (")[0]} (${j.dates})`).join("; ") +
    `. ` +
    `Projects Brian has built: ` +
    projects.map((p) => `${name(p.title)} (${p.dates})`).join(", ") +
    `. ` +
    (edu ? `Education: ${name(edu.title)}, ${edu.bodyText[0]} (${edu.dates}).` : "")
);

/* -- entries, each opened with a plain sentence in the words people ask with */
for (const p of parsed) {
  const lead =
    p.section === "Experience"
      ? `Brian worked at ${company(p.title)} as ${p.role.split(" (")[0]} (${p.dates}).`
      : p.section === "Projects"
        ? `Brian built ${name(p.title)} (${p.dates}).`
        : `Brian studies at ${name(p.title)} (${p.dates}).`;
  push(p.section, p.title, p.dates, `${lead} ${p.title}. ` + p.bodyText.join(" "));
}

/* -- skills: one chunk per category -------------------------------------- */
const skillsRe = /<p><span class="skill-category">([^<]+)<\/span>([\s\S]*?)<\/p>/g;
let s;
let cats = 0;
while ((s = skillsRe.exec(body))) {
  cats++;
  const cat = text(s[1]).replace(/:$/, "");
  push("Skills", cat, "", `${cat} skills Brian knows: ${text(s[2])}`);
}
if (cats < 3) throw new Error("skills categories not found");

fs.writeFileSync(OUT, JSON.stringify({ generated_from: "resume/Brian_Fu_Resume_Updated.html", chunks }, null, 2));
console.log(`${chunks.length} chunks -> ${path.relative(ROOT, OUT)}`);
for (const c of chunks) console.log(`  [${c.id}] ${c.section} / ${c.title} (${c.text.length} ch)`);
