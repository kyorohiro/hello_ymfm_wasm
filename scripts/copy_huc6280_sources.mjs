// SPDX-License-Identifier: BSD-3-Clause
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkRuntimeArtifacts, listRuntimeArtifactFiles} from './runtime_artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Retain the fixed SDK layout so the included build recipe works unchanged. */
export async function copyHuc6280Sources(stage) {
  await checkRuntimeArtifacts({root, ids:['huc6280'], mirrors:true});
  const sdk = join(root,'third_party/tetorica-soundchip-native');
  const pinBytes = await readFile(join(root,'third_party/soundchip-sdk.json'));
  const pin = JSON.parse(pinBytes), manifestBytes = await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if (sha(manifestBytes)!==pin.manifestSha256) throw new Error('HuC6280 SDK manifest does not match the fixed pin');
  const manifest = JSON.parse(manifestBytes);
  const buildInfo = JSON.parse(await readFile(join(root,'tetorica_src/runtime/generated/build-info.json')));
  const build = buildInfo.artifacts?.find(item=>item.id==='huc6280');
  if (!build) throw new Error('HuC6280 build provenance is missing');
  const names = [...new Set([...build.sourceFiles.map(item=>item.path),'LICENSE','sdk.json',
    'vendor/mame-huc6280/LICENSE','vendor/mame-huc6280/README.md','docs/huc6280-state.md'])].sort();
  const payload = new Map(), inputs = [];
  for (const name of names) {
    const bytes = await readFile(join(sdk,name)), expected = manifest.files[name];
    if (!expected || bytes.length!==expected.size || sha(bytes)!==expected.sha256) throw new Error(`HuC6280 SDK source mismatch: ${name}`);
    const compiled = build.sourceFiles.find(item=>item.path===name);
    if (compiled && (compiled.size!==bytes.length || compiled.sha256!==sha(bytes))) throw new Error(`HuC6280 build input mismatch: ${name}`);
    const path = `sources/huc6280-sdk/${name}`;
    payload.set(path,bytes); inputs.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  payload.set('sources/huc6280-sdk/RELEASE-MANIFEST.json',manifestBytes);
  payload.set('sources/huc6280-sdk/soundchip-sdk.json',pinBytes);
  payload.set('licenses/mame-huc6280/LICENSE',payload.get('sources/huc6280-sdk/vendor/mame-huc6280/LICENSE'));
  payload.set('licenses/mame-huc6280/README.md',payload.get('sources/huc6280-sdk/vendor/mame-huc6280/README.md'));
  const generated = {};
  for (const file of await listRuntimeArtifactFiles({root,ids:['huc6280'],includeMetadata:false})) {
    const bytes = await readFile(file.source), output = build.outputs.find(item=>item.path===file.path);
    if (!output || bytes.length!==output.size || sha(bytes)!==output.sha256) throw new Error(`HuC6280 output mismatch: ${file.path}`);
    generated[file.path] = {bytes:bytes.length,sha256:sha(bytes)};
  }
  payload.set('sources/HuC6280.json',Buffer.from(JSON.stringify({schemaVersion:1,component:'huc6280',sdk:pin,build,inputs,generated},null,2)+'\n'));
  payload.set('sources/HuC6280.md',Buffer.from(`# HuC6280 PSG source and rebuilding

The MAME-derived HuC6280 PSG by Charles MacDonald and the Tetorica C++
adaptation use BSD-3-Clause. Upstream files, credits and adaptation notes are
retained under [huc6280-sdk/vendor/mame-huc6280/](huc6280-sdk/vendor/mame-huc6280/README.md).
The core, WASM wrapper and recipes are byte-exact files from the pinned native
SDK. [HuC6280.json](HuC6280.json) records their provenance and shipped outputs.

From this sources directory, with Emscripten available:

\`sh huc6280-sdk/scripts/build_huc6280_wasm.sh ../../generated\`

The recipe accepts an absolute output directory as well. No game files, BIOS,
full MAME checkout or network are needed. The PSG has six 32-sample, five-bit
wavetable channels; the final two support noise. Channel 2 modulates channel 1
when hardware LFO is enabled (user-facing channels are one-based).
DDA PCM uses the core's five-bit DAC with software sample feeding in the host.
The formal state API preserves the oscillator, Noise, LFO, DDA and output-frame
phase for exact seek checkpoints; see [the state format](huc6280-sdk/docs/huc6280-state.md).
Software envelopes, keyboard allocation and presets belong to the host. MAME's imperfect/unverified noise and LFO behavior is retained; this
instrument does not claim complete console or analog-output fidelity.
`));
  for (const [name,bytes] of payload) {
    const target=join(stage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
  }
  return {inputs:inputs.length,files:payload.size,sdkVersion:pin.version};
}
