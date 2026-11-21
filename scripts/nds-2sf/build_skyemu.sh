#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$repo_root/build/nds-2sf"
# SkyEmu (MIT), pinned after the v5 sample loop fix. Use only its libretro
# target and retain its libretro API
# header (MIT), replacement BIOS (BSD-2-Clause) and ROM database (MIT) notices.
revision=b64903f0fde8104d0796546b96859e9f682311b7
expected_sha256=219841cf0239ad219d7d1d5b4b1d177dfbdd2e82ecf056dc57dfb3a7a4886a7e
source_dir="$output/SkyEmu-$revision"
archive="$output/skyemu-$revision.tar.gz"

mkdir -p "$output"
verify_archive() {
	python3 - "$1" "$expected_sha256" <<'PY'
import hashlib
import sys

digest = hashlib.sha256()
with open(sys.argv[1], 'rb') as src:
    for block in iter(lambda: src.read(1024 * 1024), b''):
        digest.update(block)
actual = digest.hexdigest()
if actual != sys.argv[2]:
    sys.exit(f'SkyEmu archive SHA-256 mismatch: {actual}')
PY
}

if [ ! -f "$archive" ]; then
	download=$(mktemp "$output/skyemu-download.XXXXXX")
	trap 'rm -f "$download"' 0
	curl -fsSL --retry 2 "https://codeload.github.com/skylersaleh/SkyEmu/tar.gz/$revision" -o "$download"
	verify_archive "$download"
	mv "$download" "$archive"
else
	verify_archive "$archive"
fi
if [ ! -f "$source_dir/.tetorica-extracted" ]; then
	tar -xzf "$archive" -C "$output"
	touch "$source_dir/.tetorica-extracted"
fi

case "$(uname -s)" in
	Darwin)
		library_suffix=dylib
		set -- "-DCMAKE_OSX_ARCHITECTURES=$(uname -m)"
		;;
	Linux)
		library_suffix=so
		set --
		;;
	*)
		printf '%s\n' 'The local SkyEmu test build supports macOS and Linux.' >&2
		exit 1
		;;
esac

native_build="$output/skyemu-native-$revision"
cmake -S "$source_dir" -B "$native_build" "$@" \
	-DRETRO_CORE_ONLY=ON -DENABLE_RETRO_ACHIEVEMENTS=OFF -DCMAKE_BUILD_TYPE=Release \
	-DCMAKE_DISABLE_FIND_PACKAGE_Git=ON "-DGIT_COMMIT_HASH=$revision"
cmake --build "$native_build" --target skyemu_libretro --parallel 2

"${CC:-cc}" -std=c11 -O2 -Wall -Wextra -Werror -I "$source_dir/src" \
	"$repo_root/scripts/nds-2sf/render_skyemu.c" "$native_build/skyemu_libretro.$library_suffix" \
	-Wl,-rpath,"$native_build" -lm -o "$output/render-skyemu"
