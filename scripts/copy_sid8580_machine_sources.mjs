// SPDX-License-Identifier: BSD-3-Clause
// Copy a matching 8580 preview source kit without requiring local compilers.
import assert from 'node:assert/strict';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {machineRoot,machineDigest,machineSourceRecords,machineWasmInterface} from './sid8580_machine_artifacts.mjs';

const ARTIFACT_ROOT='docs/generated/sid8580-machine';
const KIT='sources/sid8580-machine';
const EXTRA_INPUTS=['scripts/prepare_sid8580_parser.mjs','tetorica_src/runtime/sid_psid.js','docs/sid8580-lab/psid_structure.js'];
const NOTICE_ROOTS=['third_party/sidera/toolchain-notices','third_party/sid8580-machine-toolchain-notices'];
const README=`# SID Player 8580 preview source kit

The player uses the two WASMs in ../../generated/sid8580-machine/. Their
matching receipt is also copied here as sid8580-machine-build.json. The
compiled sources below retain their repository-relative paths. The original
BSD C64 host and zlib CPU/CIA/VIC devices are unchanged; the marked generated
host links the pinned MIT sidera SID through direct WASM function imports.
Both research filter-fit flags are OFF in the player. This is an approximate
8580 preview, not real-hardware or listening certification.

To rebuild from this directory, install Node.js, Python3, Rust1.91.1 with
wasm32-unknown-unknown, C11/C++17 Clang and Emscripten (the recorded build uses
6.0.6). Then run:

    sh scripts/build_sid8580_machine.sh build/rebuild
    node scripts/sid8580_machine_artifacts.mjs --check build/rebuild
    node scripts/prepare_sid8580_parser.mjs --check

The build produces two WASMs and a separate native validation executable.
Only the two WASMs are distributed in the player. The full compiler versions,
link recipe, 99 compiled input hashes, output hashes and import contract are
recorded in sid8580-machine-build.json. source-kit.json authenticates every
copied source and notice. Equal compiler profiles can be compared byte for
byte with the recorded artifacts; other toolchains require separate functional
checks. Packaging checks current source hashes and WASM imports without calling
installed compilers, so a browser-only CI can create this distribution.

Browser modules are readable at ../../sid-player/ and ../../sid8580-lab/.
The generated PSID layout view and its original source/generator are included
here too; the canonical CLI parser retains its original validation policy.

The native host/wrappers are BSD-3-Clause, the chip devices are zlib and the
pinned sidera sources are MIT. Original and marked adapted sources remain
separate. Rust standard-library notices and conservative Emscripten runtime
notices are copied unmodified with their provenance; their complete notices
do not imply every optional component is linked. No GPL SID reference engine,
native binary, C64 firmware, game music or PCM is included. User-loaded files
are never package inputs.
`;

function safePath(path){
  assert(typeof path==='string'&&path&&!isAbsolute(path)&&!path.includes('\\')&&!/[\x00-\x1f\x7f]/.test(path));
  assert(path.split('/').every(part=>part&&part!=='.'&&part!=='..'));
  assert(!/\.(?:a|o|rlib|bin|rom|wav|pcm|f32le|sid|psid|rsid)$/i.test(path),'Binary, firmware or music cannot be a source input');
  assert(!path.startsWith('build/')&&!path.startsWith('ww/')&&!path.startsWith('third_party/sid-reference/'));
  return path;
}
async function bytesAt(path){
  let current=machineRoot;const parts=safePath(path).split('/');
  for(let index=0;index<parts.length;index++){
    current=join(current,parts[index]);const info=await lstat(current);
    assert(!info.isSymbolicLink()&&(index===parts.length-1?info.isFile():info.isDirectory()),`Not a regular input: ${path}`);
  }
  return readFile(current);
}
async function inventory(directory,prefix=''){
  const files=[];
  for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())files.push(...await inventory(directory,name+'/'));
    else {assert(entry.isFile(),`Unsupported notice entry ${name}`);files.push(name);}
  }
  return files.sort();
}

/** Static source/output authentication; compiler versions remain recorded data.
 * No Rust, Emscripten, game data or local native executable is needed to package.
 */
export async function copySid8580MachineSources(stage){
  const receiptBytes=await bytesAt(ARTIFACT_ROOT+'/sid8580-machine-build.json'),receipt=JSON.parse(receiptBytes);
  assert.equal(receipt.format,'tetorica-sid8580-research-machine-build');assert.equal(receipt.version,1);
  assert.equal(receipt.fixedSdkArtifact,false);assert.equal(receipt.model,'8580');assert.equal(receipt.clockHz,985248);
  assert.deepEqual(receipt.profileDefaults,{resonance:false,cutoff:false});
  const compiledInputs=await machineSourceRecords();
  assert.deepEqual(compiledInputs,receipt.inputs,'8580 compiled input hashes changed; rebuild before packaging');
  assert.equal(Object.keys(compiledInputs).length,99,'Review the 8580 source closure before changing its inventory');
  assert.deepEqual(await machineWasmInterface(join(machineRoot,ARTIFACT_ROOT)),receipt.wasmInterface,'8580 WASM import contract differs');
  execFileSync(process.execPath,['scripts/prepare_sid8580_parser.mjs','--check'],{cwd:machineRoot,stdio:'pipe'});
  const sources={},artifacts=[],noticeRoots=[];
  async function copySource(path,expected){
    const bytes=await bytesAt(path),hash=machineDigest(bytes);if(expected)assert.deepEqual(hash,expected,`Changed 8580 source: ${path}`);
    const target=join(stage,KIT,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});sources[path]=hash;
  }
  for(const [path,expected]of Object.entries(compiledInputs))await copySource(path,expected);
  for(const path of EXTRA_INPUTS)if(!Object.hasOwn(sources,path))await copySource(path);
  for(const root of NOTICE_ROOTS){
    const provenance=JSON.parse(await bytesAt(root+'/SOURCES.json'));
    if(root.includes('sidera/')){assert.equal(provenance.format,'tetorica-rust-toolchain-notices');assert.equal(provenance.rustVersion,'1.91.1');}
    else {assert.equal(provenance.format,'tetorica-emscripten-toolchain-notices');assert.equal(provenance.copiedUnmodified,true);}
    assert.deepEqual(await inventory(join(machineRoot,root)),[...Object.keys(provenance.files),'README.md','SOURCES.json'].sort());
    for(const name of ['README.md','SOURCES.json'])await copySource(root+'/'+name);
    for(const [name,{bytes,sha256}]of Object.entries(provenance.files))await copySource(root+'/'+safePath(name),{bytes,sha256});
    noticeRoots.push(root);
  }
  const generated=join(stage,'generated/sid8580-machine');await mkdir(generated,{recursive:true});
  for(const name of ['sid8580-endpoint.wasm','sid8580-machine.wasm']){
    const bytes=await readFile(join(machineRoot,ARTIFACT_ROOT,name)),hash=machineDigest(bytes);assert.deepEqual(hash,receipt.outputs[name],`8580 WASM hash differs: ${name}`);
    await writeFile(join(generated,name),bytes,{flag:'wx'});artifacts.push({path:'generated/sid8580-machine/'+name,...hash});
  }
  await writeFile(join(generated,'sid8580-machine-build.json'),receiptBytes,{flag:'wx'});
  await writeFile(join(stage,KIT,'sid8580-machine-build.json'),receiptBytes,{flag:'wx'});
  await writeFile(join(stage,KIT,'README.md'),README,{flag:'wx'});
  const manifest={format:'tetorica-sid-player-8580-source-kit',version:1,model:'8580',preview:true,
    compiledInputCount:Object.keys(compiledInputs).length,compiledInputs,
    sources:Object.fromEntries(Object.entries(sources).sort(([a],[b])=>a.localeCompare(b))),
    buildReceipt:{path:'sid8580-machine-build.json',...machineDigest(receiptBytes)},
    artifacts,noticeRoots,compilerInvocationPerformed:false,
    excluded:['Native binaries','GPL SID reference engine','user firmware','game music','PCM']};
  await writeFile(join(stage,KIT,'source-kit.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {artifacts,sourceKit:{path:KIT,manifest:'source-kit.json',compiledInputCount:manifest.compiledInputCount,
    buildReceipt:manifest.buildReceipt,noticeRoots},inputPaths:[...Object.keys(sources),'scripts/copy_sid8580_machine_sources.mjs',ARTIFACT_ROOT+'/sid8580-machine-build.json'].sort()};
}
