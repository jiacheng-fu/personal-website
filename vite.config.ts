import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  /* the model's worker (src/lib/ragWorker.ts) imports WebLLM, which splits
     into chunks: only the ES format supports that */
  worker: { format: "es" },
  server: {
    watch: {
      // The native watcher intermittently misses writes from external tools
      // on this Windows temp dir, which serves stale modules over HMR.
      usePolling: true,
      interval: 250,
    },
  },
});
