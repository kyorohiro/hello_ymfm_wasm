#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec node scripts/package_itch_smsgear_synth.mjs "$@"
