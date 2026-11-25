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
   said, or hands the answer back to the quotes - and noteOnlyTerms() finds
   what in an answer only a visitor's note supports, for the UI to mark.
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

/** The model's answer with echoed instructions and an unfounded "According to
 *  a visitor note" removed. Safe on partial (streaming) text: only finished
 *  sentences are judged, the one still being written is left alone. */
export function cleanModelAnswer(text: string, notesBriefed: boolean): string {
  let t = text;
  if (!notesBriefed) t = t.replace(LEAD_IN, "");
  /* a sentence can end on a closing quote - the model quotes notes: 'note,
     "Brian adopted a cat." If that answers...' must split after the quote */
  const parts = t.split(/(?<=[.!?]["'\u201d\u2019)\]]?)\s+/);
  const last = parts.pop() ?? "";
  const kept = parts.filter((s) => !isEcho(s));
  const tail = /[.!?]["')\]]?$/.test(last) && isEcho(last) ? "" : last;
  const out = [...kept, tail].join(" ").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : out;
}

const REFUSAL = [
  /\b(does not|doesn't|do not|don't) (contain|mention|provide|include|specify|say|state|indicate)\b/i,
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

/** The terms only a visitor's note supports: in a note, but in none of
 *  Brian's passages and not in the question. A model's answer that uses one
 *  is repeating the note, and RagSection marks those words on the glass
 *  (Brian, 2026-11-25: "information inserted via notes should be clearly
 *  marked"). Terms are the index's own (stems, CJK pairs), so "adopted" in
 *  the answer matches "adopt" in the note. */
export function noteOnlyTerms(notes: string[], others: string[]): Set<string> {
  const known = new Set(others.flatMap((t) => [...termsOf(t)]));
  const out = new Set<string>();
  for (const n of notes) for (const t of termsOf(n)) if (!known.has(t)) out.add(t);
  return out;
}

/** The answer cut into runs, each flagged when it carries a note-only term:
 *  words and CJK runs are judged, the spaces and punctuation between them
 *  pass through. */
export function markNoteTerms(text: string, noteOnly: Set<string>): { text: string; fromNote: boolean }[] {
  if (!noteOnly.size) return [{ text, fromNote: false }];
  const out: { text: string; fromNote: boolean }[] = [];
  for (const part of text.split(/([\p{L}\p{N}']+)/u)) {
    if (!part) continue;
    const fromNote = /[\p{L}\p{N}]/u.test(part) && [...termsOf(part)].some((t) => noteOnly.has(t));
    const last = out[out.length - 1];
    /* "arrested for fraud": one mark, not three */
    if (last && last.fromNote === fromNote) last.text += part;
    else if (last && fromNote && last.fromNote === false && /^\s+$/.test(last.text) && out[out.length - 2]?.fromNote) {
      out.pop();
      out[out.length - 1].text += last.text + part;
    } else out.push({ text: part, fromNote });
  }
  return out;
}
