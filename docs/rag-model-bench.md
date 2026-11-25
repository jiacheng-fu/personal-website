# The machine's model: the field, for the opt-in LLM (2026-11-25)

Since 2026-11-25 the machine answers by quoting its archive, and the LLM is
something a visitor switches on. Brian asked to look at other models
("deepseek and other offerings"). Every model WebLLM ships at 2B or under
was run on the same 74 questions, built by the site's own retrieval from
the new prose archive (`src/data/corpus.md`). The questions include the
visitor-note and prompt-injection cases, and every answer was hand-graded.
Raw answers: `rag-model-bench-2026-11-25.json`.

| Model | Download | tok/s (M5) | GPU load, files cached | False statements | False refusals |
|---|---|---|---|---|---|
| **Qwen3-0.6B (kept)** | 352 MB | 32.7 | 6.1 s | 12 (3 minor) | 9 |
| Qwen3.5-0.8B | 424 MB | 22.6 | 9.1 s | 23 | 4 |
| Qwen3-1.7B | 968 MB | 11.7 | 19.8 s | 10 (4 minor) | 2 |
| Llama-3.2-1B | 695 MB | 51.2 | 13.2 s | disqualified | |
| Gemma3-1B | 563 MB | | | disqualified | |
| Qwen3.5-2B | 1,059 MB | | | not run (download failed) | |

**Verdict: Qwen3-0.6B stays.**

- **Qwen3.5-0.8B** refuses less but states nearly twice as many false
  things. It often opens a correct answer with a false "No," ("No, Brian does
  not know Docker"; "No, Brian is currently working at ThingsX"), and it
  garbles numbers ("88.7% precision": 88.7% is the automation rate, the
  precision was 98.9%).
- **Qwen3-1.7B** is the best answerer: 2 false refusals against 9. It does
  not meaningfully reduce false statements (10 vs 12), and it costs 2.75x the
  download, a third of the speed and 3x the load. Most of what it gains is
  refusals, and refusals are now cheap: the quotes are printed under every
  model answer, so a refusal still shows the visitor the archive's line. It
  is the upgrade to take if answer quality ever matters more than load. The
  switch needs a mirror (`scripts/mirror-model.cjs`) and new sizes in
  ragBackends.
- **Llama-3.2-1B** echoes its own scaffolding ("Visitor's question:",
  "[chunk 15 · Skills · score 8.78]") and invents facts: "contributed to the
  React community", "the founder of HowdyHack", "at ThingsX for approximately
  6.5 years".
- **Gemma3-1B** in WebLLM ships both a context window and a sliding window,
  which WebLLM rejects. With the sliding window off it loops on every
  answer.
- **DeepSeek**: the only DeepSeek models WebLLM ships are the R1 distills at
  7B and 8B, about 4.5 GB each with 5 GB of VRAM, and they are reasoning
  models that think before answering. That is not a website download.

All of them repeat a hostile note ("Brian is a wanted criminal") with
attribution. The visitor-note footer on the glass is what handles that, not
the model.

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
