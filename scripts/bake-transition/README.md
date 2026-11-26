# Baking the live page into the keyboard <-> machine clips

The clips are generated footage. They start on the keyboard and end on the
machine, and both of those are static there. Wherever a frame still shows
either one at rest, it is replaced with the live page, captured at the clip's
own 2560x1440. That makes the seams exact in colour and sharpness. The
footage in between is graded and its ink lines tightened. The full story is
in docs/transition-kb-machine.md §21.

Run from the repo root, with the dev server up:

    bash scripts/bake-transition/frames.sh              # the master's frames, uncompressed (271 PNGs)
    node scripts/bake-transition/capture.mjs            # live keyboard, machine, page (2560x1440)
    uv run --with numpy --with pillow --with scipy python scripts/bake-transition/prepare.py
    uv run --with numpy --with pillow --with scipy python scripts/bake-transition/composite.py node_modules/.cache/bake/baked
    bash scripts/bake-transition/encode.sh node_modules/.cache/bake/baked public/transitions

Then:

- bump `CLIP_VERSION` in src/lib/transitions.ts;
- run `npm run seam:check`, which must pass in both directions, position and
  luminance;
- look at the seams in a browser.

Keep the old clips: copy them into media/ first.

**When to re-run:** whenever the keyboard's or the machine's look changes
(keys, lighting, colours, the drawing). Their placement does not need a
re-bake, because TransitionPlayer's seamTransform follows the live board.
The SEAM_* constants in prepare.py must match TransitionPlayer's.
