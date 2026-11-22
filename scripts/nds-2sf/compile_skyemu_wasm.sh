#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

# This recipe is distributed beside the adapter and the pinned DS source files.
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$source_dir/skyemu-2sf.wasm"}
patched=$(mktemp -d "${TMPDIR:-/tmp}/skyemu-adpcm.XXXXXX")
trap 'rm -rf "$patched"' 0
patch -s -l -F 0 -o "$patched/nds.h" "$source_dir/src/nds.h" "$source_dir/skyemu_adpcm_cache.patch"
"${EMCC:-emcc}" "$source_dir/skyemu_2sf.c" -I "$patched" -I "$source_dir/src" \
	-std=gnu11 -O3 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off \
	-s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 \
	-s MAXIMUM_MEMORY=167772160 -s STACK_SIZE=262144 -s FILESYSTEM=0 \
	-s 'EXPORTED_FUNCTIONS=["_malloc","_free","_nds_2sf_open","_nds_2sf_render","_nds_2sf_snapshots","_nds_2sf_snapshot_count","_nds_2sf_capture","_nds_2sf_capture_data","_nds_2sf_capture_revision","_nds_2sf_edit_channel","_nds_2sf_close","_nds_synth_open","_nds_synth_set_adpcm_cache","_nds_synth_upload","_nds_synth_prepare_adpcm","_nds_synth_read","_nds_synth_position","_nds_synth_write","_nds_synth_range","_nds_synth_render","_nds_synth_render_float","_nds_synth_set_mix","_nds_synth_release","_nds_synth_releasing","_nds_synth_upload_voice","_nds_synth_prepare_voice_adpcm","_nds_synth_cancel_voice_adpcm","_nds_synth_close"]' \
	--no-entry -o "$output"
