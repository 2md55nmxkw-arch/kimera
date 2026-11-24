#!/usr/bin/env bash
# Листы раскадровок танцев: по одному на танец, из набора shots/strip.
# Нужен ImageMagick (montage).
#   node scripts/shots.mjs strip && bash scripts/strips.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p shots/strips
for name in hypno glitch blocks liar clinic peek robot sway; do
  ls shots/strip/60-strip-$name-*.png >/dev/null 2>&1 || continue
  montage shots/strip/60-strip-$name-*.png -tile 8x2 -geometry 230x345+2+2 -background '#222' "shots/strips/$name.png"
done
echo "листы: shots/strips/<танец>.png"
