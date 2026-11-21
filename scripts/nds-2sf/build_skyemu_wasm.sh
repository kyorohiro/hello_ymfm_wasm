#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

case "${1:-}" in
	''|--preview) [ "$#" -le 1 ] || exit 2 ;;
	*) printf '%s\n' 'Usage: sh scripts/nds-2sf/build_skyemu_wasm.sh [--preview]' >&2; exit 2 ;;
esac

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$repo/build/nds-2sf"
revision=b64903f0fde8104d0796546b96859e9f682311b7
archive="$output/skyemu-$revision.tar.gz"
archive_sha256=219841cf0239ad219d7d1d5b4b1d177dfbdd2e82ecf056dc57dfb3a7a4886a7e

if [ ! -f "$archive" ]; then
	printf '%s\n' "SkyEmu archive missing. Run sh scripts/nds-2sf/build_skyemu.sh first." >&2
	exit 1
fi

stage=$(mktemp -d "$output/.skyemu-wasm.XXXXXX")
trap 'rm -rf "$stage"' 0
# Extract the exact DS source closure and licenses. Other bundled SkyEmu
# frontends and dependencies are outside this build.
python3 - "$archive" "$archive_sha256" "$revision" "$stage" <<'PY'
import hashlib
from pathlib import Path
import sys
import tarfile

archive, expected, revision, stage = sys.argv[1:]
with open(archive, 'rb') as source:
    digest = hashlib.file_digest(source, 'sha256').hexdigest()
if digest != expected:
    sys.exit(f'SkyEmu archive SHA-256 mismatch: {digest}')

stage = Path(stage)
inputs = (
    'LICENSE', 'src/arm7.h', 'src/nds.h',
    'src/sb_types.h', 'src/shared.h', 'src/nds_rom_database.h',
    'src/freebios/drastic_bios_arm7.h', 'src/freebios/drastic_bios_arm9.h',
    'src/freebios/drastic_bios_readme.txt',
)
with tarfile.open(archive, 'r:gz') as tar:
    for name in inputs:
        member = tar.getmember(f'SkyEmu-{revision}/{name}')
        if not member.isfile():
            sys.exit(f'SkyEmu build input is not a regular file: {name}')
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(tar.extractfile(member).read())

database = (stage / 'src/nds_rom_database.h').read_text(encoding='utf-8')
mit_notice = database.split('/*', 1)[1].split('*/', 1)[0]
notices = (
    f'SkyEmu revision {revision}\nSource archive SHA-256 {digest}\n'
    f'https://github.com/skylersaleh/SkyEmu/tree/{revision}\n\n'
    + (stage / 'LICENSE').read_text(encoding='utf-8')
    + '\n\nNintendo DS ROM database license\n' + mit_notice
    + '\n\n' + (stage / 'src/freebios/drastic_bios_readme.txt').read_text(encoding='utf-8')
)
(stage / 'skyemu-2sf-notices.txt').write_text(notices, encoding='utf-8')
PY

"${EMCC:-emcc}" "$repo/scripts/nds-2sf/skyemu_2sf.c" -I "$stage/src" \
	-std=gnu11 -O3 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off \
	-s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 \
	-s MAXIMUM_MEMORY=167772160 -s STACK_SIZE=262144 -s FILESYSTEM=0 \
	-s 'EXPORTED_FUNCTIONS=["_malloc","_free","_nds_2sf_open","_nds_2sf_render","_nds_2sf_close"]' \
	--no-entry -o "$stage/skyemu-2sf.wasm"
mv -f "$stage/skyemu-2sf.wasm" "$stage/skyemu-2sf-notices.txt" "$output/"

if [ "${1:-}" = --preview ]; then
	preview="$repo/docs/synth-nitro-ds/generated"
	mkdir -p "$preview"
	cp "$output/skyemu-2sf.wasm" "$output/skyemu-2sf-notices.txt" "$preview/"
fi
