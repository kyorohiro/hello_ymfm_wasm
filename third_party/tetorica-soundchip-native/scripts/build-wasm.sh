#!/bin/sh
# Compile only vendored C/C++ sources. No downloader, npm, application or runtime
# JavaScript source is needed. EMXX/EMCC can select an installed Emscripten SDK.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
ARTIFACTS="ay8910 gameboy_apu huc6280 k051649 nesapu nuked_opn2 okim6258 pokey pwm32x rf5c164 segapcm segapsg spc wonderswan y8950 ym2151 ym2203 ym2413 ym2608 ym2610b ym2612 ym3438 ym3526 ym3812 ymf262 ymf276 ymf278b ymf288 dx7 cdda msm5205 ps1_spu scsp"
case "${1:---help}" in
  --help|-h) printf '%s\n' 'Usage: sh scripts/build-wasm.sh <artifact|all> [output-directory]' 'Default output: dist/wasm (overwrites imported reference artifacts).' 'Use a separate output directory to retain the imported provenance checksums.' 'Compiler overrides: EMXX, EMCC. All sources and licenses are included.' 'List artifacts: sh scripts/build-wasm.sh --list'; exit 0 ;;
  --list) for artifact in $ARTIFACTS; do printf '%s\n' "$artifact"; done; exit 0 ;;
esac
REQUEST=$1
OUT_DIR=${2:-$ROOT_DIR/dist/wasm}
mkdir -p "$OUT_DIR"
# Resolve before child scripts change directory; caller-relative paths work too.
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
if [ "$REQUEST" = all ]; then SELECTED=$ARTIFACTS; else
  SELECTED=
  for artifact in $ARTIFACTS; do if [ "$artifact" = "$REQUEST" ]; then SELECTED=$artifact; fi; done
  if [ -z "$SELECTED" ]; then printf 'Unknown artifact: %s\n' "$REQUEST" >&2; exit 2; fi
fi
for artifact in $SELECTED; do
  printf 'Building %s\n' "$artifact"
  sh "$ROOT_DIR/scripts/build_${artifact}_wasm.sh" "$OUT_DIR"
  if command -v node >/dev/null 2>&1; then node "$ROOT_DIR/scripts/record_wasm_build.mjs" "$artifact" "$OUT_DIR"; fi
done
