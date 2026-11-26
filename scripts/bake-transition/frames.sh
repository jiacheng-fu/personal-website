#!/bin/bash
# The transition master's frames, uncompressed: scripts/build-transition.sh's
# own filter graph (speed, lift, scale, fps, the two cross-fades and the
# machine still), written out as RGB PNGs instead of encoded.
set -euo pipefail
cd "/Users/brianfu/Desktop/Personal Website"
OUT="${1:-node_modules/.cache/bake/src}"
mkdir -p "$OUT"
A=media/drafts/A3-4k.mp4
B=media/drafts/B4-4k.mp4
M=public/shots/transition-M-off.png
A_RAW=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$A")
B_RAW=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$B")
A_DUR=$(python3 -c "print($A_RAW/2.5)")
B_DUR=$(python3 -c "print($B_RAW/2.5)")
OFF_MID=$(python3 -c "print($A_DUR-0.12)")
OFF_TAIL=$(python3 -c "print($A_DUR+$B_DUR-0.12-0.2)")
echo "A=$A_DUR B=$B_DUR mid=$OFF_MID tail=$OFF_TAIL"
LIFT="colorlevels=rimin=0:gimin=0.007843:bimin=0:romin=0.019608:gomin=0.019608:bomin=0.019608"
C="scale=2560:1440:flags=lanczos:out_color_matrix=bt709,format=yuv420p,fps=60,setsar=1"
G="[0:v]setpts=PTS/2.5,${LIFT},${C}[a];[1:v]setpts=PTS/2.5,${LIFT},${C}[b];[2:v]${C}[m];[a][b]xfade=transition=fade:duration=0.12:offset=${OFF_MID}[ab];[ab][m]xfade=transition=fade:duration=0.2:offset=${OFF_TAIL}[x];[x]scale=in_color_matrix=bt709:in_range=tv,format=rgb24[v]"
ffmpeg -v error -y -i "$A" -i "$B" -loop 1 -t 0.78 -i "$M" -filter_complex "$G" -map "[v]" -start_number 0 "$OUT/f%03d.png"
ls "$OUT" | wc -l
