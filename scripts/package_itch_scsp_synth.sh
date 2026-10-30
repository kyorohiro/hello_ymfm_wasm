#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
exec node "$ROOT_DIR/scripts/package_itch_scsp_synth.mjs" "${1:-dev}"
