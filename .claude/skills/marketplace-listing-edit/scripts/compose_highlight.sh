#!/usr/bin/env bash
# Compose one Marketplace highlight image (1840x900 PNG) from screenshot crops.
#
# Usage:
#   compose_highlight.sh <out.png> <card> [<card> ...]
#
# A card is  <absolute image path>:<w|h>=<pixels>[:dark][:box=<W>x<H>]
#   w=640        scale the image to 640 px wide
#   h=770        scale the image to 770 px high
#   dark         dark card background (for a code-editor crop) with 14 px vertical padding
#   box=560x600  fixed card size; the image is centred in it (use for a small diagram)
#
# Cards are laid out left to right, centred, on the blue gradient the listings use.
# Keep the sum of card widths plus 44 px gaps under about 1740 px.
#
# Example:
#   compose_highlight.sh /abs/out/highlight2.png \
#     /abs/crops/openapi.png:h=600 /abs/crops/plantuml.png:h=600 /abs/crops/drawio.png:w=540:box=560x600
#
# Needs Google Chrome (headless). Look at the result before uploading it.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

out=$1
shift
chrome=${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
[ -x "$chrome" ] || { echo "Chrome not found at: $chrome (set CHROME_BIN)" >&2; exit 1; }
case "$out" in /*) ;; *) echo "out path must be absolute: $out" >&2; exit 2 ;; esac

work=$(mktemp -d "${TMPDIR:-/tmp}/compose-highlight.XXXXXX")
trap 'rm -rf "$work"' EXIT
html="$work/page.html"

{
  cat <<'CSS'
<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1840px;height:900px;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;gap:44px;background:linear-gradient(135deg,#0C66E4 0%,#1558BC 100%)}
.c{background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(9,30,66,.35);overflow:hidden;display:flex;align-items:center;justify-content:center}
.c img{display:block}
.d{background:#282A36;padding:14px 0}
</style>
CSS
  for card in "$@"; do
    IFS=':' read -r path size opt1 opt2 <<<"$card"
    [ -f "$path" ] || { echo "image not found: $path" >&2; exit 1; }
    case "$path" in /*) ;; *) echo "image path must be absolute: $path" >&2; exit 2 ;; esac
    case "$size" in
      w=*) attr="width=\"${size#w=}\"" ;;
      h=*) attr="height=\"${size#h=}\"" ;;
      *) echo "card needs w=<px> or h=<px>: $card" >&2; exit 2 ;;
    esac
    class="c"
    style=""
    for opt in "${opt1:-}" "${opt2:-}"; do
      case "$opt" in
        dark) class="c d" ;;
        box=*) dims=${opt#box=}; style="width:${dims%x*}px;height:${dims#*x}px" ;;
        "") ;;
        *) echo "unknown card option: $opt" >&2; exit 2 ;;
      esac
    done
    printf '<div class="%s" style="%s"><img src="file://%s" %s></div>\n' "$class" "$style" "$path" "$attr"
  done
} >"$html"

"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1840,900 --screenshot="$out" "file://$html" >/dev/null 2>&1

[ -s "$out" ] || { echo "Chrome wrote no image: $out" >&2; exit 1; }
if command -v magick >/dev/null 2>&1; then
  magick identify -format '%f %wx%h\n' "$out"
else
  echo "wrote $out (install ImageMagick to print its size)"
fi
