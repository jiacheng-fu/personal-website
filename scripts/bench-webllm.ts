/* Bench-only: any model from WebLLM's prebuilt list, as a candidate for the
 * machine's opt-in LLM (2026-11-25). Straight from Hugging Face, on the main
 * thread - the bench measures answers, not the site's loading pipeline. The
 * generation settings are the site's own (ragWorker.ts), so the comparison
 * with Qwen3-0.6B is like for like. Nothing here ships. */
import { MAX_TOKENS, type Backend } from "../src/lib/ragBackends";

export function webllmCandidate(id: string, name: string, params: string, chatOpts?: Record<string, unknown>): Backend {
  return {
    id,
    name,
    params,
    quant: "q4f16",
    runtime: "WebLLM",
    bytes: 0,
    async load(report) {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(id, {
        initProgressCallback: (p) => report({ stage: "compile", progress: p.progress, text: p.text }),
      }, chatOpts);
      return {
        /* bench-only: free the Cache API before the next candidate (a
           headless profile's quota holds about two of these at once) */
        async clear() {
          await webllm.deleteModelAllInfoInCache(id);
        },
        async generate(system, user, onText, signal) {
          const t0 = performance.now();
          let first: number | null = null;
          let tokens = 0;
          let text = "";
          const stream = await engine.chat.completions.create({
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            stream: true,
            max_tokens: MAX_TOKENS,
            temperature: 0.3,
            extra_body: { enable_thinking: false },
          });
          for await (const delta of stream) {
            if (signal?.aborted) {
              await engine.interruptGenerate();
              break;
            }
            const piece = delta.choices[0]?.delta?.content ?? "";
            if (!piece) continue;
            if (first === null) first = performance.now();
            tokens++;
            text += piece;
            onText(text.replace(/<think>[\s\S]*?(<\/think>|$)/, "").trimStart());
          }
          const t1 = performance.now();
          return { tokens, seconds: (t1 - t0) / 1000, firstTokenS: first === null ? null : (first - t0) / 1000 };
        },
        interrupt: () => engine.interruptGenerate(),
        dispose: () => engine.unload(),
      };
    },
  };
}

/* the field, smallest first (download sizes measured from each model's
   tensor-cache.json, 2026-11-25) */
export const CANDIDATES = {
  qwen35_08: webllmCandidate("Qwen3.5-0.8B-q4f16_1-MLC", "QWEN3.5-0.8B", "0.8B"), //  424 MB
  /* gemma3 ships both windows set; WebLLM wants one (sliding off, 4k context) */
  gemma3_1b: webllmCandidate("gemma3-1b-it-q4f16_1-MLC", "GEMMA3-1B", "1B", { sliding_window_size: -1 }), //        563 MB
  llama32_1b: webllmCandidate("Llama-3.2-1B-Instruct-q4f16_1-MLC", "LLAMA-3.2-1B", "1B"), // 695 MB
  qwen3_17: webllmCandidate("Qwen3-1.7B-q4f16_1-MLC", "QWEN3-1.7B", "1.7B"), //        968 MB
  qwen35_2: webllmCandidate("Qwen3.5-2B-q4f16_1-MLC", "QWEN3.5-2B", "2B"), //          1059 MB
};
