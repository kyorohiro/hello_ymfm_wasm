#!/bin/sh
set -eu
exec node "$(dirname "$0")/package_itch_cps1_synth.mjs" "$@"
