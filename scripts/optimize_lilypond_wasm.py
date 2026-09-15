"""Reduce WASM locals without changing the upstream feature set.

Usage: python3 scripts/optimize_lilypond_wasm.py upstream.wasm output.wasm \
    --wasm-opt /path/to/binaryen-version_132/bin/wasm-opt
The input is the unmodified @hlolli/lilypond-wasm 0.1.0-alpha.1 binary.
"""
import argparse
import hashlib
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--wasm-opt', default='wasm-opt')
args = parser.parse_args()
expected = 'e957ee1839f0102d9fd543821019e7ecb5fac71584dcc7a92983dd7525499961'
if hashlib.sha256(args.source.read_bytes()).hexdigest() != expected:
    parser.error('Expected the pinned, unmodified upstream WASM')
if args.source.resolve() == args.output.resolve():
    parser.error('Keep the upstream input; choose a separate output path')
version = subprocess.check_output([args.wasm_opt, '--version'], text=True).strip()
if version != 'wasm-opt version 132 (version_132)':
    parser.error(f'Expected Binaryen version 132; got {version}')
# Do not use --all-features: it also enables output features unavailable in
# supported browsers. Preserve the input target_features instead.
subprocess.run([args.wasm_opt, str(args.source), '--coalesce-locals', '--vacuum',
                '-o', str(args.output)], check=True)
print(hashlib.sha256(args.output.read_bytes()).hexdigest(), args.output)
