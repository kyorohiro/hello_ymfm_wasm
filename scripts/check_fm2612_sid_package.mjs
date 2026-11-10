// SID-specific checks shared by the isolated npm consumer harnesses.
import assert from 'node:assert/strict';
import {copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const SID_REQUIRED_PACKAGE_FILES=Object.freeze([
  ...['sid','sid8580','sid_soundchip','sidsynth','sid_waveforms','playground_sid','playground_sid_audio','playground_sid_worklet','playground_sid_inspector'].flatMap(name=>[name+'.js',name+'.d.ts']),
  'generated/sid/sid.wasm','generated/sid/sid-build.json',
  'generated/sid8580-machine/sid8580-endpoint.wasm','generated/sid8580-machine/sid8580-machine.wasm','generated/sid8580-machine/sid8580-machine-build.json',
  'sources/SID.md','sources/SID8580.md','sources/sid/README.md','sources/sid/scripts/build_sid_wasm.sh',
  'sources/sid/tetorica_src/wasm/sid_core.h','sources/sid/tetorica_src/wasm/sid_wasm.cpp',
  'sources/sid/third_party/chips-m6581/upstream/m6581.h','sources/sid/third_party/chips-m6581/m6581.h',
  'licenses/chips-m6581/LICENSE','licenses/chips-m6581/README.md','licenses/chips-m6581/PATCHES.md',
  'sources/sid8580-machine/source-kit.json','sources/sid8580-machine/sid8580-machine-build.json',
  'sources/sid8580-machine/scripts/build_sid8580_machine.sh',
  'sources/sid8580-machine/tetorica_src/wasm/sid8580-probe/lib.rs',
  'sources/sid8580-machine/third_party/sidera/LICENSE',
  'sources/sid8580-machine/third_party/sidera/toolchain-notices/SOURCES.json',
  'sources/sid8580-machine/third_party/sidera/toolchain-notices/COPYRIGHT-library.html',
  'sources/sid8580-machine/third_party/sid8580-machine-toolchain-notices/SOURCES.json',
]);
export function assertSidPackageFiles(paths){
  for(const name of SID_REQUIRED_PACKAGE_FILES)assert(paths.has(name),'SID npm module/type/WASM/source/notice missing '+name);
}
export async function checkInstalledSidNode(consumer){
  const destination=join(consumer,'sid-installed-check.mjs');
  await copyFile(fileURLToPath(new URL('../test/fixtures/fm2612_sid_consumer.mjs',import.meta.url)),destination);
  execFileSync(process.execPath,[destination],{cwd:consumer,stdio:'inherit'});
}
