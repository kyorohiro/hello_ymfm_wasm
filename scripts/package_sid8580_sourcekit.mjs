#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Explicit readable source closure. No minification, GPL SID oracle, Native
// distribution, firmware or music. --plan never creates a stage/archive.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';

export const SID8580_SOURCEKIT_EXTRAS=Object.freeze([
  '.github/workflows/sid8580-probe.yml',
  'scripts/package_sid8580_sourcekit.mjs',
  'scripts/check_sid8580_probe.mjs','scripts/check_sid8580_bus.mjs','scripts/check_sid8580_cpu.mjs',
  'scripts/check_sid8580_probe_browser.mjs','scripts/check_sid8580_quality.mjs',
  'scripts/check_sid8580_calibration.mjs','scripts/sid8580_quality_metrics.mjs',
  'scripts/check_sid8580_cutoff.mjs','scripts/check_sid8580_cutoff_browser.mjs',
  'scripts/check_sid8580_cutoff_policy.mjs','scripts/sid8580_cutoff_metrics.mjs',
  'scripts/analyze_sid8580_cutoff.mjs','scripts/analyze_sid8580_cutoff_validation.mjs',
  'test/helpers/sid8580_probe_fixtures.mjs','test/helpers/sid8580_bus_fixtures.mjs',
  'test/helpers/sid8580_cpu_fixtures.mjs','test/helpers/sid8580_quality_fixtures.mjs',
  'test/helpers/sid8580_legacy_parity.rs','test/sid8580_quality_metrics.test.mjs',
  'test/helpers/sid8580_cutoff_fixtures.mjs','test/sid8580_cutoff_metrics.test.mjs',
  'test/fixtures/sid8580_cutoff_baseline.json',
  'tetorica_src/cli/sid_reference_metrics.mjs',
  // Scalar/hash baseline only; required by the included CI parity command.
  'docs/issues/sid8580_probe_verification_01.json',
  'docs/issues/sid8580_quality_method_01.md',
  'docs/issues/sid8580_quality_validation_analysis_01.json',
  'docs/issues/sid8580_quality_capture_reference_01.json',
  'docs/issues/sid8580_calibration_policy_01.json',
  'docs/issues/sid8580_probe_browser_03.json',
  'docs/issues/sid8580_probe_browser_04.json',
  'docs/issues/sid8580_cutoff_method_01.md',
  'docs/issues/sid8580_cutoff_plan_01.json',
  'docs/issues/sid8580_cutoff_validation_analysis_01.json',
  'docs/issues/sid8580_cutoff_policy_01.json',
  'docs/issues/sid8580_cutoff_browser_01.json',
]);
const WASM=['sid8580-probe.wasm','sid8580-cpu.wasm'];
const NOTICE_ROOT='third_party/sidera/toolchain-notices';
function safePath(name) {
  assert(typeof name==='string'&&name.length>0&&!isAbsolute(name)&&!name.includes('\\')
    &&!name.split('/').some(part=>part===''||part==='.'||part==='..'),`Unsafe source-kit path: ${name}`);
  assert(!/[\x00-\x1f\x7f]/.test(name),`Control byte in source-kit path: ${name}`);
  return name;
}
async function regularBytes(root,name) {
  safePath(name);const parts=name.split('/');let path=root;
  for(let i=0;i<parts.length;i++) {
    path=join(path,parts[i]);const entry=await lstat(path);
    assert(!entry.isSymbolicLink(),`Source-kit symlink refused: ${name}`);
    assert(i===parts.length-1?entry.isFile():entry.isDirectory(),`Not a regular source file: ${name}`);
  }
  return readFile(path);
}
async function inventory(root,prefix='') {
  const files=[];
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const name=prefix+entry.name;
    if(entry.isDirectory())files.push(...await inventory(root,name+'/'));
    else {assert(entry.isFile(),`Unsupported source-kit entry ${name}`);files.push(name);}
  }
  return files.sort();
}
async function absent(path) {
  try {await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  throw new Error(`Refusing to overwrite an existing source-kit path: ${path}`);
}
function allowedSource(name) {
  safePath(name);
  assert(!/(?:^|\/)(?:sid8580_(?:quality_)?reference\.cpp|prepare_sid8580_(?:quality_)?reference\.mjs)$/.test(name),'GPL SID reference implementation excluded');
  assert(!name.startsWith('third_party/sid-reference/')&&!name.startsWith('build/'),'External build/cache excluded');
  assert(!/\.(?:a|o|rlib|sid|psid|rsid|rom|bin|pcm|f32le|wav)$/i.test(name),`Binary/music source-kit entry refused: ${name}`);
}
export async function planSid8580SourceKit({buildDir=join(probeRoot,'build/sid8580-probe')}={}) {
  buildDir=resolve(buildDir);
  const receipt=await probeReceipt(buildDir,{check:true});
  const sources=new Map();
  const add=async(name,expected)=>{
    allowedSource(name);const bytes=await regularBytes(probeRoot,name),record=digest(bytes);
    if(expected)assert.deepEqual(record,expected,`Source-kit hash mismatch: ${name}`);
    sources.set(name,record);
  };
  for(const [name,expected] of Object.entries(receipt.inputs))await add(name,expected);
  for(const name of SID8580_SOURCEKIT_EXTRAS)await add(name);
  const noticeBytes=await regularBytes(probeRoot,NOTICE_ROOT+'/SOURCES.json');
  const notices=JSON.parse(noticeBytes);
  assert.equal(notices.format,'tetorica-rust-toolchain-notices');assert.equal(notices.rustVersion,'1.91.1');
  const expectedNotices=[...Object.keys(notices.files),'README.md','SOURCES.json'].sort();
  assert.deepEqual(await inventory(join(probeRoot,NOTICE_ROOT)),expectedNotices,'Unexpected or missing standard-library notice');
  await add(NOTICE_ROOT+'/SOURCES.json');await add(NOTICE_ROOT+'/README.md');
  for(const [name,expected] of Object.entries(notices.files))await add(NOTICE_ROOT+'/'+safePath(name),expected);
  // Preserve the compact fit analysis and the full training capture's pinned
  // hash/provenance. That large case report is not needed to rebuild/test.
  const calibration=JSON.parse(await regularBytes(probeRoot,'third_party/sidera/8580-resonance-calibration.json'));
  const externalEvidence={};
  for(const key of ['analysis','trainingBaseline']) {
    const declared=calibration[key];assert(declared&&/^docs\/issues\/sid8580_[A-Za-z0-9_.-]+\.json$/.test(declared.path),`Unexpected calibration ${key} path`);
    if(key==='analysis') {
      await add(declared.path,{bytes:declared.bytes,sha256:declared.sha256});
      JSON.parse(await regularBytes(probeRoot,declared.path));
    }else externalEvidence[key]={...declared,packaged:false,requiredForBuildOrTests:false};
  }
  const cutoff=JSON.parse(await regularBytes(probeRoot,'third_party/sidera/8580-cutoff-calibration.json'));
  const cutoffEvidence=(declared,label)=>{
    assert(declared&&/^docs\/issues\/sid8580_[A-Za-z0-9_.-]+\.json$/.test(declared.path),`Unexpected cutoff ${label} path`);
    assert(Number.isSafeInteger(declared.bytes)&&declared.bytes>0&&/^[a-f0-9]{64}$/.test(declared.sha256),`Invalid cutoff ${label} provenance`);
    return {bytes:declared.bytes,sha256:declared.sha256};
  };
  await add(cutoff.predeclaredPlan.path,cutoffEvidence(cutoff.predeclaredPlan,'plan'));
  // Unlike the larger historical resonance capture, the cutoff training JSON
  // is included for an offline, independently recomputed --fit --check.
  await add(cutoff.trainingReport.path,cutoffEvidence(cutoff.trainingReport,'training report'));
  assert.equal(cutoff.analyzer.path,'scripts/analyze_sid8580_cutoff.mjs');
  assert.equal(cutoff.analyzer.metric.path,'scripts/sid8580_cutoff_metrics.mjs');
  for(const declared of [cutoff.analyzer,cutoff.analyzer.metric]) {
    await add(declared.path,{bytes:declared.bytes,sha256:declared.sha256});
  }
  const artifacts={};
  for(const name of WASM) {
    const bytes=await regularBytes(buildDir,name);assert.deepEqual(digest(bytes),receipt.outputs[name]);
    artifacts['artifacts/'+name]=digest(bytes);
  }
  const receiptBytes=await regularBytes(buildDir,'sid8580-probe-build.json');
  assert.deepEqual(JSON.parse(receiptBytes),receipt);
  artifacts['artifacts/sid8580-probe-build.json']=digest(receiptBytes);
  return {buildDir,receipt,compiledInputs:Object.keys(receipt.inputs).length,
    sources:Object.fromEntries([...sources].sort(([a],[b])=>a<b?-1:a>b?1:0)),artifacts,externalEvidence};
}
const README=`# SID8580 controlled-quality and cutoff research source kit

This is an isolated research harness, not a Player, Synth, plugin or SDK release.
It contains pinned sidera 1.1.1 (MIT), marked changes, BSD wrappers, the unchanged
zlib chips/m6502 CPU, original source/license records, Rust 1.91.1 standard-library
notices, matching chip/CPU WASM and readable verification scripts. The damping
and operational LP/HP crossover profiles are independent, experimental, opt-in
and 8580-only; defaults and 6581 remain unchanged.
Bus decay is a bounded approximation and POT reads explicitly fail.

Requirements: Node.js 22+, Rust 1.91.1 with wasm32-unknown-unknown, native C11
Clang and a Clang with the WebAssembly backend. The build may reuse the LLVM
compiler installed with Emscripten or accept SID8_WASM_CC; it does not invoke the
Emscripten runtime/cache or resolve optional Cargo player dependencies.

Rebuild and check from this directory:

    sh scripts/build_sid8580_probe.sh
    node --test test/sid8580_quality_metrics.test.mjs
    node --test test/sid8580_cutoff_metrics.test.mjs
    node scripts/analyze_sid8580_cutoff.mjs --fit docs/issues/sid8580_cutoff_training_before_01.json --plan docs/issues/sid8580_cutoff_plan_01.json --check
    node scripts/check_sid8580_probe.mjs --baseline docs/issues/sid8580_probe_verification_01.json
    node scripts/check_sid8580_bus.mjs
    node scripts/check_sid8580_cpu.mjs
    node scripts/check_sid8580_calibration.mjs
    node scripts/check_sid8580_quality.mjs
    node scripts/check_sid8580_cutoff_policy.mjs
    node scripts/check_sid8580_cutoff.mjs --validation --cutoff-calibrated --resonance-calibrated
    node scripts/sid8580_probe_artifacts.mjs --check build/sid8580-probe

The original upstream sample-clock API can be rechecked with the compile/run
commands in .github/workflows/sid8580-probe.yml. The receipt records the original
host/toolchain and all outputs; Native programs are rebuilt for your local host.
Exact binary identity is meaningful only with a matching compiler/profile.

SID8QUALITY 1 RATE MODEL accepts w REGISTER BYTE, r REGISTER, c CYCLES,
skip CYCLES, reset and stop. Reads/writes do not clock. Skip advances the same
chip and sampler phase while discarding output. Frames means captured stdout
frames; global/generated/all-sample counters include skipped frames. No automatic
warmup, phase, gain or DC correction is applied. Fixtures explicitly establish
TEST/Gate/envelope conditions. The candidate quality executable accepts
--8580-calibration and --8580-cutoff-calibration independently; both are off by
default. The cutoff checker uses the corresponding --resonance-calibrated and
--cutoff-calibrated flags. Its holdout mode is --validation. An LP=HP crossover
is an operational measurement, not a hardware pole or a -3dB cutoff claim.

No Native binary, GPL SID oracle implementation/binary, ROM, music or PCM data is
distributed. Optional --reference comparisons require a separately prepared GPL
executable outside this kit. Historical JSON measurements contain only metadata,
hashes/scalars and provenance. They do not bundle that engine. The optional
historical resonance training-case report is represented by its recorded
hash/provenance. The compact fits, prefrozen cutoff plan, cutoff training JSON,
methods and held-out analyses are included. The cutoff fit can be independently
recomputed and checked offline with the command above; the training JSON contains
measurements and provenance, not PCM or reference-engine code. The optional
browser checker needs separately installed matching Playwright/browser binaries;
the default checks use only built-in Node modules and local compilers.

Native/WASM parity and controlled transfer measurements do not establish full
C64 support, real-hardware fidelity, end-to-end AudioWorklet timing or listening
correctness. Source-kit verification artifacts are recorded in source-kit.json.
`;
async function verifyKit(stage,original) {
  const work='build/sourcekit-rebuild',checks=[];
  const run=(name,command,args)=>{
    execFileSync(command,args,{cwd:stage,stdio:'pipe',timeout:300000,maxBuffer:16*1024*1024});checks.push({name,passed:true});
  };
  run('independent-build','sh',['scripts/build_sid8580_probe.sh',work]);
  run('analytical-metrics','node',['--test','test/sid8580_quality_metrics.test.mjs']);
  run('analytical-cutoff-metrics','node',['--test','test/sid8580_cutoff_metrics.test.mjs']);
  run('training-only-cutoff-fit','node',['scripts/analyze_sid8580_cutoff.mjs','--fit','docs/issues/sid8580_cutoff_training_before_01.json','--plan','docs/issues/sid8580_cutoff_plan_01.json','--check']);
  run('chip-parity','node',['scripts/check_sid8580_probe.mjs','--work-dir',work,'--baseline','docs/issues/sid8580_probe_verification_01.json']);
  run('bounded-bus','node',['scripts/check_sid8580_bus.mjs','--work-dir',work]);
  run('real-cpu','node',['scripts/check_sid8580_cpu.mjs','--work-dir',work]);
  run('calibration-policy','node',['scripts/check_sid8580_calibration.mjs','--work-dir',work]);
  run('controlled-candidate-quality','node',['scripts/check_sid8580_quality.mjs','--work-dir',work]);
  run('cutoff-policy','node',['scripts/check_sid8580_cutoff_policy.mjs','--work-dir',work]);
  run('candidate-cutoff-holdouts','node',['scripts/check_sid8580_cutoff.mjs','--work-dir',work,'--validation','--cutoff-calibrated','--resonance-calibrated']);
  run('original-library','rustc',['--edition=2021','-C','opt-level=3','-C','panic=abort','--crate-name','sidera_upstream','--crate-type','rlib','third_party/sidera/upstream/src/lib.rs','-o',work+'/libsidera_upstream.rlib']);
  run('original-api-harness','rustc',['--edition=2021','-C','opt-level=3','-C','panic=abort','test/helpers/sid8580_legacy_parity.rs','--extern','sidera='+work+'/libsidera.rlib','--extern','sidera_upstream='+work+'/libsidera_upstream.rlib','-o',work+'/legacy-parity']);
  run('original-api-parity',join(stage,work,'legacy-parity'),[]);
  run('matching-receipt','node',['scripts/sid8580_probe_artifacts.mjs','--check',work]);
  const rebuiltBytes=await regularBytes(stage,work+'/sid8580-probe-build.json'),rebuilt=JSON.parse(rebuiltBytes);
  assert.deepEqual(rebuilt.inputs,original.inputs,'Independent build used different source inputs');
  const compilerProfile=({compiler,cCompilers,profile,wasmTarget})=>({compiler,cCompilers,profile,wasmTarget});
  const sameToolchain=JSON.stringify(compilerProfile(rebuilt))===JSON.stringify(compilerProfile(original));
  const outputsByteIdentical=JSON.stringify(rebuilt.outputs)===JSON.stringify(original.outputs);
  const originalBytes=await regularBytes(stage,'artifacts/sid8580-probe-build.json');
  const receiptByteIdentical=rebuiltBytes.equals(originalBytes);
  if(sameToolchain) {assert(outputsByteIdentical,'Matching-toolchain outputs differ');assert(receiptByteIdentical,'Matching-toolchain receipt differs');}
  return {passed:true,checks,sameCompilerProfile:sameToolchain,allOutputsByteIdentical:outputsByteIdentical,
    receiptByteIdentical,referenceUsed:false,parentSourceFallback:false};
}
function zip(stage,archive,names) {
  execFileSync('python3',['-c',String.raw`
import json,sys,zipfile
from pathlib import Path
base=Path(sys.argv[1]); names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  assert not name.startswith('/') and '..' not in name.split('/')
  p=base/name; assert p.is_file() and not p.is_symlink()
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z:
 assert z.testzip() is None
 assert z.namelist()==names
 for name in names: assert z.read(name)==(base/name).read_bytes()
`,stage,archive],{input:JSON.stringify(names),timeout:120000,maxBuffer:4*1024*1024});
}
export async function packageSid8580SourceKit({version='dev',buildDir,releaseDir=join(probeRoot,'release'),verify=false}={}) {
  assert(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version),'Invalid source-kit version');
  const plan=await planSid8580SourceKit({buildDir});releaseDir=resolve(releaseDir);
  const stage=join(releaseDir,`sid8580-quality-source-kit-${version}`),archive=join(releaseDir,`tetorica_sid8580_quality_${version}_sources.zip`);
  await absent(stage);await absent(archive);await mkdir(releaseDir,{recursive:true});await mkdir(stage);
  const records={};
  for(const [name,expected] of Object.entries(plan.sources)) {
    const bytes=await regularBytes(probeRoot,name);assert.deepEqual(digest(bytes),expected,`Source changed during packaging: ${name}`);
    await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),bytes,{flag:'wx'});records[name]=expected;
  }
  for(const [name,expected] of Object.entries(plan.artifacts)) {
    const bytes=await regularBytes(plan.buildDir,name.slice('artifacts/'.length));assert.deepEqual(digest(bytes),expected);
    await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),bytes,{flag:'wx'});records[name]=expected;
  }
  const readme=Buffer.from(README);await writeFile(join(stage,'README.md'),readme,{flag:'wx'});records['README.md']=digest(readme);
  const verification=verify?await verifyKit(stage,plan.receipt):{performed:false};
  // Freeze the distribution to this explicit list. Native/rebuild outputs
  // created by --verify remain local and cannot be swept into the archive.
  const manifest={format:'tetorica-sid8580-quality-source-kit',version:1,sourceVersion:version,production:false,
    compiledInputCount:plan.compiledInputs,sourceFiles:records,wasm:WASM,verification,externalEvidence:plan.externalEvidence,
    excluded:['Native binaries','GPL SID reference implementations/binaries','ROM','music','PCM'],
    optionalPlayerBuilt:false,rustStandardLibraryNoticesIncluded:true};
  await writeFile(join(stage,'source-kit.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const names=[...Object.keys(records),'source-kit.json'].sort();zip(stage,archive,names);
  return {stage,archive,files:names.length,...digest(await readFile(archive)),compiledInputs:plan.compiledInputs,
    verification,zipCrcPassed:true,archiveFilesByteIdentical:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};let planOnly=false;
  for(let i=2;i<process.argv.length;i++) {
    const flag=process.argv[i];
    if(flag==='--plan')planOnly=true;else if(flag==='--verify')options.verify=true;
    else if(['--version','--build-dir','--release-dir'].includes(flag)) {
      const value=process.argv[++i];assert(value&&!value.startsWith('--'),`${flag} needs a value`);
      options[{'--version':'version','--build-dir':'buildDir','--release-dir':'releaseDir'}[flag]]=value;
    }else throw Error('Usage: package_sid8580_sourcekit.mjs [--plan] [--version ID] [--build-dir DIR] [--release-dir DIR] [--verify]');
  }
  if(planOnly) {
    assert(!options.verify,'--plan does not rebuild or create a kit');
    const plan=await planSid8580SourceKit(options);
    console.log(JSON.stringify({passed:true,planOnly:true,compiledInputs:plan.compiledInputs,sourceFiles:Object.keys(plan.sources).length,
      artifacts:plan.artifacts,createsFiles:false},null,2));
  }else console.log(JSON.stringify(await packageSid8580SourceKit(options),null,2));
}
