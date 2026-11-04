#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
exec sh "$ROOT_DIR/scripts/package_itch_2a03_synth.sh" "$@"
