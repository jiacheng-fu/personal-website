#!/bin/bash
# baked frames -> the two clips, encoded as scripts/build-transition.sh does,
# but TAGGED: BT.709 primaries and matrix, TV range, and the sRGB transfer -
# which is what these pixels are (browser captures and sRGB renders). Left
# untagged (as build-transition.sh's flags silently left it: ffmpeg's
# -color_trc does not reach libx264), Chrome shows the video through a BT.709
# transfer guess, ~7% more contrast than what was encoded; tagged, it shows
# exactly what was encoded (measured 0.41/255).
set -euo pipefail
IN="$1"; OUT="$2"
mkdir -p "$OUT"
ffmpeg -v error -y -framerate 60 -start_number 0 -i "$IN/f%03d.png" \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv" \
  -c:v libx264 -preset slow -crf "${CRF:-16}" -pix_fmt yuv420p -movflags +faststart \
  -x264-params "colorprim=bt709:transfer=iec61966-2-1:colormatrix=bt709:range=tv" \
  "$OUT/kb-machine.mp4"
ffmpeg -v error -y -i "$OUT/kb-machine.mp4" -vf "reverse,setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv" -an \
  -c:v libx264 -preset slow -crf "${CRF:-16}" -pix_fmt yuv420p -movflags +faststart \
  -x264-params "colorprim=bt709:transfer=iec61966-2-1:colormatrix=bt709:range=tv" \
  "$OUT/kb-machine-rev.mp4"
for f in "$OUT/kb-machine.mp4" "$OUT/kb-machine-rev.mp4"; do
  ffprobe -v error -show_entries stream=width,height,r_frame_rate,nb_frames,pix_fmt,color_space,color_transfer,color_primaries,color_range -show_entries format=size -of compact "$f"
done
