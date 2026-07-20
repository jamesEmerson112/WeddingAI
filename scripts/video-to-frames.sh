#!/usr/bin/env bash
# video-to-frames.sh — turn a walkthrough video into a COLMAP-ready image set.
#
#   video → [THIS SCRIPT: ffmpeg] → frames → COLMAP → LichtFeld Studio
#
# Why fixed-rate extraction instead of scene detection or sharpest-frame
# picking: COLMAP wants *evenly spaced* views with consistent overlap as the
# camera orbits the subject. Scene detection optimises for visual change, which
# is the opposite of what we need — it would thin out exactly the slow, dense,
# high-overlap passes that reconstruct best.
#
# Usage:
#   scripts/video-to-frames.sh <video> [outdir] [fps]
#
#   video   input video (any format ffmpeg reads)
#   outdir  where frames land        (default: photos-inbox/<videoname>-frames)
#   fps     frames per second to keep (default: auto-picked to hit ~TARGET_FRAMES)
#
# Examples:
#   scripts/video-to-frames.sh ~/Desktop/venue.mov
#   scripts/video-to-frames.sh ~/Desktop/venue.mov photos-inbox/venue 2
#
set -euo pipefail

# Homebrew paths — this repo is developed on macOS where ffmpeg lives outside
# the default PATH that some shells hand us.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Reconstruction target. Below ~40 frames COLMAP tends to fail to register a
# single connected model; above ~150 training time climbs with little gain.
TARGET_FRAMES=110
MIN_FRAMES=40
MAX_FRAMES=150

# LichtFeld rescales anything wider than --max-width (default 3840) on EVERY
# scene load, so we pay that cost once here instead.
MAX_WIDTH=3840

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
note() { printf '\033[36m%s\033[0m %s\n' "$1" "$2"; }

command -v ffmpeg  >/dev/null || die "ffmpeg not found. Install with: brew install ffmpeg"
command -v ffprobe >/dev/null || die "ffprobe not found (ships with ffmpeg)."

[ $# -ge 1 ] || die "usage: $0 <video> [outdir] [fps]"
VIDEO=$1
[ -f "$VIDEO" ] || die "no such file: $VIDEO"

base=$(basename "$VIDEO"); base=${base%.*}
OUTDIR=${2:-"photos-inbox/${base}-frames"}

# --- Probe the source ------------------------------------------------------
read -r WIDTH HEIGHT DURATION < <(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height:format=duration \
    -of csv=p=0:s=x "$VIDEO" 2>/dev/null \
  | tr 'x\n' '  ' | awk '{print $1, $2, $3}'
)
[ -n "${WIDTH:-}" ] && [ -n "${DURATION:-}" ] || die "could not probe $VIDEO — is it a video file?"

# Bash has no floats; use awk for the arithmetic throughout.
DUR_INT=$(awk -v d="$DURATION" 'BEGIN{printf "%d", d}')
note "source:" "${WIDTH}x${HEIGHT}, ${DUR_INT}s"

[ "$DUR_INT" -ge 10 ] || die "video is only ${DUR_INT}s — too short to orbit a subject. Aim for 45-90s."

# --- Decide the extraction rate -------------------------------------------
if [ $# -ge 3 ]; then
  FPS=$3
  note "rate:" "${FPS} fps (user-specified)"
else
  # Pick the rate that lands nearest TARGET_FRAMES, clamped to a sane band.
  FPS=$(awk -v t="$TARGET_FRAMES" -v d="$DURATION" 'BEGIN{
    f = t / d;
    if (f < 0.5) f = 0.5;
    if (f > 6)   f = 6;
    printf "%.2f", f
  }')
  note "rate:" "${FPS} fps (auto — targets ~${TARGET_FRAMES} frames)"
fi

EXPECTED=$(awk -v f="$FPS" -v d="$DURATION" 'BEGIN{printf "%d", f * d}')
note "expect:" "~${EXPECTED} frames"

if [ "$EXPECTED" -lt "$MIN_FRAMES" ]; then
  printf '\033[33mwarning:\033[0m only ~%s frames — COLMAP often fails to register a single model below %s.\n' "$EXPECTED" "$MIN_FRAMES"
  printf '         Raise fps or shoot a longer pass.\n'
elif [ "$EXPECTED" -gt "$MAX_FRAMES" ]; then
  printf '\033[33mwarning:\033[0m ~%s frames is above %s — training will be slow for little gain.\n' "$EXPECTED" "$MAX_FRAMES"
fi

# --- Build the filter chain ------------------------------------------------
# fps=N resamples to an even N frames/sec. Downscale only if we exceed
# MAX_WIDTH; -2 keeps the aspect ratio and an even height (JPEG needs even
# chroma dimensions).
FILTER="fps=${FPS}"
if [ "$WIDTH" -gt "$MAX_WIDTH" ]; then
  FILTER="${FILTER},scale=${MAX_WIDTH}:-2"
  note "scale:" "${WIDTH}px -> ${MAX_WIDTH}px (LichtFeld --max-width, done once here)"
fi

# --- Extract ---------------------------------------------------------------
[ -d "$OUTDIR" ] && [ -n "$(ls -A "$OUTDIR" 2>/dev/null)" ] \
  && die "$OUTDIR already exists and is not empty — remove it or pick another outdir."
mkdir -p "$OUTDIR"

note "writing:" "$OUTDIR"
# -q:v 2 is high-quality JPEG (scale is 2-31, lower is better). Visually
# lossless for COLMAP's purposes at a fraction of PNG's size.
ffmpeg -hide_banner -loglevel error -stats \
  -i "$VIDEO" -vf "$FILTER" -q:v 2 \
  "$OUTDIR/frame_%04d.jpg"

COUNT=$(find "$OUTDIR" -name 'frame_*.jpg' -type f | wc -l | tr -d ' ')
SIZE=$(du -sh "$OUTDIR" | cut -f1)

printf '\n\033[32mdone:\033[0m %s frames, %s in %s\n' "$COUNT" "$SIZE" "$OUTDIR"

if [ "$COUNT" -lt "$MIN_FRAMES" ]; then
  printf '\033[33m%s frames may be too few to reconstruct — see the warning above.\033[0m\n' "$COUNT"
fi

cat <<EOF

Next: feed $OUTDIR to COLMAP, then LichtFeld Studio.
Motion blur is the top failure mode for video-derived splats — if COLMAP
registers only a fraction of these frames, blur is the first thing to suspect.
EOF
