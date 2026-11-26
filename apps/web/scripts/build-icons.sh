#!/bin/sh
# Derives every PNG icon from the two SVG sources. Never edit the PNGs by hand.
# Needs ImageMagick (`magick`). Run from apps/web: sh scripts/build-icons.sh
set -e
cd "$(dirname "$0")/../public"
mkdir -p icons

render() {
  # render <source.svg> <size> <out.png>
  magick -background none -density "$(($2 * 3))" "$1" -resize "${2}x${2}" "$3"
}

render favicon.svg 32 favicon-32.png
render favicon.svg 192 icons/icon-192.png
render favicon.svg 512 icons/icon-512.png
render icons/mark-bleed.svg 180 apple-touch-icon.png
render icons/mark-bleed.svg 512 icons/icon-512-maskable.png
