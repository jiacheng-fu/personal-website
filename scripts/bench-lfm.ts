/* LFM2.5-350M on Transformers.js - the candidate that LOST the 2026-10-20
 * bench against Qwen3-0.6B (docs/rag-model-bench.md), kept here so the
 * comparison can be re-run, and not in src/ so none of it ships.
 *
 * It implements the site's Backend interface (src/lib/ragBackends.ts), so the
 * bench drives it exactly like the shipped model. Transformers.js is a
 * devDependency for this file alone.
 *
 * Known gap if it is ever revived for the site: ONNX Runtime fetches the
 * 255 MB `model_q4f16.onnx_data` itself, outside Transformers.js's progress
 * events, so the load reports only the ~3 MB tokenizer and then sits. The
 * progress bar would need its own byte counter, as Qwen's prefetch does.
 */
import { MAX_TOKENS, type Backend } from "../src/lib/ragBackends";

export const LFM_MODEL_ID = "onnx-community/LFM2.5-350M-ONNX";

export const lfm25: Backend = {
  id: "lfm25",
  name: "LFM2.5-350M",
  params: "350M",
  quant: "q4f16",
  runtime: "Transformers.js",
  /* Measured 2026-10-20: model_q4f16.onnx + its external data on Hugging Face
     is 255 MB. Tokenizer and config files and the ONNX Runtime WebGPU build
     (fetched from jsDelivr by Transformers.js) come on top; the bench
     measures the real total over the network. */
  bytes: 255_000_000,

  async load(report) {
    const tf = await import("@huggingface/transformers");

    /* Per-file byte counts from the runtime's own "progress" events, summed.
       The model is several files, each announced only when it starts, so the
       running total is the files seen so far - which only ever grows, and is
       exact once the big weights file has begun. */
    const files = new Map<string, { loaded: number; total: number }>();
    let compiling = false;
    const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status !== "progress" || !e.file || compiling) return;
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      if (total > 0)
        report({
          stage: "fetch",
          progress: Math.min(1, loaded / total),
          bytes: loaded,
          text: `${e.file}: ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`,
        });
    };

    const tokenizer = await tf.AutoTokenizer.from_pretrained(LFM_MODEL_ID, { progress_callback });
    /* Session creation - where ONNX Runtime builds its WebGPU kernels -
       happens inside from_pretrained after the last byte, with no events of
       its own. So the compile stage starts when the download reaches 100%
       and has no count. */
    const modelPromise = tf.AutoModelForCausalLM.from_pretrained(LFM_MODEL_ID, {
      dtype: "q4f16",
      device: "webgpu",
      progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        progress_callback(e);
        const all = [...files.values()];
        if (!compiling && all.length > 0 && all.every((f) => f.total > 0 && f.loaded >= f.total)) {
          compiling = true;
          report({ stage: "compile", progress: null, text: "building WebGPU sessions" });
        }
      },
    });
    const model = await modelPromise;
    report({ stage: "compile", progress: 1, text: "ready" });

    let stopper: InstanceType<typeof tf.InterruptableStoppingCriteria> | null = null;

    return {
      async generate(system, user, onText, signal) {
        const t0 = performance.now();
        let first: number | null = null;
        let tokens = 0;
        let text = "";
        const inputs = tokenizer.apply_chat_template(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { add_generation_prompt: true, return_dict: true }
        ) as Record<string, unknown>;
        stopper = new tf.InterruptableStoppingCriteria();
        const stop = stopper;
        signal?.addEventListener("abort", () => stop.interrupt(), { once: true });
        const streamer = new tf.TextStreamer(tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          token_callback_function: () => {
            if (first === null) first = performance.now();
            tokens++;
          },
          callback_function: (piece: string) => {
            text += piece;
            onText(text.trimStart());
          },
        });
        /* Liquid's recommended settings for this model: temperature 0.1,
           top_k 50, repetition_penalty 1.05. Greedy decoding is what
           temperature 0.1 converges to and is what their own Transformers.js
           example uses, so it is greedy here. */
        await model.generate({
          ...inputs,
          max_new_tokens: MAX_TOKENS,
          do_sample: false,
          repetition_penalty: 1.05,
          streamer,
          stopping_criteria: stop,
        });
        const t1 = performance.now();
        return {
          tokens,
          seconds: (t1 - t0) / 1000,
          firstTokenS: first === null ? null : (first - t0) / 1000,
        };
      },
      async interrupt() {
        stopper?.interrupt();
      },
      async dispose() {
        await model.dispose();
      },
    };
  },
};

