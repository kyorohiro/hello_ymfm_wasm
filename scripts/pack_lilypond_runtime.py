#!/usr/bin/env python3
"""Pack an unpacked @hlolli/lilypond-wasm 0.1.0-alpha.1 npm package for the browser worker."""
import gzip
import json
import shutil
import sys
from pathlib import Path

package = Path(sys.argv[1])
target = Path(sys.argv[2])
manifest = json.loads((package / 'runtime-manifest.json').read_text())
packed = bytearray()
files = []
for guest, local in manifest['mounts'].items():
    root = package / local
    for path in sorted(root.rglob('*')):
        if path.is_file():
            data = path.read_bytes()
            files.append({'guestPath': guest + '/' + path.relative_to(root).as_posix(), 'offset': len(packed), 'length': len(data)})
            packed.extend(data)
(target / 'runtime').mkdir(parents=True, exist_ok=True)
(target / 'dist').mkdir(parents=True, exist_ok=True)
(target / 'assets').mkdir(parents=True, exist_ok=True)
(target / 'runtime/runtime-files.json').write_text(json.dumps({'schemaVersion': 1, 'compression': 'gzip', 'uncompressedBytes': len(packed), 'files': files}))
(target / 'runtime/runtime-files.pack.gz').write_bytes(gzip.compress(packed, mtime=0))
shutil.copyfile(package / 'dist/lilypond.wasm', target / 'dist/lilypond.wasm')
# The demo worker also preopens /lilypond-lib. alpha.1 uses /work/lily-lib.
exports = {'a': manifest['lilypondVersion'], 'b': manifest['guileVersion'],
           'c': list(manifest['mounts']) + ['/work/lily-lib', '/lilypond-lib'],
           'd': manifest['environment'], 'e': {'argv0': manifest['argv0'], 'wasi': manifest['wasi']}}
(target / 'assets/index-3ptg5x02.js').write_text(''.join(f'export const {key}={json.dumps(value)};\n' for key, value in exports.items()))
