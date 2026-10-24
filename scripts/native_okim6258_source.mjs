// Match the constructor-only Native adaptation in Tauri's build.rs. The
// pinned SDK remains immutable; generated C++ is compiled once by each fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const original='Oki6258::Oki6258(uint32_t clock, uint8_t flags, uint32_t rate):initial_clock(clock),initial_flags(flags),rate(rate) { compute_tables();reset(); }';
const native='Oki6258::Oki6258(uint32_t clock, uint8_t flags, uint32_t rate):initial_clock(clock),initial_flags(flags),rate(rate) { static const bool initialized = []{compute_tables();return true;}();(void)initialized;reset(); }';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function adaptNativeOkim6258Source(source){
  assert.equal(source.split(original).length-1,1,
    'SDK OKIM6258 constructor changed; review the Native table-init adaptation');
  return source.replace(original,native);
}

export async function prepareNativeOkim6258Source({sdk,directory,root}){
  const input=path.join(sdk,'vendor/mame-okim6258/okim6258.cpp');
  const bytes=await fs.readFile(input);
  const generated=Buffer.from(adaptNativeOkim6258Source(bytes.toString('utf8')));
  const file=path.join(directory,'tetorica_sdk_okim6258.cpp');
  await fs.writeFile(file,generated);
  return {file,provenance:{sourceFile:path.relative(root,input),sourceSha256:sha256(bytes),
    generatedFile:file,generatedSha256:sha256(generated),
    adaptation:'One exact constructor replacement preserves existing Native thread-safe table initialization; decoder math and pinned SDK bytes are unchanged.'}};
}
