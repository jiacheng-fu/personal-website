/* ---------------------------------------------------------------------------
   The machine's default answer: QUOTED, not generated.

   The best one or two sentences from the passages retrieval already chose,
   word for word, each with its source. Nothing is paraphrased, so nothing can
   be untrue - the site's first rule - and it costs microseconds and zero
   downloads on any machine. The LLM is an opt-in on top (RagSection).

   Sentences are matched with the index's own terms (bm25 termsOf), so a
   query and a sentence agree exactly as a query and a passage do: stems,
   names, and the expansion synonyms at their reduced weight.
   --------------------------------------------------------------------------- */
import { MIN_EVIDENCE, indexHas, termsOf, type Retrieval, type ScoredChunk } from "./bm25";

export type Quote = { text: string; source: string; visitor: boolean };

/* sentence ends, but not "U.S." or "e.g." or a decimal */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?](?=\s+["“(]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1);
    if (/\b[A-Z]\.[A-Z]\.$|\b(?:e\.g|i\.e|vs|etc)\.$/i.test(before)) continue;
    out.push(text.slice(start, m.index + 1).trim());
    start = m.index + 1;
  }
  out.push(text.slice(start).trim());
  return out.filter((s) => s.length > 2);
}

/** A long sentence (a skills list) is cut to a window around its first match. */
function trimAround(s: string, hit: string[], max = 240): string {
  if (s.length <= max) return s;
  const lower = s.toLowerCase();
  const at = Math.max(0, Math.min(...hit.map((h) => lower.indexOf(h)).filter((i) => i >= 0), s.length));
  let a = Math.max(0, at - max / 2);
  let b = Math.min(s.length, a + max);
  a = Math.max(0, b - max);
  if (a > 0) a = s.indexOf(" ", a) + 1;
  if (b < s.length) b = s.lastIndexOf(" ", b);
  return `${a > 0 ? "…" : ""}${s.slice(a, b).trim()}${b < s.length ? "…" : ""}`;
}

function sourceOf(c: ScoredChunk["chunk"]): string {
  if (c.section === "Visitor") return "a visitor note";
  if (c.section === "Skills") return `skills · ${c.title}`;
  if (c.section === "Overview") return "career overview";
  if (c.section === "About") return "about";
  const name = c.title.split(" - ")[0].replace(/\s*\(.*?\)\s*/g, "").trim();
  return c.dates ? `${name}, ${c.dates}` : name;
}

/* employers a visitor might assume; only the ones the archive never names
   count (Apple, OpenAI and LinkedIn are in it, for other reasons) */
const BIG_CO = /^(google|meta|facebook|amazon|microsoft|netflix|tesla|nvidia|ibm|oracle|uber|airbnb|stripe|twitter|salesforce|intel|amd|adobe|spotify|palantir|bytedance|tiktok|deepmind|anthropic|apple|openai|linkedin)$/i;

/* questions that WANT the overview: lists and counts across his career */
const LIST_Q = /\b(list|every|all|which|how many|companies|employers|jobs|internships|projects|where has|worked|anything|experience|background|career|resume)\b/i;

export function extractAnswer(r: Retrieval, max = 2, debug?: (rows: string[]) => void): Quote[] {
  const wantsList = LIST_Q.test([...r.tokens.map((t) => t.raw), ...(r.corrected ?? []).map((c) => c + "s")].join(" "));
  const direct: [string, number][] = [
    ...r.tokens.filter((t) => t.term && !t.stopword).map((t): [string, number] => [t.term, t.soft ? 0.2 : 1]),
    /* a corrected typo stands for the word the visitor meant to type */
    ...(r.corrected ?? []).map((t): [string, number] => [t, 1]),
  ];
  const ranked = r.top.filter((s) => s.score >= MIN_EVIDENCE);
  /* a question that is only his name and grammar ("who is brian", "tell me
     about him") has no words to match a sentence by: the answer is the
     opening of the best passage */
  const nameOnly = !direct.some(([, w]) => w === 1);
  const cands: { text: string; score: number; chunk: ScoredChunk["chunk"]; hits: string[] }[] = [];
  ranked.forEach((s) => {
    sentences(s.chunk.text).forEach((sent, i) => {
      const terms = termsOf(sent);
      let score = 0;
      const hits: string[] = [];
      for (const [t, w] of direct)
        if (terms.has(t)) {
          score += w;
          hits.push(t);
        }
      /* Synonyms count, but together never as much as one word the visitor
         actually typed: "gpa" in a sentence beats "studies university
         graduates" from the expansion of "gpa". */
      const syn = r.expanded.filter((t) => terms.has(t));
      score += Math.min(0.5, syn.length * 0.3);
      hits.push(...syn);
      if (nameOnly && s === ranked[0] && i < 2) score += 1 - i * 0.2;
      if (score < 0.4) return;
      /* the passage's own retrieval score breaks ties between sentences that
         match equally: "website" in the website card beats "work" in a job */
      score += 0.6 * (s.score / ranked[0].score);
      if (s.chunk.section === "Visitor") score += 0.5;
      /* the overview names everything, so it matches everything: for a
         specific question the specific passage should be the one quoted */
      if (s.chunk.section === "Overview" && !wantsList) score -= 0.4;
      cands.push({ text: sent, score, chunk: s.chunk, hits });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  debug?.(cands.map((c) => `${c.score.toFixed(2)} [${c.hits.join(",")}] ${c.chunk.section}: ${c.text.slice(0, 70)}`));
  /* A visitor's note that retrieval found relevant is quoted FIRST, whatever
     a résumé sentence scored: it is what they just taught the machine, and
     it is newer. The résumé's line follows, so a contradiction is shown as
     one - attributed, never silently resolved. */
  const picked: typeof cands = [];
  const note = cands.find((c) => c.chunk.section === "Visitor");
  if (note) picked.push(note);
  const rest = cands.filter((c) => c.chunk.section !== "Visitor");
  /* A question about several things ("his GPA, his internships and his
     hobbies") deserves a quote per thing, not two quotes on whichever one
     scored best (QA, 2026-11-25). After the first quote, each next one is
     chosen for the words of the question it newly covers; a long, many-part
     question gets a third. */
  const own = new Set(direct.filter(([, w]) => w === 1).map(([t]) => t));
  const limit = own.size >= 4 ? max + 1 : max;
  const covered = new Set<string>();
  const top = rest[0]?.score ?? 0;
  const pool = rest.filter((c) => c.score >= top * 0.6 || [...own].some((t) => c.hits.includes(t)));
  while (picked.length < limit) {
    const resume = picked.some((p) => p.chunk.section !== "Visitor");
    let best: (typeof cands)[number] | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      if (picked.includes(c) || picked.some((p) => p.text === c.text)) continue;
      const fresh = c.hits.filter((h) => own.has(h) && !covered.has(h)).length;
      /* the first resume quote is simply the best one; after it, a quote has
         to answer a word the visitor typed that nothing quoted yet answers,
         or at least a word they typed, and not just ride on synonyms */
      if (resume && !nameOnly) {
        if (!c.hits.some((h) => own.has(h))) continue;
        if (fresh === 0 && c.score < top * 0.6) continue;
        /* a third quote has to earn it: something new, and close to the best */
        if (picked.length >= max && (fresh === 0 || c.score < top * 0.6)) continue;
      }
      const sc = c.score + (resume ? 0.8 * fresh : 0);
      if (sc > bestScore) {
        best = c;
        bestScore = sc;
      }
    }
    if (!best) break;
    picked.push(best);
    for (const h of best.hits) covered.add(h);
  }
  /* A FALSE PREMISE about an employer: "what did he work on at Meta", "why
     did he quit Amazon after two months". The job sentences that match the
     rest of the question read as confirmation under it (QA, 2026-11-25), so
     a well-known company the archive never mentions puts the list of where
     he HAS worked first - the quote that corrects the premise. */
  const named = r.tokens.map((t) => t.raw).find((w) => BIG_CO.test(w) && !indexHas(w));
  if (named) {
    const overview = r.top.find((s) => s.chunk.section === "Overview")?.chunk;
    const fix = overview && sentences(overview.text).find((x) => /\bhas worked at\b/.test(x));
    if (fix && !picked.some((p) => p.text === fix)) {
      picked.unshift({ text: fix, score: Infinity, chunk: overview, hits: [] });
      picked.splice(max);
    }
  }
  /* nothing matched sentence by sentence: the best passage's opening line */
  if (!picked.length && ranked[0]) {
    const first = sentences(ranked[0].chunk.text)[0];
    picked.push({ text: first, score: 0, chunk: ranked[0].chunk, hits: [] });
  }
  return picked.map((c) => ({
    text: trimAround(c.text, c.hits),
    source: sourceOf(c.chunk),
    visitor: c.chunk.section === "Visitor",
  }));
}
