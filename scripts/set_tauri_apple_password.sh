#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
exec python3 "$ROOT_DIR/scripts/set_tauri_apple_password.py" "$@"
