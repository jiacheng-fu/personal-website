# Personal Website

**Live: https://brianfu.dev**

My portfolio, built as a short film you scroll through one scene at a time
rather than a page of cards. React, TypeScript and Vite, deployed on Vercel.

## What's in it

- **Hero:** a photo with my name set behind me. Click and the logos of the
  tools I use erupt out of my head (`src/lib/eruption.ts`).
- **The keyboard:** a 3D keyboard where every keycap is a skill, built in React
  Three Fiber. Hover a key to see where I used it. The idea and the keycap mesh
  come from [Naresh Khatri's 3d-portfolio](https://github.com/Naresh-Khatri/3d-portfolio)
  (MIT); see [Credits](#credits).
- **The machine:** a retro computer that answers questions about me with
  retrieval-augmented generation running **entirely in your browser**. There's
  no server and no API key, and nothing you type leaves the page.
  - Retrieval is BM25 over chunks of my résumé (`src/lib/bm25.ts`). It's built
    so you can watch it work: the screen shows which terms matched and how
    much each chunk scored.
  - Generation is Qwen3-0.6B, run on your GPU through
    [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU
    (`src/lib/ragEngine.ts`, `src/lib/ragBackends.ts`). The model starts
    downloading when you land, and the machine's boot bar is the real load.
- **Selected work:** a project index with a live preview of each project. You
  reach it through a terminal handoff: `ls ~/work` prints the projects, and
  their names fly out of the screen to become the index.
- **Section transitions:** pre-rendered clips, with the live page re-registered
  underneath so each cut is seamless (`src/lib/transitions.ts`,
  `docs/section-transitions.md`).

All motion respects `prefers-reduced-motion`, and the whole site works without
the transitions (the "Motion" toggle in the nav).

## Run it

```bash
npm install
npm run dev        # dev server
npm run build      # typecheck + production build
npm run rag:eval   # retrieval regression suite: answerable questions must retrieve
npm run rag:gates  # engine gates for the in-browser model
```

WebGPU is required for the machine to answer (any current Chrome, Edge or Safari
on a recent GPU). Without it, the rest of the site still works.

## Credits

- Skills keyboard: after [Naresh Khatri's 3d-portfolio](https://github.com/Naresh-Khatri/3d-portfolio)
  (MIT). The concept and the keycap mesh are his. The keyboard was rewritten
  for this site. His license is reproduced in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Model: [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), served by
  [WebLLM](https://github.com/mlc-ai/web-llm).
