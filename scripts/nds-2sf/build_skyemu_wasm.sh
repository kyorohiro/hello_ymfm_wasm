#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

case "${1:-}" in
	''|--preview) [ "$#" -le 1 ] || exit 2 ;;
	--release-kit) [ "$#" -eq 3 ] || exit 2 ;;
	*) printf '%s\n' 'Usage: sh scripts/nds-2sf/build_skyemu_wasm.sh [--preview | --release-kit SOURCE_DIR OUTPUT_DIR]' >&2; exit 2 ;;
esac

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cache="$repo/build/nds-2sf"
revision=b64903f0fde8104d0796546b96859e9f682311b7
archive="$cache/skyemu-$revision.tar.gz"
archive_sha256=219841cf0239ad219d7d1d5b4b1d177dfbdd2e82ecf056dc57dfb3a7a4886a7e

mkdir -p "$cache"
stage=$(mktemp -d "$cache/.skyemu-wasm.XXXXXX")
trap 'rm -rf "$stage"' 0
source_archive=$archive
if [ ! -f "$source_archive" ]; then
	source_archive="$stage/skyemu-source.tar.gz"
	curl -fsSL --retry 2 "https://codeload.github.com/skylersaleh/SkyEmu/tar.gz/$revision" -o "$source_archive"
fi
# Extract the exact DS source closure and licenses. Other bundled SkyEmu
# frontends and dependencies are outside this build.
python3 - "$source_archive" "$archive_sha256" "$revision" "$stage" <<'PY'
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

[ "$source_archive" = "$archive" ] || mv -f "$source_archive" "$archive"
cp "$repo/scripts/nds-2sf/skyemu_2sf.c" "$stage/"
cp "$repo/scripts/nds-2sf/skyemu_adpcm_cache.patch" "$stage/"
cp "$repo/scripts/nds-2sf/compile_skyemu_wasm.sh" "$stage/rebuild.sh"
sh "$stage/rebuild.sh" "$stage/skyemu-2sf.wasm"

output=$cache
case "${1:-}" in
	--release-kit)
		mkdir -p "$2"
		cp -R "$stage/src" "$2/"
		cp "$stage/LICENSE" "$stage/skyemu-2sf-notices.txt" "$stage/skyemu_2sf.c" "$stage/skyemu_adpcm_cache.patch" "$stage/rebuild.sh" "$2/"
		output=$3
		;;
esac
mkdir -p "$output"
mv -f "$stage/skyemu-2sf.wasm" "$stage/skyemu-2sf-notices.txt" "$output/"

if [ "${1:-}" = --preview ]; then
	preview="$repo/docs/synth-nitro-ds/generated"
	mkdir -p "$preview"
	cp "$output/skyemu-2sf.wasm" "$output/skyemu-2sf-notices.txt" "$preview/"
fi
