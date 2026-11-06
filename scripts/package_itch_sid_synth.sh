#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node "$ROOT_DIR/scripts/package_itch_sid_synth.mjs" "${1:-dev}"
