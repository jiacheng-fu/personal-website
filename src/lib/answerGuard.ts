/* ---------------------------------------------------------------------------
   Guards on the opt-in LLM's answer (QA, 2026-11-25).

   Qwen3-0.6B, run over 50 hard questions and hostile visitor notes, failed
   in three ways a few lines of text handling can catch:

   1. False refusals - 9 of 50. "The context does not mention how many
      engineers used his tool", with "used daily by 200+ engineers" in the
      passage it was handed. When the model says the archive doesn't cover
      something that retrieval found, the archive's own quotes are the better
      answer, and RagSection shows them instead.
   2. Its own instructions, repeated back as the answer: "If that answers the
      question, that IS the answer. Brian's documents above are older..." -
      dropped, sentence by sentence.
   3. "According to a visitor note," on an answer when no visitor note was in
      the briefing at all - dropped.

   Nothing here adds words: it only removes what the model should not have
   said, or hands the answer back to the quotes - and noteJudge() decides
   which sentences of an answer come from a visitor's note, for the UI to mark.
   --------------------------------------------------------------------------- */
import { SYSTEM_PROMPT, VISITOR_CLAUSE, VISITOR_REMINDER } from "./ragPrompt";
import { termsOf } from "./bm25";

/* the reminder the prompt carried until 2026-11-25, when notes outranked
   Brian's documents: answers recorded then still echo it */
const OLD_REMINDER =
  "If that answers the question, that IS the answer. Brian's documents above are older; where they disagree with it, they are out of date and must not be given as the answer.";

/* any script counts as words: Chinese in an answer is content, not filler */
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const INSTRUCTION_SENTENCES = [SYSTEM_PROMPT, VISITOR_CLAUSE, VISITOR_REMINDER, OLD_REMINDER]
  .flatMap((t) => t.split(/(?<=[.!?:])\s+/))
  .map((t) => new Set(words(t)))
  .filter((s) => s.size >= 4);

/* things the prompt says that an answer never should */
const ECHO = [
  /\bif (that|this) answers\b/i,
  /\bthat is the answer\b/i,
  /\bbrian'?s documents (above )?are older\b/i,
  /\bout of date and must not\b/i,
  /\binstead of guessing\b/i,
  /\bif the context (does not|doesn't) contain\b/i,
  /\bif the context is (not provided|incomplete|missing)\b/i,
  /\bthe visitor note is (correct|right)\b/i,
  /\bvisitor note passages\b/i,
  /\bwhere one disagrees with brian'?s documents\b/i,
  /* the model thinking aloud about its own rules */
  /^\s*(otherwise, )?if (the )?(context|question|visitor|document|note|passage)s?\b/i,
];

/* "According to a visitor note," / "According to an unverified visitor note," */
const LEAD_IN = /^\s*according to (an? |the )?(unverified )?visitor('s)? note,?\s*/i;

/** A sentence that is mostly the prompt's own instruction text. */
function isEcho(sentence: string): boolean {
  if (ECHO.some((re) => re.test(sentence))) return true;
  /* the lead-in the prompt asks for is not an echo; what follows it decides */
  const w = words(sentence.replace(LEAD_IN, "").replace(/^\s*according to the context,?/i, ""));
  if (w.length < 5) return false;
  return INSTRUCTION_SENTENCES.some((ins) => w.filter((x) => ins.has(x)).length / w.length >= 0.75);
}

/* a sentence can end on a closing quote - the model quotes notes: 'note,
   "Brian adopted a cat." If that answers...' must split after the quote */
const SENTENCE_END = /(?<=[.!?]["'\u201d\u2019)\]]?)\s+/;
const finished = (s: string) => /[.!?]["')\]\u201d\u2019]?$/.test(s.trim());

/** The model's answer with echoed instructions removed, and "According to a
 *  visitor note" kept only on sentences that do come from one (fromNote, from
 *  noteJudge; null when no note was briefed, and then the lead-in always
 *  goes). Safe on partial (streaming) text: only finished sentences are
 *  judged, the one still being written is left alone. */
export function cleanModelAnswer(text: string, fromNote: NoteJudge | null): string {
  const parts = text.split(SENTENCE_END);
  const last = parts.pop() ?? "";
  const attribute = (s: string, done: boolean) => {
    const m = s.match(LEAD_IN);
    if (!m) return s;
    const rest = s.slice(m[0].length);
    if (fromNote && (!done || fromNote(s))) return s;
    return rest ? rest[0].toUpperCase() + rest.slice(1) : rest;
  };
  const kept = parts.map((s) => attribute(s, true)).filter((s) => !isEcho(s));
  const done = finished(last);
  let tail = attribute(last, done);
  if (done && isEcho(tail)) tail = "";
  const out = [...kept, tail].join(" ").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : out;
}

const REFUSAL = [
  /\b(does not|doesn't|do not|don't) (contain|mention|provide|include|specify|say|state|indicate|cover)\b/i,
  /\bno (information|context|mention|details?|data|specific)\b/i,
  /\bnot (explicitly |specifically )?(mentioned|stated|provided|specified|included|available)\b/i,
  /\bcannot be (derived|determined|answered|found|inferred)\b/i,
  /\b(isn't|is not) (mentioned|stated|provided|specified)\b/i,
  /\bplease provide\b/i,
];

/** The model said the archive doesn't cover it. */
export function isRefusal(text: string): boolean {
  const t = text.trim();
  return t.length < 400 && REFUSAL.some((re) => re.test(t));
}

/** Decides whether a sentence of the model's answer comes from a visitor's
 *  note rather than Brian's archive (Brian, 2026-11-25: "information inserted
 *  via notes should be clearly marked"). It does if
 *   - it uses a term only a note has ("fraud", "Pointer", "pizza"), or
 *   - a note backs more of it than any one sentence of the archive does.
 *     "Brian graduated in 2025" is all archive words, but no archive sentence
 *     has more than two of its three (graduation is December 2027, 2025 a
 *     summer internship), and the note has all three. "Brian is in Seattle":
 *     the archive's Seattle is where the photo was taken, a sentence not
 *     about Brian at all.
 *  Ties go to the archive, so a note that agrees with it marks nothing.
 *  "He" counts as Brian - the archive and the model both say it. Terms are
 *  the index's own (stems, CJK pairs). null when no note was briefed. */
export type NoteJudge = (sentence: string) => boolean;
const ABOUT_HIM = /\b(brian|he|his|him)\b/i;
const termsAbout = (t: string) => {
  const terms = termsOf(t);
  if (ABOUT_HIM.test(t)) terms.add("brian");
  return terms;
};
export function noteJudge(notes: string[], archive: string[]): NoteJudge | null {
  if (!notes.length) return null;
  const archiveSentences = archive.flatMap((t) => t.split(/(?<=[.!?])\s+/)).map(termsAbout);
  const known = new Set(archiveSentences.flatMap((s) => [...s]));
  const noteTerms = notes.map(termsAbout);
  const support = (s: Set<string>, pool: Set<string>[]) =>
    Math.max(0, ...pool.map((p) => [...s].filter((t) => p.has(t)).length));
  return (sentence) => {
    const s = termsAbout(sentence.replace(LEAD_IN, ""));
    if (noteTerms.some((n) => [...s].some((t) => n.has(t) && !known.has(t)))) return true;
    /* the model says it is quoting a note and says something the archive
       never does: a note it translated, which no term matches ("布莱恩最喜欢
       的颜色是蓝色" came back as "Brian's favorite color is blue") */
    if (LEAD_IN.test(sentence) && [...s].some((t) => !known.has(t))) return true;
    const byNote = support(s, noteTerms);
    return byNote > 0 && byNote > support(s, archiveSentences);
  };
}

/** The answer cut into its sentences, each flagged when it comes from a
 *  note - RagSection marks those on the glass. */
export function markNoteSentences(text: string, fromNote: NoteJudge | null): { text: string; fromNote: boolean }[] {
  if (!fromNote) return [{ text, fromNote: false }];
  return text
    .split(SENTENCE_END)
    .filter(Boolean)
    .map((s, i, all) => ({ text: (i ? " " : "") + s, fromNote: (i < all.length - 1 || finished(s)) && fromNote(s) }));
}
