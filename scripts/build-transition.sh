#!/usr/bin/env bash
# NOTE (2026-11-26): this builds the UN-baked master. The shipped clips are
# baked afterwards (the live page at both ends, the middle graded) with
# scripts/bake-transition/ - run that after this (see its README). Colour tags go
# through -x264-params: the -color_trc flags this used to pass never reached
# libx264, and Chrome then guessed BT.709 (docs/transition-kb-machine.md s21).
# Builds public/transitions/kb-machine.mp4 (+ reversed copy) from the
# accepted Higgsfield drafts. Reproducible: no ad-hoc commands.
#
# v14 changes two things that caused the visible "shift":
#
#  1. NO SYNTHESIZED FRAMES AT ALL. Both interpolators were tried and both
#     fail, on opposite content:
#       - ffmpeg minterpolate doubled and smeared the thin red wipe line
#         (no stable correspondence for a fast thin high-contrast edge)
#       - ByteDance's 60 fps interpolation fixed the line but smeared the
#         beige key rows into a ribbon (a row of near-identical keycaps is a
#         periodic texture; the interpolator cannot tell which key went where)
#     So the drafts are upscaled SPATIALLY ONLY (fps 24 = source rate) and
#     the 60 fps container is reached by frame duplication via `fps=60`,
#     which blends nothing. Every frame shipped is a frame the model drew.
#
#  2. NO K still bookend and NO head crossfade. Clip A's frame 0 is already
#     pixel-identical to the live keyboard, so the page hard-cuts into it.
#     The old head dissolved a STATIC K still into A while A's board was
#     performing its opening settle - showing both boards at once as a
#     ghosted image sliding left. That was the shift.
#
# The master now starts hard on A frame 0.
set -euo pipefail
cd "$(dirname "$0")/.."

# Drafts live OUTSIDE public/: they were 91 MB of the 119 MB that deploys to
# Vercel, publicly reachable and referenced by nothing. Only the two finished
# masters belong in public/.
D=media/drafts
OUT=public/transitions
M_STILL=public/shots/transition-M-off.png

# Sources default to the 4K spatial upscales (0.4 credits each, no temporal
# synthesis - fps 24 = the drafts' own rate, so the frame-smearing that killed
# the fps booster cannot occur; verified frame-by-frame on the red wipe line
# and the key rows). Override with SRC=1080 to fall back to the 1080p pair.
if [ "${SRC:-4k}" = "1080" ]; then
  A=$D/A3-up.mp4; B=$D/B4-up24.mp4
else
  A=$D/A3-4k.mp4; B=$D/B4-4k.mp4
fi

# Output resolution: RES=1440 (default) / 1080 / 2160.
# NOT named OUT - that is already the output DIRECTORY above, and reusing it
# silently matched the path and fell through to the default at every setting.
# The seam constants in TransitionPlayer are unaffected either way:
# everything is cover-mapped into the same 16:9 box, so the geometry is
# identical at any output size.
case "${RES:-1440}" in
  2160) OW=3840; OH=2160 ;;
  1080) OW=1920; OH=1080 ;;
  *)    OW=2560; OH=1440 ;;
esac

# ---- speed is constrained to a short list ---------------------------------
# With no interpolation, smoothness depends entirely on whether the unique
# frame rate divides evenly into the 60 fps container. The drafts are 24 fps:
#
#     unique fps = 24 x speed
#
#   1.55x -> 37.2 fps -> 60/37.2 = 1.61  IRREGULAR. Frames held for one
#                        refresh or two in no fixed pattern: freeze, then
#                        leap twice as far. This was the v15 judder.
#   1.25x -> 30.0 fps -> 60/30 = 2 exactly (and 120/30 = 4). Even 2:2.
#   2.50x -> 60.0 fps -> 1:1. EVERY source frame is its own 60 fps frame,
#                        no duplication at all - the smoothest available.
#
# Divisors of 60 at or above 24 are only 30 and 60, so 1.25x and 2.5x are the
# only even speeds. (Raising the container to 120 fps would add 1.667x, but
# 40 fps content is irregular again on an ordinary 60 Hz display.)
#
# Both clips run at 2.5x - Brian asked for A faster, then for B faster too.
# This supersedes his earlier "the wobble timing is fine as is, dont make it
# shorter": B is now 2.02 s rather than 4.03 s.
A_SPEED=2.5
B_SPEED=2.5
# NO TRIMMING. Brian: "shorten the clip by speeding it up. DO NOT clip off
# portions because thats how we end up with misalignments." Both drafts are
# used whole, from their first frame to their last, and length is controlled
# only by speed.
#
# The old B_TRIM=4.62 was measured to be cutting mid-motion: clip B is still
# moving ~0.3/frame all the way to its final frame at 5.04 s, so the trim
# stopped that motion dead and dissolved to a static plate.
#
# TAIL is the still we append afterwards - our OWN plate, not generated
# footage, so shortening it removes nothing the model drew. It is reduced by
# exactly the run-time that untrimming B gives back (0.42 s source / 2.5 =
# 0.168 s), so the machine is still held for Brian's requested ~0.95 s in
# total once B's own restored tail is counted.
TAIL=0.78
XF_MID=0.12           # A -> B (both near-static at the seam)
XF_TAIL=0.2           # B -> M still (static to static, invisible)

# real durations, probed - never assumed, so nothing is clipped by a stale
# constant drifting out of step with the source files
A_RAW=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$A")
B_RAW=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$B")
A_DUR=$(python3 -c "print($A_RAW/$A_SPEED)")
B_DUR=$(python3 -c "print($B_RAW/$B_SPEED)")
OFF_MID=$(python3 -c "print($A_DUR-$XF_MID)")
OFF_TAIL=$(python3 -c "print($A_DUR+$B_DUR-$XF_MID-$XF_TAIL)")
TOTAL=$(python3 -c "print($A_DUR+$B_DUR-$XF_MID+$TAIL-$XF_TAIL)")

echo "src=${SRC:-4k} res=${OW}x${OH}  A=${A_DUR}s (from ${A_RAW}s, untrimmed)  B=${B_DUR}s (from ${B_RAW}s, untrimmed)  total=${TOTAL}s"

# ---- black level ----------------------------------------------------------
# Measured from real screenshots of the running page: the section background
# is #050505 (RGB 5,5,5), and the K plate we handed Higgsfield had exactly
# that. What came BACK has pure black (0,0,0) - Higgsfield crushed it in
# generation, not us; the plate, draft, upscale and master were each measured
# to confirm where it was lost. Left alone, the whole frame darkens by 5
# levels the instant the clip cuts in, over the entire background.
#
# So the black point is lifted back to 5/255 = 0.019608. The green channel
# starts at 2/255 rather than 0 (a faint tint the upscaler leaves behind), so
# it is mapped from its own floor and the lifted black comes out neutral.
# Whites are untouched: 241 -> 241.2.
LIFT="colorlevels=rimin=0:gimin=0.007843:bimin=0:romin=0.019608:gomin=0.019608:bomin=0.019608"

# fps=60 here DUPLICATES frames; it never blends two source frames.
C="scale=$OW:$OH:flags=lanczos:out_color_matrix=bt709,format=yuv420p,fps=60,setsar=1"

# ---- a known, deliberate residual: composited black --------------------
# The file's background is 5,5,5, exactly matching the page's #050505, and
# the browser DECODES it as 5.00 (canvas readback). But Chrome COMPOSITES
# video through a different path than DOM, and renders it ~4 levels darker.
# Retagging the transfer as sRGB changed nothing. Pre-distorting the pixels
# was tried and abandoned: measured file 0 -> composites 0, file 5 -> 1,
# file 14 -> 11, which is erratic rather than a curve worth inverting, and
# any value tuned here would be tuned to one browser on one display.
# So the file is left correct-by-construction and the small delta is
# accepted. Do not "fix" this by pre-lifting the black again.
ffmpeg -v error -y \
  -i "$A" -i "$B" -loop 1 -t "$TAIL" -i "$M_STILL" \
  -filter_complex "\
[0:v]setpts=PTS/$A_SPEED,$LIFT,$C[a]; \
[1:v]setpts=PTS/$B_SPEED,$LIFT,$C[b]; \
[2:v]$C[m]; \
[a][b]xfade=transition=fade:duration=$XF_MID:offset=$OFF_MID[ab]; \
[ab][m]xfade=transition=fade:duration=$XF_TAIL:offset=$OFF_TAIL[v]" \
  -map "[v]" -an \
  -c:v libx264 -preset slow -crf ${CRF:-16} -pix_fmt yuv420p -movflags +faststart \
  -x264-params "colorprim=bt709:transfer=iec61966-2-1:colormatrix=bt709:range=tv" \
  "$OUT/kb-machine.mp4"

# Reversed copy for scroll-up. Encoded, not played backwards in the browser.
ffmpeg -v error -y -i "$OUT/kb-machine.mp4" -vf reverse -an \
  -c:v libx264 -preset slow -crf ${CRF:-16} -pix_fmt yuv420p -movflags +faststart \
  -x264-params "colorprim=bt709:transfer=iec61966-2-1:colormatrix=bt709:range=tv" \
  "$OUT/kb-machine-rev.mp4"

for f in "$OUT/kb-machine.mp4" "$OUT/kb-machine-rev.mp4"; do
  printf '%s  ' "$f"
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,r_frame_rate,duration -of csv=p=0 "$f"
done
