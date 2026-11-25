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
import { MIN_EVIDENCE, termsOf, type Retrieval, type ScoredChunk } from "./bm25";

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

/* questions that WANT the overview: lists and counts across his career */
const LIST_Q = /\b(list|every|all|which|how many|companies|employers|jobs|internships|projects|where has|worked|anything)\b/i;

export function extractAnswer(r: Retrieval, max = 2, debug?: (rows: string[]) => void): Quote[] {
  const wantsList = LIST_Q.test(r.tokens.map((t) => t.raw).join(" "));
  const direct: [string, number][] = r.tokens
    .filter((t) => t.term && !t.stopword)
    .map((t): [string, number] => [t.term, t.soft ? 0.2 : 1]);
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
  for (const c of rest) {
    if (picked.length >= max) break;
    if (rest[0] && c !== rest[0] && c.score < rest[0].score * 0.6) break;
    /* a second quote has to answer a word the visitor typed, not just ride
       along on synonyms */
    if (picked.some((p) => p.chunk.section !== "Visitor") && !nameOnly && !c.hits.some((h) => direct.some(([t, w]) => t === h && w === 1))) continue;
    if (picked.some((p) => p.text === c.text)) continue;
    picked.push(c);
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
