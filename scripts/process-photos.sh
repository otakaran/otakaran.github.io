#!/usr/bin/env bash
# process-photos.sh — turn the personal phone photos in private/images/*.jpeg
# (GPS-tagged, full-res, git-ignored) into optimized, EXIF-stripped, correctly
# oriented web assets under assets/img/ (committed site content).
#
#   Re-run anytime:  bash scripts/process-photos.sh
#
# Requires ImageMagick (`magick`). Source images live in git-ignored private/ and
# are NOT in the repo; only the processed outputs here are committed. The originals
# contain GPS EXIF (verified via mdls) — every output is `-strip`ped of metadata.
set -euo pipefail

cd "$(dirname "$0")/.."          # repo root

SRC="private/images"
OUT="assets/img/photos"
OG="assets/img/og"
mkdir -p "$OUT" "$OG"

JPG_Q=82
WEBP_Q=80

command -v magick >/dev/null || { echo "ERROR: ImageMagick (magick) not found" >&2; exit 1; }

# emit NAME at each WIDTH as both .jpg and .webp, width-constrained, never upscaled.
#   emit <src> <name> <width>...
# -auto-orient bakes EXIF rotation into pixels (e.g. the Prague shot is stored
# landscape with Orientation=6); -strip then drops all metadata incl. GPS.
emit () {
  local src="$1" name="$2"; shift 2
  [ -f "$src" ] || { echo "skip (missing): $src" >&2; return; }
  for w in "$@"; do
    magick "$src" -auto-orient -resize "${w}x100000>" \
      -strip -interlace Plane -quality "$JPG_Q"  "$OUT/${name}-${w}.jpg"
    magick "$src" -auto-orient -resize "${w}x100000>" \
      -strip -quality "$WEBP_Q" -define webp:method=6 "$OUT/${name}-${w}.webp"
    echo "  $OUT/${name}-${w}.{jpg,webp}"
  done
}

echo "Processing personal photos -> $OUT"
emit "$SRC/backpacking.jpeg"               otakar-portrait   560 1120   # founder headshot (portrait)
emit "$SRC/mountain_summit.jpeg"           summit            1280 1920  # Oregon summit, wide
emit "$SRC/prauge_castle_portrait.jpeg"    prague            1280 1920  # Prague Old Town, worldwide
emit "$SRC/winter_landscape.jpeg"          winter            1280 1920  # Mt. Shasta / snow, atmospheric
emit "$SRC/czech_landscape-portrait.jpeg"  czech-castle      560 1120   # Czech hilltop castle, portrait (EXIF-rotated)

echo "Generating social card -> $OG/og-cover.jpg (1200x630)"
magick "$SRC/mountain_summit.jpeg" -auto-orient -resize "1200x630^" \
  -gravity center -extent 1200x630 -strip -interlace Plane -quality 85 "$OG/og-cover.jpg"

echo
echo "Done. Verifying no GPS/EXIF survived in outputs:"
hits=0
for f in "$OUT"/*.jpg "$OG"/*.jpg; do
  if magick identify -verbose "$f" 2>/dev/null | grep -iqE 'gps|exif:'; then
    echo "  !! metadata found in $f"; hits=$((hits+1))
  fi
done
[ "$hits" -eq 0 ] && echo "  clean (0 files with GPS/EXIF)."
