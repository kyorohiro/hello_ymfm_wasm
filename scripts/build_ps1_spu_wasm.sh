#!/bin/sh
# Experimental standalone SPU foundation; not part of the fixed SDK snapshot yet.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
INPUT_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/ps1-spu-inputs.XXXXXX")
trap 'rm -f "$INPUT_SNAPSHOT"' EXIT HUP INT TERM
python3 - "$ROOT_DIR" "$INPUT_SNAPSHOT" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1])
paths=[p for p in sorted((root/'native/ps1').rglob('*')) if p.is_file()]
paths.append(root/'scripts/build_ps1_spu_wasm.sh')
inputs={p.relative_to(root).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths}
Path(sys.argv[2]).write_text(json.dumps(inputs,sort_keys=True))
PY

"${EMXX:-em++}" -std=c++17 -O2 -DNDEBUG -fwrapv -fno-strict-aliasing -ffp-contract=off -fexceptions \
  -I"$ROOT_DIR/native/ps1" \
  "$ROOT_DIR/native/ps1/ps1_spu.cpp" "$ROOT_DIR/native/ps1/spu.cpp" \
  "$ROOT_DIR/native/ps1/spu_tables.cpp" "$ROOT_DIR/native/ps1/spureverb.cpp" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456 \
  -sSTACK_SIZE=1048576 -sFILESYSTEM=0 \
  -sINCOMING_MODULE_JS_API='["wasmBinary","locateFile","instantiateWasm","print","printErr","onAbort","preRun","postRun","onRuntimeInitialized","setStatus","arguments","thisProgram","noExitRuntime","wasmMemory","onExit"]' \
  -sEXPORTED_FUNCTIONS='["_ps1_spu_create","_ps1_spu_destroy","_ps1_spu_reset","_ps1_spu_sample_rate","_ps1_spu_write","_ps1_spu_read","_ps1_spu_load_ram","_ps1_spu_read_ram","_ps1_spu_render","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8","HEAPF32"]' \
  -o "$OUT_DIR/ps1_spu_wasm.js"

python3 - "$ROOT_DIR" "$OUT_DIR" "$INPUT_SNAPSHOT" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]);out=Path(sys.argv[2])
def entry(path):
    data=path.read_bytes()
    return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
inputs={p.relative_to(root).as_posix():entry(p) for p in sorted((root/'native/ps1').rglob('*')) if p.is_file()}
inputs['scripts/build_ps1_spu_wasm.sh']=entry(root/'scripts/build_ps1_spu_wasm.sh')
if inputs != json.loads(Path(sys.argv[3]).read_text()):
    raise SystemExit('PS1 SPU inputs changed during compilation; rebuild before using the output')
report={'schemaVersion':1,'component':'experimental-ps1-spu',
        'upstream':'MAME a64a5d6602b19f67e091a4491f0c851a9dacf79d',
        'fixedSdkArtifact':False,'sampleRate':44100,'voices':24,'ramBytes':524288,
        'inputs':inputs,'outputs':{name:entry(out/name) for name in ['ps1_spu_wasm.js','ps1_spu_wasm.wasm']}}
(out/'ps1_spu_build.json').write_text(json.dumps(report,indent=2)+'\n')
print('Built experimental PS1 SPU WASM and source receipt: '+str(out))
PY
