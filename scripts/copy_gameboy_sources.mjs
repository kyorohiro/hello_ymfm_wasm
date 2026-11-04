// SPDX-License-Identifier: BSD-3-Clause
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkRuntimeArtifacts, listRuntimeArtifactFiles} from './runtime_artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Retain the fixed SDK layout so the included build recipe works unchanged. */
export async function copyGameboySources(stage) {
  await checkRuntimeArtifacts({root, ids:['gameboy_apu'], mirrors:true});
  const sdk = join(root,'third_party/tetorica-soundchip-native');
  const pinBytes = await readFile(join(root,'third_party/soundchip-sdk.json'));
  const pin = JSON.parse(pinBytes), manifestBytes = await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if (sha(manifestBytes)!==pin.manifestSha256) throw new Error('Game Boy SDK manifest does not match the fixed pin');
  const manifest = JSON.parse(manifestBytes);
  const buildInfo = JSON.parse(await readFile(join(root,'tetorica_src/runtime/generated/build-info.json')));
  const build = buildInfo.artifacts?.find(item=>item.id==='gameboy_apu');
  if (!build) throw new Error('Game Boy build provenance is missing');
  const names = [...new Set([...build.sourceFiles.map(item=>item.path),'LICENSE','sdk.json',
    'vendor/mame-gameboy/LICENSE','vendor/mame-gameboy/README.md'])].sort();
  const payload = new Map(), inputs = [];
  for (const name of names) {
    const bytes = await readFile(join(sdk,name)), expected = manifest.files[name];
    if (!expected || bytes.length!==expected.size || sha(bytes)!==expected.sha256) throw new Error(`Game Boy SDK source mismatch: ${name}`);
    const compiled = build.sourceFiles.find(item=>item.path===name);
    if (compiled && (compiled.size!==bytes.length || compiled.sha256!==sha(bytes))) throw new Error(`Game Boy build input mismatch: ${name}`);
    const path = `sources/gameboy-sdk/${name}`;
    payload.set(path,bytes); inputs.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  payload.set('sources/gameboy-sdk/RELEASE-MANIFEST.json',manifestBytes);
  payload.set('sources/gameboy-sdk/soundchip-sdk.json',pinBytes);
  payload.set('licenses/mame-gameboy/LICENSE',payload.get('sources/gameboy-sdk/vendor/mame-gameboy/LICENSE'));
  payload.set('licenses/mame-gameboy/README.md',payload.get('sources/gameboy-sdk/vendor/mame-gameboy/README.md'));
  const generated = {};
  for (const file of await listRuntimeArtifactFiles({root,ids:['gameboy_apu'],includeMetadata:false})) {
    const bytes = await readFile(file.source), output = build.outputs.find(item=>item.path===file.path);
    if (!output || bytes.length!==output.size || sha(bytes)!==output.sha256) throw new Error(`Game Boy output mismatch: ${file.path}`);
    generated[file.path] = {bytes:bytes.length,sha256:sha(bytes)};
  }
  payload.set('sources/GameBoy.json',Buffer.from(JSON.stringify({schemaVersion:1,component:'gameboy_apu',sdk:pin,build,inputs,generated},null,2)+'\n'));
  payload.set('sources/GameBoy.md',Buffer.from(`# Game Boy APU source and rebuilding

The MAME-derived DMG APU by Wilbert Pol and Anthony Kruize (thanks to Shay Green)
and the Tetorica C++ adaptation use BSD-3-Clause. Original upstream files,
attribution and adaptation notes are retained under
[gameboy-sdk/vendor/mame-gameboy/](gameboy-sdk/vendor/mame-gameboy/README.md).
The sources and recipe are byte-exact files from the pinned native SDK.
[GameBoy.json](GameBoy.json) records their provenance and the shipped outputs.

From this sources directory, with Emscripten available:

\`sh gameboy-sdk/scripts/build_gameboy_apu_wasm.sh ../../generated\`

The recipe accepts an absolute output directory as well. Paths are resolved
from the included SDK directory. No game files, console BIOS, full MAME checkout
or network are needed. This is an APU instrument core; CPU/GBS song playback
is not provided. Native hosts compile vendor/mame-gameboy/gameboy_apu.cpp
and include gameboy_apu.h. Each instance has two Pulse channels, one Wave and
one Noise channel. Software keyboard allocation and presets belong to the host.
`));
  for (const [name,bytes] of payload) {
    const target=join(stage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
  }
  return {inputs:inputs.length,files:payload.size,sdkVersion:pin.version};
}
