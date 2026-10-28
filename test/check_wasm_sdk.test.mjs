import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {checkWasmSdk, parseWasmSdkArguments, runWasmSdkCommand, compareWasmSdkAbi, validatePs1SpuSdkReport} from '../scripts/check_wasm_sdk.mjs';
import {WASM_SDK_ARTIFACT_IDS,loadWasmSdkInventory} from '../scripts/wasm_sdk_inventory.mjs';

const root=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const script=resolve(root,'scripts/check_wasm_sdk.mjs');
const inventory=await loadWasmSdkInventory({root});
async function temporary(t){
  const dir=await realpath(await mkdtemp(join(tmpdir(),'tetorica-wasm-sdk-cli-')));
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
async function absent(path){await assert.rejects(stat(path),{code:'ENOENT'});}
const directoryLink=(target,link)=>symlink(target,link,process.platform==='win32'?'junction':'dir');

test('WASM SDK CLI accepts help and resolves both argument spellings',()=>{
  assert.deepEqual(parseWasmSdkArguments(['--help']),{help:true});
  assert.deepEqual(parseWasmSdkArguments([]),{});
  assert.deepEqual(parseWasmSdkArguments(['--work-dir','out','--reference-dir=reference','--sdk-dir','sdk']),{
    '--work-dir':resolve('out'),'--reference-dir':resolve('reference'),'--sdk-dir':resolve('sdk'),
  });
});

test('WASM SDK CLI rejects duplicate, unknown, incomplete and mixed-help arguments',()=>{
  for(const [args,pattern] of [
    [['--work-dir','one','--work-dir=two'],/Duplicate argument/],
    [['--reference-dir=one','--reference-dir','two'],/Duplicate argument/],
    [['--sdk-dir=one','--sdk-dir=two'],/Duplicate argument/],
    [['--unknown','one'],/Unknown argument/],
    [['--work-dir'],/needs a value/],
    [['--sdk-dir='],/needs a value/],
    [['--reference-dir','--work-dir','out'],/needs a value/],
    [['--help','--work-dir','out'],/--help must stand alone/],
  ])assert.throws(()=>parseWasmSdkArguments(args),pattern,JSON.stringify(args));
});

test('WASM SDK command help performs no build or comparison',()=>{
  const result=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8',timeout:10000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Usage:/);assert.match(result.stdout,/all 29 cores/);
  assert.match(result.stdout,/2 application-audio modules and 1 SPU instrument \(32 builds total\)/);
  assert.match(result.stdout,/CMake >=3\.20, CTest and C11\/C\+\+17/);
  assert.doesNotMatch(result.stdout,/WASM SDK validation:|Comparing \d|Building all/);
});

test('an existing work directory is refused without changing its contents',async t=>{
  const dir=await temporary(t),work=join(dir,'existing');await mkdir(work);
  await writeFile(join(work,'keep.txt'),'untouched\n');
  await assert.rejects(checkWasmSdk({'--work-dir':work}),{code:'EEXIST'});
  assert.deepEqual(await readdir(work),['keep.txt']);
  assert.equal(await readFile(join(work,'keep.txt'),'utf8'),'untouched\n');
});

test('work inside the checkout is refused before creating any output',async t=>{
  const dir=await temporary(t),work=join(root,'test',basename(dir));
  await absent(work);
  await assert.rejects(checkWasmSdk({'--work-dir':work}),/outside and not contain the checkout/);
  await absent(work);
});

test('a work directory containing the checkout is refused before writing',async()=>{
  const ancestor=dirname(root),before=await readdir(ancestor);
  await assert.rejects(checkWasmSdk({'--work-dir':ancestor}),/outside and not contain the checkout/);
  assert.deepEqual(await readdir(ancestor),before);
});

test('a symlink alias into the checkout is refused before creating output',async t=>{
  const dir=await temporary(t),alias=join(dir,'checkout');await directoryLink(root,alias);
  const work=join(alias,'new-sdk-check-output');await absent(work);
  await assert.rejects(checkWasmSdk({'--work-dir':work}),/outside and not contain the checkout/);
  await absent(work);assert.deepEqual(await readdir(dir),['checkout']);
});

test('work nested in a reference input is refused without writing',async t=>{
  const dir=await temporary(t),reference=join(dir,'reference');await mkdir(reference);
  const work=join(reference,'new-output');
  await assert.rejects(checkWasmSdk({'--work-dir':work,'--reference-dir':reference}),/must not overlap either input build/);
  assert.deepEqual(await readdir(reference),[]);await absent(work);
});

test('work containing a reference input is refused without writing',async t=>{
  const dir=await temporary(t),reference=join(dir,'reference');await mkdir(reference);
  await assert.rejects(checkWasmSdk({'--work-dir':dir,'--reference-dir':reference}),/must not overlap either input build/);
  assert.deepEqual(await readdir(dir),['reference']);assert.deepEqual(await readdir(reference),[]);
});

test('work nested in a prebuilt SDK input is refused without writing',async t=>{
  const dir=await temporary(t),candidate=join(dir,'candidate');await mkdir(candidate);
  const work=join(candidate,'new-output');
  await assert.rejects(checkWasmSdk({'--work-dir':work,'--sdk-dir':candidate}),/must not overlap either input build/);
  assert.deepEqual(await readdir(candidate),[]);await absent(work);
});

test('aliased reference and prebuilt input directories are refused before work is created',async t=>{
  const dir=await temporary(t),reference=join(dir,'reference'),alias=join(dir,'same-input'),work=join(dir,'output');
  await mkdir(reference);await directoryLink(reference,alias);
  await assert.rejects(checkWasmSdk({'--work-dir':work,'--reference-dir':reference,'--sdk-dir':alias}),/distinct and nonoverlapping/);
  await absent(work);assert.deepEqual(await readdir(reference),[]);
});

test('default temporary output refuses TMPDIR inside the checkout or either input without writes',async t=>{
  const dir=await temporary(t),reference=join(dir,'reference'),candidate=join(dir,'candidate');
  await mkdir(reference);await mkdir(candidate);
  for(const [parent,args,pattern] of [
    [root,[],/Temporary directory must be outside the checkout/],
    [reference,['--reference-dir',reference],/Temporary directory must not be inside either input build/],
    [candidate,['--sdk-dir',candidate],/Temporary directory must not be inside either input build/],
  ]){
    const before=await readdir(parent);
    const result=spawnSync(process.execPath,[script,...args],{
      encoding:'utf8',timeout:10000,env:{...process.env,TMPDIR:parent,TMP:parent,TEMP:parent},
    });
    assert.ifError(result.error);assert.notEqual(result.status,0,result.stdout+result.stderr);
    assert.match(result.stderr,pattern);assert.doesNotMatch(result.stdout,/WASM SDK validation:/);
    assert.deepEqual(await readdir(parent),before);
  }
});

test('command timeout kills a TERM-resistant descendant before returning',{skip:process.platform==='win32',timeout:15000},async t=>{
  const dir=await temporary(t),ready=join(dir,'ready.json'),marker=join(dir,'late-write.txt'),log=join(dir,'timeout.log');
  let group;
  t.after(()=>{if(group)try{process.kill(-group,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}});
  const descendant=`
    const fs=require('node:fs');
    process.on('SIGTERM',()=>{});
    const deadline=Date.now()+3500;
    fs.writeFileSync(process.argv[1]+'.partial',JSON.stringify({pid:process.pid,group:process.ppid,deadline}));
    fs.renameSync(process.argv[1]+'.partial',process.argv[1]);
    setTimeout(()=>fs.writeFileSync(process.argv[2],'descendant survived timeout'),3500);
    setInterval(()=>{},100);
  `;
  const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},...process.argv.slice(1)],{stdio:'inherit'});setInterval(()=>{},100);`;
  const outcome=runWasmSdkCommand(process.execPath,['-e',parent,ready,marker],log,750)
    .then(()=>null,error=>error);
  let started;
  for(let attempt=0;attempt<100&&!started;attempt++){
    try{started=JSON.parse(await readFile(ready,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;await delay(10);}
  }
  assert(started,'Descendant must install its TERM handler before the timeout');
  group=started.group;
  const error=await outcome;assert(error instanceof Error);assert.match(error.message,/failed \(timeout\)/);
  await delay(Math.max(0,started.deadline-Date.now()+500));
  await absent(marker);
  assert.equal(typeof await readFile(log,'utf8'),'string');
});

test('a malformed reference emits a failed summary with all 29 cores not compared',{timeout:30000},async t=>{
  const dir=await temporary(t),checkout=join(dir,'checkout'),reference=join(dir,'reference'),work=join(dir,'output');
  // Exercise the real offline SDK check and failure-report path in an isolated
  // checkout so another validation run cannot change this test's input snapshot.
  for(const path of ['package.json','scripts/check_wasm_sdk.mjs','scripts/wasm_sdk_inventory.mjs',
    'scripts/import_soundchip_sdk.py','third_party/soundchip-sdk.json','third_party/tetorica-soundchip-native']){
    const target=join(checkout,path);await mkdir(dirname(target),{recursive:true});
    await cp(join(root,path),target,{recursive:true});
  }
  for(const path of ['web','docs/js','docs/generated','docs/vgm_analyzer','docs/playground'])await mkdir(join(checkout,path),{recursive:true});
  await mkdir(reference);await writeFile(join(reference,'build-info.json'),JSON.stringify({schemaVersion:1,artifacts:[]})+'\n');
  const result=spawnSync(process.execPath,[join(checkout,'scripts/check_wasm_sdk.mjs'),
    '--work-dir',work,'--reference-dir',reference],{cwd:checkout,encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  assert.ifError(result.error);assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr,new RegExp(`exactly ${inventory.builds.length} artifacts`));
  assert.doesNotMatch(result.stdout,/Comparing \d|Building all|PASS:/);
  const summary=JSON.parse(await readFile(join(work,'summary.json'),'utf8'));
  assert.equal(summary.schemaVersion,1);assert.equal(summary.passed,false);assert.equal(summary.stage,'preflight');
  assert.equal(summary.repositoryInputsUnchanged,true);assert.deepEqual(summary.artifacts,[]);
  assert.deepEqual(summary.expectedArtifacts,[...WASM_SDK_ARTIFACT_IDS]);
  assert.deepEqual(summary.notCompared,[...WASM_SDK_ARTIFACT_IDS]);
  assert.equal(summary.offlineCheck.exitCode,0);assert.match(summary.error,new RegExp(`exactly ${inventory.builds.length} artifacts`));
  assert(summary.completedAt);assert.deepEqual(await readdir(join(work,'reports')),[]);
  await absent(join(work,'rebuilt'));await absent(join(work,'reference'));
  assert.equal(await readFile(join(reference,'build-info.json'),'utf8'),JSON.stringify({schemaVersion:1,artifacts:[]})+'\n');
});


test('SPU instrument exports and imports are included in ABI comparison',()=>{
  const sound={id:'ym2612',wasm:{exports:[{name:'chip',kind:'function'}],imports:[]}};
  const spu={id:'ps1_spu',wasm:{exports:[{name:'ps1_spu_render',kind:'function'}],imports:[{module:'env',name:'invoke_ii',kind:'function'}]}};
  const reference={artifacts:[sound],applicationAudio:[],instruments:[spu]};
  const candidate=structuredClone(reference);compareWasmSdkAbi(reference,candidate);
  candidate.instruments[0].wasm.exports[0].name='wrong_render';
  assert.throws(()=>compareWasmSdkAbi(reference,candidate),/ps1_spu: WASM export ABI changed/);
  candidate.instruments=structuredClone(reference.instruments);candidate.instruments[0].wasm.imports=[];
  assert.throws(()=>compareWasmSdkAbi(reference,candidate),/ps1_spu: WASM import ABI changed/);
  candidate.instruments=[];assert.throws(()=>compareWasmSdkAbi(reference,candidate));
  compareWasmSdkAbi({artifacts:[sound],applicationAudio:[]},{artifacts:[sound],applicationAudio:[]});
});

test('SPU report requires real voice, envelope, FX, isolation and Native PCM checks',()=>{
  const report={passed:true,artifact:'ps1_spu',sampleRate:44100,voices:24,ramBytes:524288,renderedFrames:311605,
    checks:['fixed-rate-C-ABI-register-RAM-and-render-guards','24-voices-high-key-bank-ADSR-release-and-stereo',
      'exact-block-partition-and-independent-instance-state','preset-reverb-tail-reset-and-retained-sample-RAM',
      'actual-Native-WASM-24-voice-ADSR-and-reverb-parity'],
    nativeParity:{passed:true,interleavedSamples:98828,maxAbsoluteError:0,tolerance:1e-6}};
  assert.equal(validatePs1SpuSdkReport(report),report);
  for(const mutation of [r=>r.passed=false,r=>r.sampleRate=48000,r=>r.voices=8,r=>r.ramBytes=65536,
    r=>r.renderedFrames=0,r=>r.checks.pop(),r=>delete r.nativeParity,r=>r.nativeParity.passed=false,
    r=>r.nativeParity.interleavedSamples=0,r=>r.nativeParity.maxAbsoluteError=NaN,
    r=>r.nativeParity.maxAbsoluteError=1e-3,r=>r.nativeParity.maxAbsoluteError=-1,
    r=>r.nativeParity.tolerance=1e-2]){
    const invalid=structuredClone(report);mutation(invalid);assert.throws(()=>validatePs1SpuSdkReport(invalid));
  }
});
