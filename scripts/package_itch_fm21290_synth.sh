#!/bin/sh
set -eu
exec node "$(dirname "$0")/package_itch_fm21290_synth.mjs" "$@"
