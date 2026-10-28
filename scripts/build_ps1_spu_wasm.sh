#!/bin/sh
# Build the shared SPU from the verified, self-contained SDK source snapshot.
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SDK_DIR="$ROOT_DIR/third_party/tetorica-soundchip-native"
OUT_DIR="${1:-$ROOT_DIR/docs/generated}"
python3 "$ROOT_DIR/scripts/import_soundchip_sdk.py" --check
mkdir -p "$OUT_DIR"
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
INPUT_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/ps1-spu-sdk-inputs.XXXXXX")
trap 'rm -f "$INPUT_SNAPSHOT"' EXIT HUP INT TERM
python3 - "$ROOT_DIR" "$INPUT_SNAPSHOT" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]);sdk=root/'third_party/tetorica-soundchip-native'
def entry(path):
    data=path.read_bytes()
    return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
names=[p.relative_to(sdk).as_posix() for p in sorted((sdk/'vendor/mame-ps1-spu').rglob('*')) if p.is_file()]
names+=['LICENSE','sdk.json','catalog/source_inventory.json','native/include/tetorica/ps1_spu.h','scripts/build_ps1_spu_wasm.sh','scripts/build-wasm.sh','scripts/record_wasm_build.mjs']
pin=json.loads((root/'third_party/soundchip-sdk.json').read_text())
manifest=sdk/'RELEASE-MANIFEST.json'
if entry(manifest)['sha256']!=pin['manifestSha256']:raise SystemExit('PS1 SDK manifest hash mismatch')
records=json.loads(manifest.read_text())['files']
inputs={name:entry(sdk/name) for name in sorted(names)}
for name,value in inputs.items():
    expected=records.get(name)
    if not expected or expected['size']!=value['bytes'] or expected['sha256']!=value['sha256']:raise SystemExit('PS1 SDK source mismatch: '+name)
Path(sys.argv[2]).write_text(json.dumps({'sdk':pin,'inputs':inputs},sort_keys=True))
PY
sh "$SDK_DIR/scripts/build-wasm.sh" ps1_spu "$OUT_DIR"
python3 - "$ROOT_DIR" "$OUT_DIR" "$INPUT_SNAPSHOT" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]);out=Path(sys.argv[2]);sdk=root/'third_party/tetorica-soundchip-native'
snapshot=json.loads(Path(sys.argv[3]).read_text())
def entry(path):
    data=path.read_bytes()
    return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
if snapshot['sdk']!=json.loads((root/'third_party/soundchip-sdk.json').read_text()) or any(entry(sdk/name)!=value for name,value in snapshot['inputs'].items()):
    raise SystemExit('PS1 SDK inputs changed during compilation; rebuild before using the output')
report={'schemaVersion':1,'component':'ps1-spu','fixedSdkArtifact':True,
        'upstream':'MAME '+(sdk/'vendor/mame-ps1-spu/upstream/REVISION').read_text().strip(),
        'sampleRate':44100,'voices':24,'ramBytes':524288,**snapshot,
        'outputs':{name:entry(out/name) for name in ['ps1_spu_wasm.js','ps1_spu_wasm.wasm']}}
(out/'ps1_spu_build.json').write_text(json.dumps(report,indent=2)+'\n')
print('Built PS1 SPU WASM from fixed SDK '+snapshot['sdk']['version']+': '+str(out))
PY
