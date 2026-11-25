/* Mirror the machine's small model files onto the site itself.
 *
 *   node scripts/mirror-model.cjs
 *
 * WHY. Hugging Face and GitHub serve these files raw. Vercel compresses JSON
 * and WebAssembly on the fly (brotli when the browser accepts it), and these
 * two are almost all redundancy:
 *
 *   tokenizer.json   11.4 MB  -> ~1.5 MB brotli
 *   the WebGPU lib    5.5 MB  -> ~0.5 MB brotli
 *
 * The 335 MB of weight shards stay on Hugging Face - 4-bit weights do not
 * compress (measured floor: 90% of their size), and Vercel's free plan
 * bandwidth would not carry them. The mirrored tensor-cache.json therefore
 * names every shard by its ABSOLUTE Hugging Face URL; WebLLM resolves shard
 * paths with `new URL(dataPath, base)`, so an absolute path simply wins.
 *
 * WHAT IT WRITES, under public/llm/<DIR>/:
 *   resolve/main/tensor-cache.json      shard list, dataPaths made absolute
 *   resolve/main/mlc-chat-config.json   verbatim
 *   resolve/main/tokenizer.json         verbatim
 *   <lib>.wasm                          verbatim
 *   SOURCE.json                         where each came from, sizes, sha256
 *
 * The `resolve/main/` segment is load-bearing: WebLLM's cleanModelUrl appends
 * one to any model URL that lacks it.
 *
 * REFRESHING. If WebLLM is upgraded, `npm run rag:gates` fails its drift
 * check. Update UPSTREAM_* here and in src/lib/ragBackends.ts, bump DIR's
 * revision (browsers cache these by URL, forever), re-run this, and point
 * QWEN_HOSTED_DIR at the new folder.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";
const UPSTREAM_MODEL_URL = "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC";
const UPSTREAM_BASE = `${UPSTREAM_MODEL_URL}/resolve/main/`;
const UPSTREAM_LIB_URL =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm";
const DIR = "qwen3-0.6b-q4f16_1-r1";

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "llm", DIR);
const MAIN = path.join(OUT, "resolve", "main");

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

(async () => {
  /* Hugging Face's own listing, to check every byte arrived */
  const tree = await (await fetch(`https://huggingface.co/api/models/mlc-ai/${MODEL_ID}/tree/main`)).json();
  const expect = Object.fromEntries(tree.map((f) => [f.path, f.size]));

  fs.mkdirSync(MAIN, { recursive: true });
  const source = {
    model_id: MODEL_ID,
    upstream_model_url: UPSTREAM_MODEL_URL,
    upstream_lib_url: UPSTREAM_LIB_URL,
    mirrored: new Date().toISOString().slice(0, 10),
    note: "Written by scripts/mirror-model.cjs. Weight shards are NOT here; tensor-cache.json points at Hugging Face.",
    files: {},
  };

  for (const name of ["mlc-chat-config.json", "tokenizer.json"]) {
    const b = await get(UPSTREAM_BASE + name);
    if (b.length !== expect[name]) throw new Error(`${name}: ${b.length} bytes, Hugging Face lists ${expect[name]}`);
    fs.writeFileSync(path.join(MAIN, name), b);
    source.files[`resolve/main/${name}`] = { from: UPSTREAM_BASE + name, bytes: b.length, sha256: sha(b) };
  }

  const manifestRaw = await get(UPSTREAM_BASE + "tensor-cache.json");
  if (manifestRaw.length !== expect["tensor-cache.json"]) throw new Error("tensor-cache.json size mismatch");
  const manifest = JSON.parse(manifestRaw.toString("utf8"));
  for (const r of manifest.records) {
    if (/^https?:/.test(r.dataPath)) throw new Error(`already absolute: ${r.dataPath}`);
    if (expect[r.dataPath] !== r.nbytes) throw new Error(`${r.dataPath}: manifest says ${r.nbytes}, Hugging Face ${expect[r.dataPath]}`);
    r.dataPath = UPSTREAM_BASE + r.dataPath;
  }
  const manifestOut = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(MAIN, "tensor-cache.json"), manifestOut);
  source.files["resolve/main/tensor-cache.json"] = {
    from: UPSTREAM_BASE + "tensor-cache.json",
    upstream_sha256: sha(manifestRaw),
    rewritten: "every dataPath made an absolute Hugging Face URL",
    bytes: manifestOut.length,
    sha256: sha(manifestOut),
    shards: manifest.records.length,
    shard_bytes: manifest.records.reduce((a, r) => a + r.nbytes, 0),
  };

  const libName = UPSTREAM_LIB_URL.slice(UPSTREAM_LIB_URL.lastIndexOf("/") + 1);
  const lib = await get(UPSTREAM_LIB_URL);
  fs.writeFileSync(path.join(OUT, libName), lib);
  source.files[libName] = { from: UPSTREAM_LIB_URL, bytes: lib.length, sha256: sha(lib) };

  fs.writeFileSync(path.join(OUT, "SOURCE.json"), JSON.stringify(source, null, 2) + "\n");
  for (const [k, v] of Object.entries(source.files)) console.log(`  ${k.padEnd(36)} ${(v.bytes / 1e6).toFixed(2).padStart(7)} MB`);
  console.log(`mirrored into public/llm/${DIR}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
