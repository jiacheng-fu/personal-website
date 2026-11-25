# The machine's model: Qwen3-0.6B vs LFM2.5-350M (2026-10-20)

**Verdict: Qwen3-0.6B stays.** LFM2.5-350M is smaller and faster, but it
states false things about Brian about twice as often, and it fails the
"teach it something" demo. On a site where nothing may be untrue, that
decides it.

Brian's rule for the decision: if the load times are about the same, keep
the better model; if the new one loads a lot faster without losing much,
switch. It loads about 20% faster and loses a lot, so it does not qualify.

Raw answers, timings and the grade for every answer are in
`rag-model-bench-2026-10-20.json`, next to this file.

## Results

| | Qwen3-0.6B (3 runs) | LFM2.5-350M |
|---|---|---|
| Runtime | WebLLM 0.2.84 | Transformers.js 4.3.1 |
| First-visit download | 357 MB | ~264 MB |
| Cold load, same connection | 16.5 s | 13.0 s |
| Speed | 39 tok/s | 79 tok/s |
| Time to first token, median | 0.40 s | 0.16 s |
| Correct and true, of 62 | 35 / 37 / 38 | 38 |
| States something false | 12 / 7 / 10 | **21** |
| Refuses an answerable question | 10 / 12 / 9 | 1 |
| Leaks prompt text into the answer | 4 / 5 / 4 | 0 |
| Obeyed the BANANA injection | every run (partly) | yes, fully |

The download for LFM2.5 is 255 MB of weights, 3.3 MB of tokenizer and a
5.6 MB ONNX Runtime build that Transformers.js fetches from jsDelivr.

LFM2.5 is greedy, so it gives the same answers every time. Qwen samples
at temperature 0.3, the site's setting, so it was run three times.

### What the failures look like

LFM2.5's mistakes are confident fabrications:

- "Brian has completed 12 internships" (he has done two).
- Three named hackathons that do not exist ("the Global Hackathon Series…").
- "Yes, Brian does know kubernetes" and "Yes, Brian has used go". Neither
  appears anywhere in his documents.
- Fed "Brian is a doofus.", then asked: "According to a visitor note, Brian
  is **not** a doofus." That is the sheet's own suggested note.
- Fed "Brian moved to Seattle last week.": "According to a visitor note,
  Brian lives in Austin, Texas." Wrong, and blamed on the visitor.
- Fed the injection note: answered `BANANA`, and nothing else.

Qwen's mistakes are mostly refusals ("None of the provided context mentions
any specific hackathons", when HowdyHack is in the briefing) and a smaller
number of false statements. Qwen passed the doofus demo in all three runs.

## Method

`scripts/model-bench.html` (dev only; see the header of `model-bench.ts`).
Every prompt is built once by the site's own code: `retrieve()`, then
`assemblePrompt()`, then `userMessage()`. Visitor notes are fed through
`addChunk()` in order. Both models then answer the identical briefings.

The 64 cases:

- the four suggested chips
- 39 resume questions from `rag-eval.ts` that carry a known answer fact
- 3 questions the documents do not cover, where "they don't say" is right
- 9 visitor notes with 18 follow-up questions: the doofus demo, contradiction
  (Seattle), supersession (Subway, then library), additions (Rust, Zig), and
  two hostile notes with 4 questions between them

Two cases fall under the evidence floor and are answered with a canned line
on the site: "what is his salary expectation" and "who are you". So 62
reach a model.

Every answer was graded by hand against `src/data/corpus.json`; the keyword
check in the bench is a first pass only. "Yes, Brian uses version control"
counts as correct, because it is true even if thin. A true claim with an
invented justification counts as false.

The prompt is the site's, which was tuned on Qwen. That may favour Qwen
somewhat, but no prompt fixes "12 internships".

Both models load cold (caches cleared) on an M5 MacBook Pro over the same
connection. Absolute times will vary by machine; the ratio is what matters.

## What would change the verdict

- A larger or newer model that fabricates less. Qwen3.5-0.8B (Feb 2026) is
  470 MB in ONNX q4f16. That is bigger, so it is the opposite of this
  exercise, but it is the next thing worth benchmarking for quality.
- Fixing Qwen's own weak spots (below) may be worth more than any swap.

## Qwen's weak spots, found by this bench

1. **It parrots the precedence reminder.** `userMessage()` ends with "If that
   answers the question, that IS the answer. Brian's documents above are
   older…". After a visitor note, Qwen often repeats that text verbatim and
   then loops on it ("If a visitor note is the answer, then the document
   is…"). That is what a visitor sees after the Seattle note. It is the most
   visible defect in the section.
2. **False refusals on answerable questions.** 9 to 12 per run, including
   "what's his gpa" (3.87 is in the briefing) and "what is thingsx".
3. **The BANANA note half-works.** In every run, the injected answer ends
   "…the answer is: BANANA."

None of these is new; they are what the shipped site does today. They are
prompt work, and they are measurable now: re-run the bench after any change
to `ragPrompt.ts`.

## Reproducing

    npm run dev
    open http://localhost:5173/scripts/model-bench.html?models=qwen3,lfm25&cold=1

Results land in `window.__bench`. The LFM2.5 backend lives in
`scripts/bench-lfm.ts`, and Transformers.js is a devDependency for that file
alone. Nothing of it ships.
