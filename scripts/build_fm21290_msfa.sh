#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
sdk="$root/third_party/tetorica-soundchip-native"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/vendor" "$work/wasm" "$work/scripts"
cp -R "$sdk/vendor/msfa" "$work/vendor/"
cp -R "$sdk/wasm/dx7" "$work/wasm/"
cp "$sdk/scripts/build_dx7_wasm.sh" "$work/scripts/"
(cd "$work" && patch -p1 < "$root/scripts/fm21290/msfa-live-envelope.patch")
sh "$work/scripts/build_dx7_wasm.sh" "$work/out"
cp "$work/out/msfa.wasm" "$root/docs/synth-fm21290/msfa-live-envelope.wasm"
