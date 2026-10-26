import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk='third_party/tetorica-soundchip-native';
const checker='scripts/check_dx7_wasm_sdk.mjs';
const inventory=JSON.parse(await readFile(resolve(root,sdk,'catalog/source_inventory.json'),'utf8')).artifacts.find(a=>a.id==='dx7');
const receipt=JSON.parse(await readFile(resolve(root,'docs/generated/build-info.json'),'utf8'));
const artifact=receipt.artifacts.find(a=>a.id==='dx7');

// An isolated repository-shaped fixture deliberately has no w/ directory or
// developer source checkout. Only shipped SDK, current runtime and build inputs
// are copied, and the two WASM files have separate paths and inodes.
async function freshCheckout(t){
  const dir=await realpath(await mkdtemp(join(tmpdir(),'tetorica-dx7-checker-cli-')));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const files=[sdk,'web/msfa_dx7','docs/js/msfa_dx7','package.json',checker,
    'scripts/build_dx7_wasm.sh','scripts/sync_dx7_runtime.mjs',
    'scripts/import_soundchip_sdk.py','third_party/soundchip-sdk.json'];
  for(const path of files){
    const target=resolve(dir,path);await mkdir(dirname(target),{recursive:true});
    await cp(resolve(root,path),target,{recursive:true});
  }
  const reference=resolve(dir,'reference'),candidate=resolve(dir,'candidate');
  for(const target of [reference,candidate]){
    await mkdir(target);await cp(resolve(root,'web/msfa_dx7/wasm/msfa.wasm'),resolve(target,'msfa.wasm'));
  }
  await writeFile(resolve(candidate,'build-info.json'),JSON.stringify({schemaVersion:1,artifacts:[artifact]})+'\n');
  await assert.rejects(stat(resolve(dir,'w')),{code:'ENOENT'});
  return {dir,reference,candidate,out:resolve(dir,'report.json')};
}

function run(f,extra=[]){
  const args=['--legacy-dir',f.reference,'--sdk-dir',f.candidate,'--out',f.out,...extra];
  return spawnSync(process.execPath,[resolve(f.dir,checker),...args],{
    cwd:f.dir,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,
  });
}
async function rejectsWithoutReport(f,pattern,extra=[]){
  const result=run(f,extra);assert.ifError(result.error);
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout+result.stderr,pattern);
  await assert.rejects(stat(f.out),{code:'ENOENT'});
  return result;
}

test('DX7 checker runs real PCM/ABI parity from a fresh checkout without w/',{timeout:120000},async t=>{
  const f=await freshCheckout(t),result=run(f);assert.ifError(result.error);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(await readFile(f.out,'utf8'));
  assert.equal(report.passed,true);assert.equal(report.deviceOpened,false);
  assert.equal(report.scenariosPerSampleRate,90);assert.equal(report.scenarioComparisons,360);
  assert.equal(report.scenarioRenderExecutions,752);assert.equal(report.maximumDifference,0);
  assert.equal(report.totalGeneratedOutputMonoFrames,7654140);
  assert.equal(report.inputs.compilerInputPaths.length,inventory.sourceFiles.length);
  for(const path of inventory.sourceFiles)assert(report.inputs.compilerInputPaths.includes(resolve(f.dir,sdk,path)),path);
  for(const path of [...inventory.sourceFiles,...inventory.buildFiles,...inventory.licenseFiles]){
    assert(report.inputs.runtimeAndSourceClosure.some(record=>record.path===resolve(f.dir,sdk,path)),path);
  }
  assert(report.inputs.runtimeAndSourceClosure.every(record=>!record.path.includes('/w/')));
  assert.equal(report.inputs.sdk.buildInfo.artifact.id,'dx7');
  assert.equal(report.inputs.legacy.buildInfo,undefined);
  assert(report.limits.some(line=>line.includes('external source checkout is not required')));
});

test('DX7 checker help retains its existing CLI without a developer checkout',async t=>{
  const f=await freshCheckout(t);
  const result=spawnSync(process.execPath,[resolve(f.dir,checker),'--help'],{cwd:f.dir,encoding:'utf8'});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/--legacy-dir DIR --sdk-dir DIR \[--out REPORT\.json\]/);
});

for(const [name,path] of [
  ['compiler source',inventory.sourceFiles[0]],
  ['build script','scripts/record_wasm_build.mjs'],
  ['license','vendor/msfa/COPYING'],
])test(`DX7 checker fails closed when a required SDK ${name} is absent`,async t=>{
  const f=await freshCheckout(t);await rm(resolve(f.dir,sdk,path));
  await rejectsWithoutReport(f,/ENOENT/);
});

test('DX7 checker still verifies receipt source digests',async t=>{
  const f=await freshCheckout(t),path=resolve(f.dir,sdk,inventory.sourceFiles[0]);
  await writeFile(path,(await readFile(path,'utf8'))+'\n// changed input\n');
  await rejectsWithoutReport(f,/Receipt source digest/);
});

test('DX7 checker still verifies the receipt output digest',async t=>{
  const f=await freshCheckout(t),changed=structuredClone(artifact);
  changed.outputs[0].sha256='0'.repeat(64);
  await writeFile(resolve(f.candidate,'build-info.json'),JSON.stringify({schemaVersion:1,artifacts:[changed]}));
  await rejectsWithoutReport(f,/AssertionError/);
});

test('DX7 checker rejects a standalone WASM with no DX7 ABI',async t=>{
  const f=await freshCheckout(t);
  await rm(resolve(f.candidate,'build-info.json'));
  await writeFile(resolve(f.candidate,'msfa.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));
  await rejectsWithoutReport(f,/Exact 12-function DX7 C ABI/);
});

test('DX7 checker rejects aliased build directories',async t=>{
  const f=await freshCheckout(t);f.candidate=f.reference;
  await rejectsWithoutReport(f,/distinct nonoverlapping build directories/);
});

test('DX7 checker protects required SDK source from report overwrite',async t=>{
  const f=await freshCheckout(t),source=resolve(f.dir,sdk,inventory.sourceFiles[0]),before=await readFile(source);
  f.out=source;const result=run(f);assert.ifError(result.error);assert.notEqual(result.status,0);
  assert.match(result.stderr,/Report must not overwrite an executable\/source input/);
  assert.deepEqual(await readFile(source),before);
});

test('DX7 checker protects an absent package scope from being created as a report',async t=>{
  const f=await freshCheckout(t);f.out=resolve(f.dir,'scripts/package.json');
  await rejectsWithoutReport(f,/Report must not create a missing package-scope input/);
});

test('DX7 checker rejects invalid CLI options before writing a report',async t=>{
  const f=await freshCheckout(t);
  for(const [args,pattern] of [
    [['--unknown','yes'],/Unknown argument/],
    [['--sdk-dir',f.candidate],/Duplicate argument/],
    [['--out'],/Duplicate argument/],
    [['--help'],/--help must stand alone/],
  ])await rejectsWithoutReport(f,pattern,args);
});
