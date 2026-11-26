# Transition B′ — Keyboard → Machine

*Status: spec only. Nothing generated. Start frame captured and uploaded;
the other two frames are ours to render (see §2).*

## 0 · Decisions (Brian, 2026-08-26)

| Decision | Choice |
|---|---|
| Startup sound | ~~Apple ][ beep~~ → **no sound** (Brian, after seeing it in place). The keyboard lamp's click is gone too. |
| Clip structure | **Two clips**, each pinned at both ends by our own renders. |
| Quality/cost | **Drafts at 720p `fast`; the accepted prompt once at 1080p `std`.** |
| Landing scale | The board lands **already at the machine's keyboard size and position**; the size change happens during the fall. |
| Wipe line | **Thin accent-red line** (`#cf3f22`, 2–3 px, tilted like `/`), right → left. |
| Surface | **No desk.** Paper background + soft cast shadow, exactly as the machine section. |
| Boot on glass | **CRT bloom, then the boot menu types itself in** (~1.5 s). |
| Repeat / reverse | **Every traversal, both directions** — reversed footage on the way up — with a **page-wide "transitions on/off" toggle** next to the sound toggle, since every section boundary will get a clip. |
| Credit cap | ~~150~~ ~~160~~ **200 credits** (raised by Brian 2026-08-26 to cover a second draft of each clip). Preflight every call; stop and check in at the cap. |
| Draft review | **Every draft is shown to Brian** before the next credit is spent. |
| Keycaps | Behind the wipe the keys become **plain beige/brown** like the machine's; brand logos vanish. |
| Small screens / reduced motion | **Hard cut** under 720 px and under `prefers-reduced-motion`, regardless of the toggle. |
| End frame chrome | Frame M is **only the machine on paper**; nav, dots, sheet, label, footnote **fade in after the cut** (~0.4 s) while the beep plays. |
| Frame F | **The machine minus monitor and pedestal** — same SVG, same place. Clip B only grows the monitor. |
| Durations | Generated at **A = 5 s, B = 5 s**; in post the holds are trimmed and the footage runs at ~1.55×, so the delivered clip is **~5.3 s total**. Both ends are bookended with our own K / M stills (0.45 s, 0.3 s dissolve) so the cut in and out is pixel-exact. |
| Line angle | Forward slash `/`, sweeping right → left. |
| Feel | **A motion product commercial**: deliberate pacing, a held beat before each event, precise physics with a small overshoot, premium and clean. Camera stays locked (any camera move would break the pinned frames); the feel comes from timing and easing. |

## 1 · The sequence

The board on the black stage becomes the Apple ][ — by way of a wipe, a fall,
and a growth — and then the machine boots into the live terminal.

```
0.0   START FRAME — the standing board, lit, our own render
0.2   a diagonal LINE enters from the right edge and sweeps left. it is a
      filter, not a shutter: everything behind it is restyled, not replaced.
      behind the line: black studio → paper; photoreal board → the flat,
      ink-outlined illustration style of the machine section. same pose,
      same angle, same position
1.4   the line exits left. the whole frame is now the illustration
1.5   the board FALLS flat onto the desk. not a slab: one corner lands
      first, it rocks onto the opposite corner, a smaller bounce, settles.
      like a tablet dropped on its side
2.8   INTERMEDIATE FRAME — the board lying flat, in the machine's keyboard
      position, illustration style, paper background. our own render
2.9   the rear of the board thickens into the case; the MONITOR rises out
      of it — body, bezel, dark glass — the pedestal forms under it
5.2   END FRAME — the complete machine, screen BLACK. our own render
--- clip ends, page takes over ---
5.2   the section is live underneath, its screen still dark
5.4   startup sound (see §5 — not Apple's)
5.6   CRT power-on: a bright horizontal line, the glass blooms open,
      phosphor settles; the boot menu types itself in
```

Total generated footage ≈ 5.2 s in two clips. Reverse traversal plays the
same footage backwards (§6).

## 2 · The three frames — all ours

The whole reason this works: **every frame the model is asked to hit is a
frame we rendered.** It never has to invent the destination.

| Frame | Source | Status |
|---|---|---|
| **K** — standing board | live keyboard section, lit + posed, chrome hidden, 2560×1440 | ✅ `public/shots/transition-kb-start.png`, uploaded (`1bed5b49…`) |
| **F** — flat board, case only | the machine section's SVG with the monitor omitted: case + keyboard band + shadow, paper background | ✅ `public/shots/transition-F-case.png` (`?frame=case`) |
| **M** — full machine, screen off | the machine section at rest with the CRT painted black, all chrome hidden | ✅ `public/shots/transition-M-off.png` (`?frame=off`) |

F and M are the same SVG in the same place, so F→M is a pure "monitor grows
out of the case" with nothing else moving — exactly what a model is good at.
K→F is the hard clip (a style change *and* a fall) and it is pinned at both
ends, which is the most help a model can be given.

Frame F should place the flat board exactly where the machine's keyboard band
sits (design y≈505–565 of 600, centred), at the machine's width, so the
morph never has to translate the object — only grow it.

## 3 · Model & shared parameters

`seedance_2_0` — proven on the hero, supports `start_image` **and**
`end_image`, still in the catalog (checked 2026-08-26). Fallback for variants:
`minimax_h3` (keyframes, batch of 4 per call).

Shared params, every call:
```
aspect_ratio: "16:9"   resolution: "1080p"   mode: "std"
bitrate_mode: "standard"   generate_audio: false   ← defaults TRUE; force it
get_cost: true on the first call of each clip, report, then submit
```

Style anchor for both prompts (the machine's actual palette, so the model is
told what "the illustration" means): warm paper `#f3f1ed`, beige case
`#dcd2b6` / `#ece3cc` highlights / `#b9ad90` shade, dark keys `#7b7160`,
light keys `#d3c9ad`, bezel `#57503f`, thin ink outlines, three fixed light
levels, soft blurred cast shadow, no gradients beyond a gentle vertical
falloff, no texture, no photorealism.

## 4 · Prompts

### Clip A — `start_image = K`, `end_image = F`, `image_references = [F, tilted case render]`, 5 s *(draft 3 prompt)*

> Premium product commercial, the kind of clean motion-design film that
> launches a device. Locked-off camera, absolutely no camera movement, no
> zoom, no drift. The scene opens exactly on the first frame: a photoreal
> mechanical keyboard standing tilted on a black studio floor under a single
> spotlight. Hold on it, perfectly still, for a beat.
>
> Then a single thin, perfectly straight, bright red diagonal line — tilted
> like a forward slash, only two or three pixels wide, razor sharp, with no
> glow, no blur and no light spill — enters from the right edge and glides
> across the frame to the left edge in about one second at one smooth,
> constant speed. The line is a filter, not a cut: everything the line has
> passed over is instantly redrawn as a flat vector illustration. The black
> studio becomes a warm off-white paper background. And the keyboard is
> REPLACED by a DIFFERENT keyboard — the keyboard of the illustrated
> computer shown in the reference images: a slim, low beige wedge case with
> a thin lighter strip along its rear edge, a compact keyboard of four short
> rows of small identical blank keycaps (rows alternating beige and brown),
> and a plain front lip. It is not the original keyboard recoloured; it is
> that illustrated case, standing in exactly the same position and at
> exactly the same tilt as the original board, drawn with thin ink outlines,
> flat colours, no shading gradients, no reflections, no letters, no icons,
> no markings on any key. The boundary is a hard, clean edge along the line;
> there is no fading or blending anywhere. Ahead of the line everything is
> still the photoreal original; behind it, everything is illustration.
> Nothing else moves during the sweep. When the line leaves the left edge the
> entire frame is illustration. Hold for a beat.
>
> Then the illustrated case tips forward and falls flat, with the measured,
> satisfying physics of a product film: as it falls it also recedes, so it
> lands smaller — the same slim case lying flat, centred low in the frame,
> on the bare paper with only a soft shadow beneath it. There is no desk,
> no table edge, no horizon line — only paper. One corner touches first, it
> pivots and rocks over onto the opposite corner, a smaller bounce, and it
> settles flat with a tiny overshoot, the shadow tightening under it as it
> comes to rest. It ends perfectly still, exactly matching the last frame.
> The case keeps its flat illustrated look and its blank keys throughout.
> Flat vector illustration style, clean, elegant, no photorealism after the
> line, no text anywhere, no cuts.

**Accept if:** the sweep is one straight line, right → left, ~1 s; the
restyle happens *only* behind the line; the fall is corner-first with a
visible rock and settle; the final frame matches F closely enough that the
cut is invisible; no lettering appears anywhere.

**Likely failures → fix:**
- *Crossfade instead of a wipe* → add: "The change is a hard edge along the
  line, like a wipe transition; there is no fading or blending anywhere."
- *Board changes size/position during the restyle* → add: "The keyboard's
  outline does not move at all during the sweep; only its rendering style
  changes."
- *The fall is a rigid drop* → add: "The fall is physical: it lands on one
  corner, pivots, rocks, and comes to rest in three decreasing bounces."
- *Photoreal creeping back after the sweep* → strengthen the style anchor and
  give it F as `image_references` in addition to `end_image`.

### Clip B — `start_image = F`, `end_image = M`, 5 s *(draft 3 prompt: elastic; the monitor takes its time)*

> Premium product commercial, clean motion design. Locked-off camera,
> absolutely no camera movement. Flat vector illustration on a warm
> off-white paper background with no desk, table or horizon — only paper. An
> illustrated beige computer keyboard lies flat, low in the frame, with a
> soft shadow beneath it, exactly as the first frame. Hold on it for a short
> beat.
>
> Then, in one continuous elastic motion, the rear half of the keyboard turns
> liquid and springs upward: the beige surface behind the keys bulges,
> stretches and snaps up into a wobbling beige blob, elastic like thick
> jelly, overshooting, jiggling and squashing as it rises. While it is still
> wobbling it begins to become the monitor, and this becoming is the long
> part of the clip — it takes clearly more time than the rise: the blob
> stretches wider and squarer little by little, its corners push out of the
> curve with springy overshoots, the dark bezel emerges around a black
> rectangular screen that grows on its front step by step, the edges
> straighten gradually, a short pedestal pops out beneath it, and only at
> the very end does it settle, with one last elastic bounce, into a beige
> retro CRT monitor standing directly above the keyboard. The monitor shape
> is readable well before the end and keeps refining right up to the last
> frame — never snapped into place in the final moment. Springy and alive
> throughout, never linear, never frozen. The blob and the monitor are matte
> beige, exactly the case colour, with one soft highlight, no chrome, no
> metal, no reflections. The keys in the front rows stay exactly where they
> are. The screen is a flat black rectangle from the moment it appears; it
> never lights up. It ends as the finished illustrated computer, perfectly
> still, exactly matching the last frame. Flat colours, thin ink outlines,
> three simple light levels, no text, no cuts.

#### Clip B — draft 4 prompt (if B3 still *replaces* the blob with a monitor)

> Premium product commercial, clean motion design. Locked-off camera,
> absolutely no camera movement. Flat vector illustration on a warm
> off-white paper background with no desk, table or horizon — only paper. An
> illustrated beige computer keyboard lies flat, low in the frame, with a
> soft shadow beneath it, exactly as the first frame. Hold on it for a short
> beat.
>
> Then the rear half of the keyboard turns liquid and springs upward into a
> wobbling beige blob, elastic like thick jelly, overshooting and squashing
> as it rises. What follows is a TRUE MORPH of that one piece of material:
> the blob is sculpted into the monitor the way clay is shaped by unseen
> hands. Its outline never breaks and never fades — the same continuous
> surface is pushed and pulled: its top and sides flatten and square off
> while the surface still wobbles, a rectangular depression is pressed into
> its front and deepens, the floor of that depression darkens into the
> black screen while the raised rim around it becomes the dark bezel, a
> stub of the same beige mass is drawn downward to form the pedestal, and
> the edges straighten last. There is no cut, no dissolve, no crossfade and
> no second object: at every instant there is exactly one shape on screen,
> continuously deforming from blob to monitor, and the shaping takes clearly
> longer than the rise. It settles with one final elastic bounce into a
> beige retro CRT monitor standing directly above the keyboard. Springy and
> alive throughout, never linear, never frozen. Matte beige, exactly the
> case colour, one soft highlight, no chrome, no metal, no reflections. The
> keys in the front rows stay exactly where they are. The screen is a flat
> black rectangle from the moment the depression darkens; it never lights
> up. It ends as the finished illustrated computer, perfectly still, exactly
> matching the last frame. Flat colours, thin ink outlines, three simple
> light levels, no text, no cuts.

**Accept if:** the front keys never move; the rear of the keyboard visibly
liquefies and gathers into a sphere (a real intermediate shape, not a
crossfade); the sphere reshapes into the monitor rather than the monitor
fading in over it; the screen is black from the moment it exists; the final
frame matches M closely enough that the cut is invisible.

**Likely failures → fix:**
- *Monitor fades in / sphere skipped* → add: "There is no fading anywhere.
  The sphere must fully form before anything monitor-shaped exists, and the
  monitor is made out of the sphere's material."
- *Sphere goes chrome/metallic* → add: "The sphere is matte beige paper
  colour, exactly the case colour, with a single soft highlight."
- *Screen lights up / shows content* → add: "The screen is a flat black
  rectangle for the entire clip."
- *Ends slightly off M* → this is the seam that matters; if it is close but
  soft, a 6-frame crossfade to M on the page hides it. If it is wrong, try
  `minimax_h3` with `batch_size: 4` and pick.

## 5 · The startup sound

The classic Mac startup chime is a **registered Apple trademark** (US, 2012)
as well as copyrighted audio, and this site is public. Do not use it. Two
honest options, both synthesised in the site's existing WebAudio layer
(`src/data/keySound.ts`), so nothing is downloaded:

1. **Apple ][-correct:** the machine itself booted with a single short
   speaker beep (~1 kHz, ~100 ms). Period-accurate for the illustration,
   free, and the CRT bloom does the emotional work.
2. **In the spirit:** an original chord swell — a bright major triad with a
   slow attack, ~1.2 s, no melody borrowed. Evocative, safe.

**Decided: (1), the Apple ][ beep.** Gated on the site's existing sound
toggle.

## 6 · Page integration (after the clips exist)

- `useSectionNav`'s `gate(from, to)` holds the move for `1 → 2`. A full-screen
  `<video muted playsinline>` overlay plays Clip A then Clip B (or one
  concatenated file — ffmpeg is on this machine); on `ended`, snap to the
  machine section with its CRT **off**, drop the overlay, then chime and
  power the CRT on (CSS: 1px bright line → vertical bloom → phosphor settles
  → boot menu types in).
- **Reverse (`2 → 1`):** the same footage reversed (ffmpeg), which ends on
  frame K — and K is now the section's resting state when entered from below
  (the intro-skip work). Seamless by construction.
- Plays on **every** traversal, both directions (reversed footage going
  up). A page-wide **transitions on/off** toggle sits beside the sound
  toggle in the nav; off = the current hard cut. Remembered in memory for
  the session, like sound.
- Desktop only, `object-fit: cover`; hard cut under `prefers-reduced-motion`
  and below 720 px, regardless of the toggle.
- Preload the next clip when a section becomes active, not on page load.

## 7 · Budget

Two clips, both double-pinned. Drafts run at 720p `fast` (cheaper) until a
prompt is accepted; then exactly one 1080p `std` render per clip. Expect
**2–4 drafts for A** (the wipe is the uncertain beat) and **1–2 for B**, plus
the two finals. Preflight every submission with `get_cost: true` and report
the number; stop and check in at the agreed credit cap (§0).

## 7½ · Wired (2026-08-26)

Both drafts are live on localhost so the transition can be judged in place:
`public/transitions/kb-machine.mp4` (A1+B1 joined, 10.1 s, 1.08 MB) and
`kb-machine-rev.mp4` (reversed). `src/lib/transitions.ts` holds the page-wide
switch (nav "Motion on/off") and the play conditions; `TransitionPlayer.tsx`
is the full-screen overlay; App's `gate` plays forward on 1→2 and reversed on
2→1, then holds the last frame until the landed section has painted.
On 1→2 the machine section boots: dark glass → Apple ][ beep → CRT bloom →
boot menu types in → chrome fades back (RagSection `boot` prop). Swapping in
the finals later is a file replacement.

**Seams, after Brian's in-place review (2026-08-26):**
- *Cut-in shift* — two causes. The clip's first frame drifts from K (board
  ~7% smaller, 21 px right); fixed in post with a 0.3 s zoom-match on the
  first frames plus a K-still bookend. And the board's pointer parallax
  changes its pose; fixed by `src/lib/boardFreeze.ts` — the gate freezes the
  lean, waits 380 ms for the board to return to neutral, then plays. K must
  therefore be captured in the neutral pose (`?frame=kb`).
- *Cut-out shift* — not the clip: the page laid the machine out ~20% larger
  than a cover-scaled 16:9 clip at 1800×1042. Fixed by placing the machine
  where the cover-scaled 2560×1440 reference puts it (Apple2Front, `REF`),
  so page and clip coincide at any viewport ≥720 px.
- *Cut-in, fourth look (2026-08-26, latest)* — Brian still saw a change at
  the trigger. Measured: BT.601/709 matrix mismatch is only ~2 levels (not
  it). Remaining cause is sharpness on a Retina display: the WebGL board
  renders at 1.75× DPR, the clip is upscaled video, and the swap happened on
  a STILL. Fixes: the overlay is now revealed 380 ms into playback, while
  the red line is already sweeping (`TransitionPlayer` REVEAL_AT_MS) — the
  live page stays up under the identical opening frames, and the sharpness
  change lands under motion; master rebuilt at 1920×1080, lanczos, tagged
  BT.709 (`kb-machine.mp4?v=8`, 2.5 MB). Then refined: A3 trimmed at 0.20 s (the line enters at ~0.33 s, so its entry is IN the clip) and the overlay reveal keyed to clip time 0.22 s via rAF, so the fade-in begins exactly as the line touches the right edge (`?v=9`).
- *Cut-in, the third look (2026-08-26, latest)* — geometry was exact, yet a
  jump remained. Two causes: the overlay covered the nav, dots, section label
  and note, so they vanished at the cut while the clip has none; and on a
  DPR-2 display the WebGL board is far sharper than a 720p clip, so identical
  pixels still read as a cut. Fixes: nav and dots now sit ABOVE the clip and
  persist (and are no longer hidden during the machine's boot); the keyboard
  section's own text fades out 220 ms before the clip; the overlay dissolves
  in over 0.4 s under the entering red line, so sharpness changes gradually.
- *Cut-in, resolved (2026-08-26, later)* — pointer parallax removed outright
  (`Keyboard3D`); K recaptured in the neutral pose (`?frame=kb`); the board
  now renders on a 16:9 surface that covers the viewport (`.panel--void .kb`,
  ≥720 px), so its framing is aspect-independent. Image correlation of the
  live 1800×1042 frame against the cover-mapped K: scale 1.000, shift 0/0,
  mean diff 0.15/255 — **pixel-identical**. The only remaining cut-in
  mismatch is inside clip A: its opening frames were generated from the OLD
  (leaned) K. A must be regenerated from the neutral K.
- *Length* — holds trimmed, footage at 1.55×: ~4.6 s total.
- *Frame rate* — 24 fps sped up looked choppy; motion-interpolated to 60 fps
  at UPSCALE time by the model, not by `minterpolate` in post - see §9.

## 8 · Generation log

| When | Clip | Settings | Cost | Job | Result |
|---|---|---|---|---|---|
| 2026-08-26 | A draft 1 | seedance_2_0 · 720p fast · 5 s · K→F | 17.5 | `ddda7b34-b9ea-4307-874f-c40752b8a516` | **Wipe: excellent** (crisp red `/`, hard edge, restyle behind it, board holds pose). End frame ≈ F (close, crossfade-safe). **Fall: the drop is a jump** — tilted board cuts to flat between two frames; the corner-rock settle after it IS there. Start frame drifts a little from K (board slightly smaller/left, faint light pool). `public/transitions/drafts/A1.mp4` |
| 2026-08-26 | B draft 1 | seedance_2_0 · 720p fast · 5 s · F→M | 17.5 | `34671d34-f6df-42cf-83dc-92e66a933e41` | **On brief first try**: rear liquefies → bulge → sphere resting on the case → squares off, screen resolves → finished machine by ~3 s, holds. End frame ≈ M (near pixel match). Sphere has soft 3D shading rather than flat — reads fine. `public/transitions/drafts/B1.mp4` |

| 2026-08-26 | — | Brian: hold a little longer on the finished machine at the end of B → end bookend (M still) extended to 0.95 s in the master. |  |  |  |
| 2026-08-26 | — | Brian, on B2: the blob doesn't MORPH into the monitor, it gets replaced by it → B draft-4 prompt written (one continuous surface, screen pressed in as a depression, no second object). Held until B3 is seen. |  |  |  |
| 2026-08-26 | B draft 3 | seedance_2_0 · 720p fast · 5 s · F→M, elastic + longer formation | 0 | `e8c27b02-aea6-4c08-b2e9-64e88b27f799` | **REJECTED by moderation** (false positive, not billed). Superseded by B draft 4 (true morph). |
| 2026-08-26 | B draft 4 | seedance_2_0 · 720p fast · 5 s · F→M, TRUE MORPH prompt (one surface, screen pressed in, longer formation) | 17.5 | `23298ee5-ebe7-43d3-8915-f45868b0b837` | pending |
| 2026-08-26 | A draft 3 | seedance_2_0 · 720p fast · 5 s · neutral K→F, refs [F, tilted case], the wipe yields the MACHINE's keyboard, razor-thin line | 17.5 | `bc434925-5250-4d0d-ab2a-442002f6a583` | **Accepted in principle**: behind the line the board becomes the machine's slim case + 4-row blank band; line thinner; continuous tumble; first frame = neutral K (580×520 @ 650,338), last ≈ F. Wired as `drafts/A3.mp4` (trimmed from 0.5 s). |
| 2026-08-26 | — | A2/B2 review (Brian): behind the wipe the board must become the MACHINE's keyboard (slim case, 4-row band), not the same layout recoloured → prompt A draft 3 + F/tilted-case references. B2 wobbles too long and forms the monitor in the last 0.5 s → prompt B draft 3 with explicit thirds; on-page B2 re-timed in post — Brian: wobble timing is FINE, only the formation should be longer → wobble at the normal 1.55×, formation slowed to 0.9×. |  |  |  |
| 2026-08-26 | — | B1 in place: morph reads linear and PAUSES at the sphere; Brian wants elastic, continuous, springy (prompt B draft 2 rewritten above). The static sphere hold is cut out in post for the demo. |  |  |  |
| 2026-08-26 | — | Brian's review of A1/B1 in place: keys must be BLANK behind the wipe (A1 still draws legends); the cut-in shift was visible (fixed in post with K/M bookends); total too long (fixed in post: ~5.3 s); no beep, no lamp click. A draft 2 prompt rewritten (blank keys) — **awaiting go**. | | | |

| 2026-08-26 | — | Page-side cut-in verified pixel-exact (see §7½). Neutral K re-uploaded for A draft 2. Pending Brian's go: A2 (neutral K, blank keys), B2 (elastic, no pause). |  |  |  |

| 2026-08-26 | A draft 2 | seedance_2_0 · 720p fast · 5 s · neutral K→F, BLANK keys prompt | 17.5? | `3c67034d-3f4e-41a3-835d-466aa52c15fd` | **REJECTED by Higgsfield moderation ("nsfw")** — false positive on a keyboard; not billed. Resubmitted unchanged as `93a850f6-b809-495a-b0cb-602c881cefab` → **rendered**: first frame matches the neutral K (board 579×520 @ (650,337) vs 581×531 @ (650,334)); cut-in seam gone. Wired as `drafts/A2.mp4`. Blank-keys check: see sheet review. |
| 2026-08-26 | B draft 2 | seedance_2_0 · 720p fast · 5 s · F→M, elastic/no-pause prompt | 17.5 | `ba10d617-d53b-4da3-a7a3-6cb609e6bc12` | **Elastic and continuous**: wobbling jelly blob, no static sphere, corners overshoot, settles ~3.2 s. Wired into the on-page clip (`drafts/B2.mp4`). |

Preflight (2026-08-26): draft 17.5 credits, final (1080p std, 5 s) 45 credits.
Running total: **105 / 200** — six drafts billed (A1, B1, B2, A2′, A3, B4); balance 1,057. On-page clip = A3 + B4 (B at 1.4×, end hold 0.95 s). Tilted-case reference media id `ca231e08-6030-41e0-b685-079c0f7a3ace`. On-page clip = A2 + B2 with K/M bookends, no zoom-match needed. Neutral K media id `eb54ea15-abbd-4dd8-81dd-e7552699e214`. Media IDs — K `1bed5b49-0a4c-417a-af92-4a0f39b24225`,
F `44579540-00e1-461c-9a19-9be5b653c74b`, M `8a9ba7d3-0d3c-451c-bdf5-3cfa3e8e3f65`,
black `f601a509-4c30-40be-bbc1-8ce776baf95b`.


## 9 · The seam, finally diagnosed (2026-08-26)

Six rounds of "there's still a shift" turned out to be three separate
defects. Two were mine, in post. Only the third was Higgsfield's, and it
did not need a re-roll either.

### 9.1 The wipe line was dying — `minterpolate`

Brian: *"the frame gen freaks out on the filter line and it like dies."*
Correct. Extracting consecutive frames from the v13 master across the red
`/` shows a clean crisp line on some frames and a doubled, smeared, ghosted
one on the frames in between. Those are exactly the frames `minterpolate`
invented. It is block-based motion estimation: a thin, fast, high-contrast
line gives it no stable correspondence, so it blends two positions.

**Fix:** stop synthesising frames in post. ByteDance's upscaler outputs
native 60 fps with model-based interpolation. Every frame of the line is
clean. **0.2 credits.**

### 9.2 The shift — a dissolve over the model's opening settle

The v13 master opened with a 0.3 s K still, then cross-dissolved 0.2 s into
clip A. Clip A's first ~0.2 s is the model's opening settle, where the board
moves ~6 px. Dissolving a STATIC board into a MOVING one draws both at once:
a ghosted double board sliding left. That is the shift Brian kept reporting,
and it is why it always read as horizontal - the ghost separates diagonally.

The bookend existed to hide a cut-in mismatch that no longer exists (the
page-side geometry has been pixel-exact since §7½). It was fixing a solved
problem and causing a worse one.

**Fix:** no head still, no head crossfade. The master starts hard on A's
frame 0.

### 9.3 What was actually Higgsfield's — and why it still needs no re-roll

Measured against `public/shots/transition-kb-start.png` by SAD correlation
over scale and translation, clip A's frame 0 is:

| | value |
|---|---|
| horizontal offset | **0 px** — never was a left shift |
| vertical offset | **+6 px** at 1080p (board sits lower) |
| scale | **~1%** smaller |
| residual after correction | texture only, not displacement |

So Brian's instinct was right: the plate we gave Higgsfield was not
reproduced exactly. But a 1% scale and 6 px offset is a *correction*, not a
re-roll. `TransitionPlayer` applies `scale(1.0101) translateY(-0.556%)` at
the cut and ramps it off over 0.55 s, easing slow-then-fast so the give-back
happens under the tumble rather than during the settle. Reverse ramps the
same correction IN over its final 0.55 s (`seamAtEnd`), since that clip ends
on the keyboard. Both directions now correlate at dx=0, dy=0.

Correcting the whole clip instead would drag its END out of register with
clip B and with the machine's landing position - hence the ramp.

### 9.4 On the UI in the start plate

Brian also observed the plate had no page chrome. That is true, and worth
doing if clip A is ever regenerated for other reasons: the section text
("WHAT I WORK IN", "HOVER A KEY", the caption) currently pops off at the cut
instead of being erased by the wipe, which is a missed beat. It is NOT the
cause of the misalignment, though - the misalignment is §9.3, and it is
fixed without spending anything.

### 9.5 Enhancement, not regeneration

Re-rolling is a dice roll: seedance is stochastic, so the same prompt and the
same start/end frames produce a different take. B4 was the fourth attempt at
that morph; its motion is not reproducible on demand. Upscaling preserves it.

| pass | provider | result | cost |
|---|---|---|---|
| B4 → 1080p | Topaz (`prob-4`) | 1920×1080, still 24 fps | 3 |
| B4 → 1080p60 | **ByteDance** (`aigc`) | 1920×1080 **60 fps**, sharper | **0.2** |
| A3 → 1080p60 | **ByteDance** (`aigc`) | 1920×1080 **60 fps**, clean line | **0.2** |

ByteDance beat Topaz on sharpness, gave native 60 fps, and cost 15× less.
Both masters are now built from `drafts/*-bd60.mp4`.

Build is reproducible: **`scripts/build-transition.sh`** (was ad-hoc
commands). Clip cache version → `14`.

**Spent on this pass: 3.4 credits.** One 1080p re-roll would have been 45,
with no guarantee of matching motion.


## 10 · Both interpolators fail — ship no synthesized frames (2026-08-26)

v14 shipped ByteDance's 60 fps interpolation. Brian: *"post filter the beige
keys are like literally moving and glitching."* Confirmed by frame tiling:
on the invented frames, whole rows of keycaps smear into a continuous
ribbon and lose their outlines.

It is the same aperture problem as the wipe line, inverted. A row of
near-identical keycaps is a PERIODIC texture, so the interpolator cannot
decide which key moved where and blends across them.

| | thin red wipe line | beige key rows |
|---|---|---|
| ffmpeg `minterpolate` | **destroys** (doubles, smears) | survives |
| ByteDance 60 fps | survives | **destroys** (smears to ribbon) |
| no interpolation | survives | survives |

**Every frame we ship is now a frame the model actually drew.** Drafts are
upscaled spatially only (`fps: 24`, the source rate) and the 60 fps
container is reached with ffmpeg `fps=60`, which duplicates and never
blends. Sources: `drafts/A3-up.mp4`, `drafts/B4-up24.mp4`.

Consequence to watch: motion now carries 37.2 unique frames/s in clip A
(24 fps sped 1.55x) and 31.2 in clip B, duplicated up to 60. If that reads
as choppy, the fix is to trade pace for cadence - at 1.25x speed the source
lands on exactly 30 unique fps, which duplicates to 60 perfectly evenly,
at the cost of ~0.8 s more runtime. Do NOT reach for an interpolator again.

### 10.1 The seam ramp was itself the remaining shift

Brian on v14: *"there's still a shift. its a lot smaller, but its still
there."* Expected in hindsight - the correction is motion. Unwinding 6 px
over 0.55 s is ~11 px/s, plainly visible: it converted one instantaneous
6 px jump into a short visible drift. Stretched to **2.2 s linear** it
unwinds at ~2.7 px/s, under the threshold for spotting drift on a subject
that is tumbling behind a wipe. Linear on purpose: any easing curve puts a
fast segment somewhere, and the fast segment is the thing being avoided.

Re-measured against the new spatial-only upscale, the optimum is unchanged:
**scale 1.0101, dy 6, dx 0**. Clip cache version -> `15`.

Spend across the whole investigation: **~3.6 credits**, no re-rolls.


## 11 · Cadence: why 1.25x, not 1.55x (2026-08-26)

v15 removed interpolation and fixed the glitching keys, but Brian: *"it
ruined the transition on both ends. The finishing transitioning into the rag
used to be seamless. now theres a shift too."*

Measured, not guessed. Mean absolute inter-frame difference over the tail:

| | duplicated frames | motion per frame |
|---|---|---|
| v13 (minterpolate) | 0 / 95 | even, ~0.15-0.35 |
| v15 (no interp, 1.55x) | **46 / 95** | alternating 0.01 / 0.65, irregular |

That is judder, and it is worst where motion is SLOWEST - which is exactly
both ends, the opening settle and the settle into the machine. v13's end
felt seamless because minterpolate was smoothing it; minterpolate only ever
broke the thin red line, never the machine.

The cause is arithmetic. With no synthesis the only thing that governs
smoothness is whether the unique frame rate divides the container rate:

    unique fps = 24 (draft rate) x speed

    1.55x -> 37.2 fps  ->  60/37.2 = 1.61   irregular: hold 1 refresh, hold
                                            2, no fixed pattern -> freeze,
                                            then leap twice as far
    1.25x -> 30.0 fps  ->  60/30   = 2      exact; 120/30 = 4 exact

Divisors of 60 at or above the draft rate are 30 and 60, so the only two
even speeds are **1.25x** and 2.5x. 2.5x is far faster than anything
approved, so 1.25x. Verified after rebuild: the held-frame pattern at both
ends is a strict `M.M.M.M...` alternation - ordinary 30 fps video, even on
60 Hz and on 120 Hz ProMotion.

**Cost: clip A runs 4.0 s instead of 3.23 s and the master is 8.35 s instead
of 7.43 s.** That is a real change to a pace Brian approved at 1.55x, and it
is the price of shipping no invented frames. B is effectively unchanged
(1.3 -> 1.25). If the extra ~0.9 s is unacceptable the honest options are to
take 2.5x (much faster, perfectly smooth) or to accept judder - there is no
setting that is simultaneously 1.55x, artifact-free and even.

### 11.1 Also removed: layer promotion on the clip

`will-change: transform` and `backface-visibility: hidden` were added to
`.transition video` in v14 to smooth the seam ramp. They force the video onto
its own composited layer for the clip's entire life, which changes how it
rasterises against the live DOM underneath - unwanted at a landing that has
to match the page exactly. Only `transform-origin` remains.

### 11.2 Seams re-verified after the speed change

| seam | result |
|---|---|
| head, corrected, vs live board | 6.50, best at **dx=0 dy=0** |
| tail vs machine plate | 0.71, best at **dx=0 dy=0** |
| reverse landing vs live board | 6.48, best at **dx=0 dy=0** |

Clip cache version -> `16`.


## 12 · Is the page loading behind the clip? (2026-08-26)

Brian asked whether the site loads while the video plays or waits for it.
Measured in the browser, not reasoned about:

* **All five panels are in the DOM from first paint.** No lazy mount, no
  Suspense, no `display:none` - every `.panel` is a laid-out `100svh` box.
  The machine section is measured and positioned before the clip ever runs.
* **The machine never moves during the clip or the landing.** Sampling
  `.a2m__stage` every frame across a whole transition: constant
  `matrix(1.037, 0, 0, 1.037, 417, 77.8)` from t=5 ms through the landing
  and the overlay fade. So the landing is not a layout race.
* The gated landing is instant (`setIndex` + `scrollTo`), not an animated
  scroll, so nothing glides underneath the overlay.
* The seam ramp behaves: computed transform decays from
  `matrix(1.0101, ..., -5.79)` to `none` over exactly 2.2 s, and is `none`
  at the tail. Reverse ramps IN starting at vTime 6.16 (= 8.35 - 2.2).

Also disproved: the reveal fires at clip time ~0.07 s (rAF granularity), not
the nominal 0.05 s. That was suspected of landing on the wrong frame, but the
board's offset is **constant at dy=8 across the whole opening 0.2 s** - there
is no opening settle in this build to land on the wrong side of. (The
"settle" seen in v13 was the crossfade ghosting of s9.2, not model motion.)
A difference map of the corrected first frame is black apart from faint
keycap outlines: alignment is as good as it gets without a re-roll, and the
residual is anti-aliasing, not displacement.

### 12.1 What background loading CAN do - now prevented

The one real hazard behind Brian's question: `scheduleAutoPreload()` kicks
the Qwen3 preload from `requestIdleCallback(..., {timeout: 8000})`, so the
~400 MB weight download and the WebGPU shader compile typically land within
the first few seconds - often exactly when a visitor reaches the keyboard and
triggers the clip. That contends with video decode and the compositor, drops
clip frames, and dropped frames in a clip meant to line up with the live page
read as a jump. It is invisible under `?rag=off`, which is how every
screenshot and Playwright run here is taken.

`preload()` now refuses to start while a clip is on screen and retries 600 ms
later (`isClipBusy()` in `lib/transitions.ts`, raised by `TransitionPlayer`
for the length of every clip). It is deliberately not cached in
`enginePromise` - a deferral is "not yet", not "no" - and a visitor's own
click (`force`) still starts it immediately.


## 13 · Verification pass (2026-08-26)

Measured on the running site at 1600x900, using the `?frame=` debug plates so
page chrome does not pollute the comparison. Screenshots are of the REAL
composited page - live WebGL board / live SVG machine against the clip
overlay in exactly the state the player puts it in at the cut.

| check | method | result |
|---|---|---|
| head seam | screenshot live board vs clip frame 0 with the reveal transform applied, SAD over +/-6 px | **best fit dx=0 dy=0** (6.32); no sub-pixel improvement exists |
| tail seam | screenshot live machine vs the clip's held last frame | **best fit dx=0 dy=0** (3.15) |
| difference maps | amplified blend=difference on both pairs | head: faint keycap outlines only. tail: essentially black |
| machine stability | sampled `.a2m__stage` every frame across a whole transition | constant `matrix(1.037,0,0,1.037,417,77.8)`, t=5 ms -> landing |
| seam ramp (forward) | computed transform trace | decays `matrix(1.0101,...,-5.79)` -> `none` over exactly 2.2 s; `none` at the tail |
| seam ramp (reverse) | computed transform trace | ramps IN from vTime 6.16 (= 8.35 - 2.2), reaches full correction, lands on the board |
| cadence, moving footage | inter-frame diff on the built files | strict `M.M.M.M` 2:2 alternation, both directions |
| cadence, crossfade | same | 13 consecutive changing frames = the 0.2 s dissolve at 60 fps (correct, it is a dissolve) |
| cadence, holds | same | static, as intended (0.95 s machine hold) |
| preload deferral | engine genuinely `idle`, called `preload(false)` 1.5 s into a clip | refused: returned null, phase stayed `idle`; after the clip the 600 ms retry fired and reached `ready` |

### 13.1 What could NOT be verified here

**On-screen smoothness.** Headless Chrome has no real compositor:
`getVideoPlaybackQuality()` returns 0 total / 0 dropped, and
`requestVideoFrameCallback` never fires. So judder - the exact symptom being
chased - can only be confirmed by a human watching on real hardware. Every
cadence claim above is measured from the FILE, which is necessary but not
sufficient.

An earlier probe of the preload guard was also hollow and had to be redone:
the test page had lost its `?rag=off` query, so the model was already loaded
and `preload()` returned at its first line, never reaching the guard. The
re-run above starts from a genuinely `idle` engine.


## 14 · Faster, untrimmed (2026-08-26)

Brian: make the whole thing faster, especially clip A; then clip B too; and
*"shorten the clip by speeding it up. DO NOT clip off portions because thats
how we end up with misalignments."*

**Both clips now run at 2.5x and nothing is trimmed.**

2.5x is not an arbitrary choice - it is the only speed above 1.25x that keeps
the cadence even (see s11). At 2.5x the 24 fps drafts land on exactly 60
unique fps, so every source frame becomes its own frame in the 60 fps
container: **zero duplication, the smoothest setting available.** Verified:
0 duplicated frames in clip A and 0 in clip B.

| | before | now |
|---|---|---|
| clip A | 4.03 s | **2.02 s** |
| clip B | 3.70 s | **2.02 s** |
| master total | 8.35 s | **4.52 s** |
| duplicated frames | 2:2 throughout | **none, anywhere** |

### 14.1 Trimming removed

`B_TRIM=4.62` was still cutting 0.42 s off clip B. Measured before removing
it: clip B is **still moving ~0.3/frame all the way to its final frame** at
5.04 s, so that trim stopped live motion dead and dissolved to a static
plate. Brian's instruction was right on the evidence. Both drafts are now
used whole, and the build probes their real durations with `ffprobe` rather
than trusting a constant that can drift out of step with the files.

The appended still (`TAIL`) was shortened to compensate - that is OUR plate,
not generated footage, so shortening it removes nothing the model drew, and
the machine is still held for the ~0.95 s Brian asked for once clip B's own
restored tail is counted.

Seams re-verified after all of it: head **dx=0 dy=0**, tail **dx=0 dy=0**,
reverse landing **dx=0 dy=0**. Clip cache version -> `18`.

## 15 · Continuity: the chin must not light up

Brian: *"in the higgsfield video, the FU][ portion of the monitor is black,
but in the actual section, it turns green with the monitor."*

Real bug, in `Apple2Front.tsx`. The CRT glow was painted as

    <rect x=85 y=52 width=530 height=388 fill="url(#a2mGlow)" />

which is the whole bezel, y 52..440 - and the chin with the rainbow badge and
the `FU ][` nameplate sits at y 411..433, inside it. Worse, `a2mGlow` runs
bottom-to-top from 0.16 to 0.03 opacity, so its **brightest** green landed
squarely on the chin. The clip keeps that chin black/grey throughout, so the
live section and the footage disagreed the moment the machine woke.

Fixed by bounding the glow to the glass (the inner bezel: `SCR` inset by 6,
ending at y=408, above the chin at y=411). Verified by screenshotting the
machine screen-off and screen-on and averaging the chin band strictly below
the glow's bottom edge:

    screen OFF : R=108.9 G=98.2 B=78.2   G-R = -10.63
    screen ON  : R=108.9 G=98.2 B=78.2   G-R = -10.63
    difference : 0.000

The chin is now pixel-identical lit and unlit. (A first measurement showed a
2.66 residual; the crop had caught 5.6 px of the glow's bottom edge. The glow
ends at page y 625.6 and the nameplate starts at 633.8.)


## 16 · The real cause of the shift: the plate was rendered wrong (2026-08-26)

Brian, after v18: *"theres still a shift on the keyboard when animation
starts"* - and then the instruction that cracked it: *"resort to real
screenshots from the real rendered frontend, what a human would see, rather
than just auditing code."*

He was right, and every previous verification in this document was measuring
the wrong thing. **They all compared the clip to
`public/shots/transition-kb-start.png`. They should have compared it to the
live page.**

In `?frame=kb` - the mode the plate was captured in - the R3F canvas does NOT
fill its container. It sits TOP-LEFT ANCHORED at 98.4% of it:

    normal browsing   container 1852.4x1042   canvas 1852.4x1042   fills
    ?frame=kb         container 1852.4x1042   canvas 1822.9x1025.4  98.4%, top-left

(Normal mode verified stable over 9 s; `is-framing-kb` only sets
`visibility:hidden`, which cannot do this - it is the canvas sizing.)

So the plate had the whole scene drawn ~1.6% small and pushed up-left, the
Higgsfield clip inherited that, and the seam correction derived from the
plate agreed with the plate and was wrong about the page.

Measured from real screenshots, live board vs clip frame 0 at 1800x1042:

| correction | dx | dy | width ratio | height ratio |
|---|---|---|---|---|
| none | +15.78 | +3.36 | 1.0196 | 1.0363 |
| uniform 1.0162 about frame top-left | +0.50 | -0.39 | 1.0013 | 1.0195 |
| **1.0162 x / 1.0360 y** | **+0.39** | **+0.02** | **1.0013** | **1.0000** |

The scale is about the frame's TOP-LEFT because that is where the shrunken
canvas was anchored; since both the canvas and the video are cover-mapped
into the same 16:9 box, that makes the correction viewport-independent
(`coverOrigin()` computes the anchor at run time).

Y needs more than X because two errors stack there: the same 1.62% canvas
shrink PLUS the model drawing the board ~2% shorter than the page does.
Correcting them separately is a 2% vertical stretch, invisible on this
content. Brian confirmed: *"the position lines up now"*.

### 16.1 Lighting

What remained once position was fixed. Measured over the board area:

    mean luminance     live 29.61   clip 27.69   (clip ~7% darker)
    brightest bucket   live  1.21%  clip  0.40%  of pixels

`brightness(1.07)` restores both (29.57, 1.20%), ramped off with the geometry
for the same reason - correcting the whole clip would push the machine at the
end too bright for the section it lands on.

### 16.2 Background black, and a fix deliberately NOT applied

The page paints `#050505`; Higgsfield returned pure black. Traced through the
pipeline by measurement - plate 5/5/5, Higgsfield draft 0/0/0, upscale 0/2/0,
master 0/2/0 - so the crush happened in generation, not in post. The build
now lifts the black point back to 5/255 (and maps green from its own 2/255
floor so the result is neutral).

Chrome still COMPOSITES video darker than DOM: the file is 5,5,5 and the
browser decodes it as 5.00 (canvas readback), but it renders at ~1 next to a
page painted 5. Retagging the transfer as sRGB changed nothing. Pre-distorting
was tried and rejected: file 0 -> composites 0, file 5 -> 1, file 14 -> 11 -
erratic rather than a curve worth inverting, and anything tuned here would be
tuned to one browser on one display. The file is left correct-by-construction.
**Do not "fix" this by pre-lifting the black again.**

### 16.3 Lesson

`?frame=` plates are NOT a substitute for the live page. They hide chrome
with `visibility`, but the keyboard canvas sizes differently in them. Any
future seam work must measure against a real screenshot of normal browsing.


## 17 · Sharpened, not regenerated (2026-08-26)

Brian asked for a native higher-resolution final (4K, 220 credits, no retry
budget). Before spending it, the approved drafts were re-upscaled to true 4K
as insurance - **0.4 credits each** - and that turned out to be the better
answer, at least until a native render proves otherwise.

| | |
|---|---|
| `A3-4k.mp4`, `B4-4k.mp4` | 3840x2160, 24 fps, 121 frames, ByteDance `aigc` |
| cost | 0.4 credits each |
| motion | **identical to the approved drafts** - no dice roll |

Why upscaling does so well here: the art is flat vector illustration - hard
ink edges, flat colour, no fine texture. That is the easiest possible case
for an upscaler, and the weakest case for native rendering to beat, because
there is almost no fine detail for the extra resolution to resolve.

**Artifact check** (Brian: *"Upscaling may face the same problem as the fps
booster with artifacts"*) - the danger is structurally absent: this is a
SPATIAL upscale at `fps: 24`, the drafts' own rate, so no frames are
synthesised and the smearing of s10 cannot occur. Verified anyway,
frame-by-frame at 4K: the red wipe line stays razor-thin and consistent, and
every keycap keeps its own crisp outline. Clean.

The master is now built from those 4K sources at **2560x1440**:

| master | size | with the reverse copy |
|---|---|---|
| 1080p | 3.6 MB | 7.2 MB |
| **1440p (shipped)** | **6.2 MB** | 12.4 MB |
| 4K | 16 MB | 32 MB |

4K doubles the weight again for a portfolio page; 1440p is 2.4x the pixels of
1080p at a carryable size. `scripts/build-transition.sh` takes `RES=1080|1440|
2160` and `SRC=4k|1080`.

Seam re-verified against a real screenshot of the live page at 1800x1042:
horizontal **dx=0**, ~2 px vertical residual, luminance ratio 0.9996. The
1080p and 4K upscales and the raw draft all correlate at dx=0 dy=0, so the
upscalers did not reframe anything and the seam constants carry over
unchanged.

Clip cache version -> `21`. **The 220-credit native 4K generation is NOT
spent** and remains available if this is judged insufficient. Plates for it
are ready: the `?frame=` capture bug is fixed (§17.1).

### 17.1 Plate capture, fixed

react-three-fiber sizes the `<canvas>` from its container once, inline, and
the canvas carries no class - `.kb__canvas { width:100% !important }` applies
to r3f's WRAPPER div, not the canvas - so a stale first measurement is never
corrected. In `?frame=kb` it settled at 1824.37x1026.21 inside a
1852.44x1042 container: the ~1.6% shrink of s16, baked into the plate.

`App.tsx` now re-fires `resize` until the canvas matches its container, then
sets `data-plate-ready="1"` for the capture script to wait on. Verified:
1852.38x1042 vs 1852.44x1042. One nudge was NOT enough (it landed mid-layout
at 1847.61); it retries.

A `?frame=kb-ui` mode was also added - board plus the section's own copy, but
without the nav/dots/cursor, which sit ABOVE the clip and must not be baked
in. It is unused for now: small text is where video models fail most, and a
garbled "WHAT I WORK IN" at the cut would be worse than the current pop.
Worth a 17.5-credit 720p draft before ever risking it on a final.


## 18 · The fullscreen layout bug (2026-08-26)

Brian: the board looked blurry, then *"theres a grey bar at the bottom"*, then
*"content is still going off the screens"*, and finally that the board looked
too big - *"needs to be the same size for animations etc to line up"*.

All one root cause. **macOS fullscreen keeps Chrome's toolbar and AUTO-HIDES
it**, so the viewport silently swings between two heights (measured on his
1800-wide window: 1169 with the toolbar hidden, 936 with it shown).
`initFrame()` only listened for `resize`, so `--frame-h` kept whichever height
it happened to catch. Because the keyboard renders on a 16:9 surface sized
`max(--frame-w, --frame-h * 16/9)`, a stale 1169 against a real 936 blows the
surface out to **2078** instead of 1800:

* the board renders ~15% too big (measured: +15.4% wide, +14.1% tall),
* the surface hangs 139 px off each edge,
* `.kb__caption` (`right: min(5vw, 3rem)`) measures from that off-screen edge
  and lands 91 px past the right of the screen - the clipped "HOVER A KEY",
* and the canvas is sized for a viewport that is not the one on screen, which
  is very likely the **blur** as well: the edge-width measurement implied an
  effective render scale near 1.27, a value nothing in the code produces.

### Fixes

1. **`ResizeObserver` on the root element** (`lib/transitions.ts`). An earlier
   attempt listened for `fullscreenchange` and sampled two frames later - far
   too early for macOS's ANIMATED fullscreen transition, and it never fires at
   all for the toolbar sliding in and out. The observer sees every change,
   including mid-animation. Events kept as belt-and-braces.
2. **`.panel` uses `100dvh`** with `100svh` as the fallback. `svh` is the
   viewport *with browser UI showing*; in fullscreen it left the panels short
   and exposed the light body background (`--bg #f3f1ed`) - the grey bar.
3. **`--frame-overhang-x`** is published alongside the frame vars, and the
   caption's `right` adds it, so it pins to the SCREEN edge rather than to the
   cover surface's edge.

The ~139 px overhang on `.kb` itself is intentional and stays: the board
renders on a 16:9 surface that covers the viewport so its framing matches the
clip at any window size.

### Verified

Nine viewport shapes (16:9, 16:10, 4:3, 21:9, portrait, short) plus six rapid
toolbar/fullscreen cycles - every one: cover surface exactly
`max(vw, vh*16/9)`, canvas fills it, caption on screen, panel shortfall 0,
document fills, surface centred, render scale 1.75.

Sharpness, measured on a true DPR-2 capture (3600x1872) as mean 10-90% edge
rise over the board:

| | mean edge |
|---|---|
| control (sharp, 2:05) | 2.42 px |
| regressed (4:07) | 3.34 px |
| **after these fixes** | **2.35 px** |

Transition re-verified at both viewport states: reveals at clip time 0.06,
seam `scale(1.0162, 1.036)` with dy -15.54 px at 1169 and -12.44 px at 936
(both 1.329% of frame height, so the correction scales correctly), brightness
1.07, plays the full 4.52 s, transform back to `none` at the end, lands.

### Also reverted here

The DPR 1.75 -> 2 and anisotropy 8 -> max changes from earlier today are OUT.
Neither could be justified: an A/B of `?aniso=1` vs `?aniso=8` measured
**-0.1%**, and the control already rendered at 1.75 so no value >= 1.75 could
be blurrier. `?dpr=` and `?aniso=` remain as debug knobs, inert unless used.


## 19 · Played at 2x on the element (2026-10-20)

Brian, back after a break: *"the scroll video transition from the keyboard
to RAG needs to be like 1.5-2x faster."*

**The master is untouched. `TransitionPlayer` sets `video.playbackRate = 2`
(`PLAYBACK_RATE`), so the 4.52 s clip plays in 2.26 s, both directions.**

Why 2 and not something in between: the same arithmetic as §11. The master
is 60 fps with every frame unique (§14), so the element at 2x presents 120
unique fps - a 60 Hz panel drops exactly every other frame and a 120 Hz
panel shows every one; either way the cadence is even. 1.5x would be 90 fps
on 60 Hz, a hold-1/hold-2 pattern, which is the judder §11 measured.

Why the element and not a rebuild: the footage keeps all of its frames, the
speed is one number to change, and nothing about the seam constants moves.
A rebuild at `A_SPEED=B_SPEED=5` would be the equivalent file (ffmpeg's
`fps=60` would drop the same alternate frames) and is still available if a
single-speed asset is ever wanted.

What had to follow the rate: the seam ramps (`SEAM_RAMP_S`, 1.8 s) are CSS
transitions in wall time but are armed in clip time (`currentTime`). Left
alone, the forward ramp would still be unwinding the keyboard correction
while clip B was already growing the monitor. Both ramp durations are now
`SEAM_RAMP_S / rate` wall seconds, so each covers the same 1.8 s of footage
it did before. The give-back therefore runs at ~6 px/s rather than ~3 px/s;
the board behind it is also moving twice as fast, so the ratio of
correction to motion is what it was. Not re-measured against screenshots -
if the head seam reads as a drift at 2x, that is the number to look at.

Everything else is already wall-time or clip-time correctly: the 12 s
play failsafe, `hide()`'s 300/420 ms, App's 220 ms `is-departing` lead-in
and 260/700 ms post-landing timers are all independent of the rate, and the
`hideBeforeEndS` check compares clip seconds to clip seconds.

No cache bump: the file did not change.


## 20 · The shift came back: scrollbars (2026-11-25)

Brian: "the shift is back... a very noticeable positional shift from the
video transition's final position and the actual position."

**Cause.** A classic scrollbar (Windows always; macOS whenever a mouse is
plugged in; Chrome, Firefox and Safari alike). The clip overlay is
`position: fixed; inset: 0`, which excludes the 15px bar; the machine was
placed from `window.innerWidth`, which includes it. Measured with a bar:
the clip's machine 7-8px left of the live one, plus 2px and a ~1% scale miss
on wide windows. Every earlier fix was measured on a machine with overlay
scrollbars, so none of them could see it.

**Fix.** `viewportFrame()` measures `documentElement.clientWidth/Height` -
the box the overlay fills - so placement agrees with the clip with or
without a bar. And the bar is hidden site-wide (index.css), since the site
moves by section. Either one alone fixes it; both together keep it fixed.

**Guard.** `npm run seam:check` plays the real clip headlessly at five
window setups, four with a scrollbar forced on, and fails past 1px. With the
old `innerWidth` line put back it fails 4 of 5 at exactly the reported
7-8px. Run it after touching anything in transitions.ts, Apple2Front's
placement, the keyboard surface, TransitionPlayer, or page-wide CSS.

## 21 · The way back, adaptive placement, and the live page baked in (2026-11-26)

**The way back was never checked.** Brian, on a 16:9 monitor: going up from
the machine there was "a slight shift". The reverse clip's held last frame
sat 2px below the live board at every 16:9 size. Only the forward seam had a
guard, and the board had moved since `SEAM_*` were measured. Now:

- **Placement follows the live board.** Keyboard3D projects the standing
  case through the live camera (`lib/boardState.ts`). TransitionPlayer's
  `seamTransform` fits the clip from the reference board (`N_REF`) onto
  that. In a test the board was moved 24px and scaled 4%, and the fit still
  landed at 0px (23px off with it disabled). The constants only describe the
  video file.
- **`seam:check` plays both directions** and checks luminance at both ends
  (4%), as well as position (1px).

**Two live-page bugs found on the way.**

- On 1440p and 4K screens the keyboard canvas measured itself mid-fade, so
  the board rendered 1.7% small. The cause was getBoundingClientRect
  counting the wrapper's `scale(0.98)` entrance. The canvas now uses
  `resize={{ offsetSize: true }}`. It is the same fault as §16's plate shrink.
- `.a2m__stage { will-change: transform }` froze the drawn machine's raster
  at a smaller scale. On the live page it was soft: edge energy 9.2, against
  15.4 without the hint.

**Colour, the real cause.** The clips carried no transfer tag:
build-transition.sh's `-color_trc` / `-color_primaries` never reach libx264.
So Chrome's `<video>` path guessed BT.709 and showed them with about 7% more
contrast than was encoded. A canvas `drawImage` of the same video does not
guess, which hid this from every pixel test.

| What was measured | Untagged / BT.709 | Tagged sRGB |
|---|---|---|
| Dark frame | encoded 16.4 shown 14.5 | shown as encoded (0.41/255) |
| Bright frame | encoded 210 shown 212 | shown as encoded |

Every brightness correction before this one, August's 1.07 and the CSS
grades below, was partly fighting that guess. Both encoders now tag
iec61966-2-1 through `-x264-params` (plus `setparams`), and the grades were
refitted in true sRGB. In true sRGB the generated keyboard frame is barely
off (b 1.038, c 1.002, s .979). The cream world really is darker and warmer:
its paper is ~6 levels under the page (b 1.084, c .882, s .988), and it
brightened visibly as the machine still faded in, a flicker the old clip had.

**Colour, as first measured (superseded).** The keyboard end's
`brightness(1.07)` (§16.1) had gone stale.
The board itself now came out brighter than live, so the boost pushed it 9%
over, and the machine end had no grade at all. Grades were fitted from
pixel-aligned screenshots:

| End | brightness | contrast | saturate |
|---|---|---|---|
| Keyboard | .960 | .968 | 1.066 |
| Machine | .932 | 1.141 | 1.065 |

These lived in CSS for one commit, then moved into the files (below).

**The live page, baked into the clip** (Brian: "use the real thing as much
as possible"; `scripts/bake-transition/`).

- **Rebuilding.** `frames.sh` rebuilds the master's frames uncompressed, with
  `build-transition.sh`'s own graph. They match the shipped file to about
  0.5/255.
- **References.** `capture.mjs` takes the live keyboard and the screen-off
  machine at 2560x1440, plus the machine-less page for the machine's matte.
- **`composite.py`, per frame:**
  - The keyboard is static until the wipe crosses it (frames 0-64). Wherever
    a pixel still equals frame 0 it becomes the live board, warped into the
    clip's own coordinates by the inverse seam fit. The wipe's faint glow is
    kept as a delta on top.
  - Inside the machine's matte, wherever the frame already equals the final
    frame, it becomes the live machine. That area is eroded away from
    anything still moving, so a settling edge is never doubled.
  - Everything generated is graded per world (the grades above), and its ink
    lines are tightened by a luminance-only unsharp mask (σ1.2, 0.6, skips
    flat areas).
- **What failed first.** Patching the PAPER failed: the generated paper and
  the live paper differ by gentle gradients, so any patchwork showed as
  blotches. The paper stays generated and graded. The colour is now in the
  pixels, so the player applies no filter.
- **Encoding.** `encode.sh` encodes once, with the shipped files' tags
  (BT.709 matrix, TV range, transfer and primaries unset). The clip version
  is now 23.

**Result** (1600x900, the seams as shown, no CSS filter):

| Seam | v22 + 1.07 | CSS grade | Baked + tagged |
|---|---|---|---|
| Forward cut, board | 13.84 | 9.37 | 3.25 |
| Forward cut, void | 3.38 | 1.67 | 0.29 |
| Forward start, live vs clip | ~5.4 | n/a | ~1.0, dx 0 dy 0 at 3 sizes |
| Machine case, mean RGB | ~5 levels off | ~1 | 0.2 |

`seam:check` luminance agrees to 0.1 at both ends. The remaining 3-4/255
mean error is the browser resampling 2560 down to the window, along edges,
with no bias. The clips also got smaller: 5.5 / 5.4 MB, against 6.5 / 6.4.

**Undo.** The originals are kept in `media/clips-v22-before-bake/` and
`media/stable-v22/`, which are identical. Copy them back to
`public/transitions/` and set `CLIP_VERSION` back to 22. Also restore the
CSS grade from commit 78d0af0.

**Re-bake** when the keyboard's or the machine's look changes, such as new
keys, lighting or colours. Their placement is followed live and needs no
re-bake.
