#!/bin/sh
# Standalone first-stage WonderSwan core; does not modify the pinned SDK.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
"${EMXX:-em++}" -std=c++14 -O2 -I"$ROOT_DIR/third_party/mame-wonderswan" \
 "$ROOT_DIR/wasm/wonderswan_wasm.cpp" "$ROOT_DIR/third_party/mame-wonderswan/wonderswan.cpp" \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sINCOMING_MODULE_JS_API='["wasmBinary"]' \
 -sENVIRONMENT=web,worker,node,shell -sALLOW_MEMORY_GROWTH=1 \
 -sEXPORTED_FUNCTIONS='["_wonderswan_create","_wonderswan_destroy","_wonderswan_reset","_wonderswan_write","_wonderswan_read","_wonderswan_write_memory","_wonderswan_read_memory","_wonderswan_mute","_wonderswan_generate","_malloc","_free"]' \
 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPF32"]' \
 -o "$OUT_DIR/wonderswan_wasm.js"

# A separate receipt keeps this experimental core outside the fixed SDK's
# 27-artifact inventory. No timestamps or checkout-specific absolute paths.
python3 - "$ROOT_DIR" "$OUT_DIR" "${EMXX:-em++}" <<'PY'
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root, output, compiler = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
inputs = [
    'third_party/mame-wonderswan/wonderswan.h',
    'third_party/mame-wonderswan/wonderswan.cpp',
    'third_party/mame-wonderswan/LICENSE',
    'third_party/mame-wonderswan/README.md',
    'third_party/mame-wonderswan/upstream/wswansound.cpp',
    'third_party/mame-wonderswan/upstream/wswansound.h',
    'wasm/wonderswan_wasm.cpp',
    'scripts/build_wonderswan_wasm.sh',
]

def describe(base, name):
    data = (base / name).read_bytes()
    return {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

receipt = {
    'schemaVersion': 1,
    'artifact': 'wonderswan',
    'scope': 'standalone-experimental; not part of the pinned SDK artifact inventory',
    'upstream': {
        'repository': 'https://github.com/mamedev/mame',
        'revision': 'd0f1c15a0f6df2dd51a754cb46e6175b7079c8f2',
        'license': 'BSD-3-Clause',
    },
    'compiler': {
        'name': Path(compiler).name,
        'version': subprocess.check_output([compiler, '--version'], text=True).splitlines()[0],
    },
    'build': {'language': 'c++14', 'optimization': '-O2', 'recipe': 'scripts/build_wonderswan_wasm.sh'},
    'inputs': [describe(root, name) for name in inputs],
    'outputs': [describe(output, name) for name in ['wonderswan_wasm.js', 'wonderswan_wasm.wasm']],
}
(output / 'wonderswan_build-info.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
PY
