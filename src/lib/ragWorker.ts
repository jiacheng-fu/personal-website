/// <reference lib="webworker" />
/* The model, in its own thread.

   WebLLM - its 6 MB of JavaScript, the tokenizer, the weight upload, the
   shader compile and every token of every answer - runs here, never on the
   page's main thread. On a fast machine that changes nothing you can see; on
   an older one it is the difference between the page scrolling while the
   model loads and the page freezing for seconds at a time. (WebLLM's own
   recommended setup; this is a minimal version of its protocol.)

   The page talks to it with five messages (ragBackends.ts):
     load      -> progress*, loaded | error
     generate  -> text*, done | gen-error
     interrupt, dispose
   The weights are already in the Cache API by the time `load` arrives -
   the page downloads them itself - and a worker sees the same caches. */
import { CreateMLCEngine, prebuiltAppConfig, type MLCEngine } from "@mlc-ai/web-llm";

type In =
  | { type: "load"; id: string; model: string; lib: string; upstreamModel: string; upstreamLib: string }
  | { type: "generate"; id: number; system: string; user: string; maxTokens: number }
  | { type: "interrupt" }
  | { type: "dispose" };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: unknown) => scope.postMessage(m);
let engine: MLCEngine | null = null;

scope.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      const rec = prebuiltAppConfig.model_list.find((r) => r.model_id === m.id);
      if (!rec) throw new Error(`${m.id} is not in this WebLLM's model list`);
      if (rec.model !== m.upstreamModel || rec.model_lib !== m.upstreamLib)
        post({ type: "warn", message: "WebLLM's own URLs for this model changed; the mirror may be stale", model: rec.model, model_lib: rec.model_lib });
      /* WebLLM's record, pointed at the mirror; everything else is its own */
      engine = await CreateMLCEngine(m.id, {
        appConfig: { model_list: [{ ...rec, model: m.model, model_lib: m.lib }] },
        initProgressCallback: (p) => post({ type: "progress", progress: p.progress, text: p.text }),
      });
      post({ type: "loaded" });
    } else if (m.type === "generate") {
      if (!engine) throw new Error("no model loaded");
      const t0 = performance.now();
      let first: number | null = null;
      let tokens = 0;
      let text = "";
      const stream = await engine.chat.completions.create({
        messages: [
          { role: "system", content: m.system },
          { role: "user", content: m.user },
        ],
        stream: true,
        max_tokens: m.maxTokens,
        temperature: 0.3,
        /* Qwen3 thinks out loud by default; at 0.6B it rarely helps a grounded
           answer. Belt (option) and suspenders (strip tags below). */
        extra_body: { enable_thinking: false },
      });
      for await (const delta of stream) {
        const piece = delta.choices[0]?.delta?.content ?? "";
        if (!piece) continue;
        if (first === null) first = performance.now();
        tokens++;
        text += piece;
        post({ type: "text", id: m.id, text: text.replace(/<think>[\s\S]*?(<\/think>|$)/, "").trimStart() });
      }
      const t1 = performance.now();
      post({
        type: "done",
        id: m.id,
        stats: { tokens, seconds: (t1 - t0) / 1000, firstTokenS: first === null ? null : (first - t0) / 1000 },
      });
    } else if (m.type === "interrupt") {
      await engine?.interruptGenerate();
    } else if (m.type === "dispose") {
      await engine?.unload();
      engine = null;
      post({ type: "disposed" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post(m.type === "generate" ? { type: "gen-error", id: m.id, message } : { type: "error", message });
  }
};
