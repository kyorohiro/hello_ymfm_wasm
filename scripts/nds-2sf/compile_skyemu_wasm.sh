#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

# This recipe is distributed beside the adapter and the pinned DS source files.
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$source_dir/skyemu-2sf.wasm"}
"${EMCC:-emcc}" "$source_dir/skyemu_2sf.c" -I "$source_dir/src" \
	-std=gnu11 -O3 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off \
	-s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 \
	-s MAXIMUM_MEMORY=167772160 -s STACK_SIZE=262144 -s FILESYSTEM=0 \
	-s 'EXPORTED_FUNCTIONS=["_malloc","_free","_nds_2sf_open","_nds_2sf_render","_nds_2sf_snapshots","_nds_2sf_snapshot_count","_nds_2sf_close"]' \
	--no-entry -o "$output"
