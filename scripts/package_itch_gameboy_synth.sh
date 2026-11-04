#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
# Compatibility command for the renamed DMG Synth.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
exec sh "$ROOT_DIR/scripts/package_itch_dmg_synth.sh" "$@"
