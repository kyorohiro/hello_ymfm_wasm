/** Build all pinned SDK cores in isolation and reuse the real PCM/API checks. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {copyFile,lstat,mkdir,mkdtemp,open,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WASM_SDK_ARTIFACT_IDS,loadWasmSdkInventory,verifyWasmBuildDirectory} from './wasm_sdk_inventory.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=`Usage: node scripts/check_wasm_sdk.mjs [--work-dir NEW_DIRECTORY]
       [--reference-dir DIRECTORY] [--sdk-dir PREBUILT_DIRECTORY]

Default: verify the included SDK, build all ${WASM_SDK_ARTIFACT_IDS.length} cores with Emscripten, then
compare their real PCM/API with docs/generated. Requires Node >=22, Python 3,
Emscripten (EMXX/EMCC overrides supported), sh and Perl; no npm install needed.
All outputs stay in a fresh directory outside the checkout. --sdk-dir reuses
and validates existing build outputs instead of compiling. Work is retained,
including summary.json, per-core reports, build receipts and diagnostic logs.
No browser, audio device, publication or Native/Tauri build is performed.`;
const sha=data=>createHash('sha256').update(data).digest('hex');
const inside=(path,directory)=>{const r=relative(directory,path);return !r||(!isAbsolute(r)&&r.split(sep)[0]!=='..');};
const overlaps=(a,b)=>inside(a,b)||inside(b,a);
const serialize=value=>JSON.stringify(value,null,2)+'\n';

export function parseWasmSdkArguments(argv) {
  if(argv.includes('--help')){assert.deepEqual(argv,['--help'],'--help must stand alone');return {help:true};}
  const options={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i],at=arg.indexOf('='),name=at<0?arg:arg.slice(0,at);
    assert(['--work-dir','--reference-dir','--sdk-dir'].includes(name),`Unknown argument: ${arg}\n${usage}`);
    assert(!Object.hasOwn(options,name),'Duplicate argument: '+name);
    const value=at<0?argv[++i]:arg.slice(at+1);assert(value&&!value.startsWith('--'),name+' needs a value');
    options[name]=resolve(value);
  }
  return options;
}

async function canonicalLocation(path) {
  try{return await realpath(path);}catch(error){if(error.code!=='ENOENT')throw error;return join(await canonicalLocation(dirname(path)),basename(path));}
}
async function metadata(path) {const data=await readFile(path);return {path,bytes:data.length,sha256:sha(data)};}
async function snapshotInputs(inventory) {
  const paths=new Set([join(root,'package.json'),join(root,'third_party/soundchip-sdk.json')]);
  async function walk(directory,all=false) {
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);
      assert(!entry.isSymbolicLink(),'Validation input must not be a symlink: '+path);
      if(entry.isDirectory())await walk(path,all);
      else if(entry.isFile()&&(all||/\.(?:js|mjs|json|wasm|ts|sh|py)$/.test(entry.name)))paths.add(path);
    }
  }
  for(const dir of ['scripts','web','docs/js','docs/generated','docs/vgm_analyzer','docs/playground'])await walk(join(root,dir));
  await walk(inventory.sdkRoot,true);
  return Promise.all([...paths].sort().map(metadata));
}
async function verifySnapshot(snapshot,inventory) {
  assert.deepEqual(await snapshotInputs(inventory),snapshot,'Repository runtime, build recipes or SDK changed during validation');
}
async function copyBuild(source,target,inventory) {
  await mkdir(target);
  for(const name of ['build-info.json',...inventory.artifacts.flatMap(a=>a.outputs)]) {
    await copyFile(join(source,name),join(target,name),constants.COPYFILE_EXCL);
  }
  // The generated pairs are ES modules even outside the repository's scope.
  await writeFile(join(target,'package.json'),serialize({type:'module'}),{flag:'wx'});
}
export async function runWasmSdkCommand(command,args,logPath,timeoutMs) {
  const started=Date.now(),log=await open(logPath,'wx');
  try {
    await new Promise((resolveRun,reject)=>{
      const grouped=process.platform!=='win32';
      const child=spawn(command,args,{cwd:root,env:process.env,detached:grouped,stdio:['ignore',log.fd,log.fd]});
      let timedOut=false,finished=false,forceTimer;
      const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(forceTimer);if(error)reject(error);else resolveRun();};
      const kill=signal=>{if(!child.pid)return;try{if(grouped)process.kill(-child.pid,signal);else child.kill(signal);}catch(error){if(error.code!=='ESRCH')finish(error);}};
      const timer=setTimeout(()=>{
        timedOut=true;kill('SIGTERM');
        // A shell can exit before a compiler descendant; stop the entire POSIX
        // process group before closing its log or returning a failed run.
        forceTimer=setTimeout(()=>{kill('SIGKILL');finish(new Error(`${command} failed (timeout); see ${logPath}`));},2000);
      },timeoutMs);
      child.once('error',finish);
      child.once('close',(code,signal)=>{if(!timedOut)finish(code===0?null:new Error(`${command} failed (${signal??'exit '+code}); see ${logPath}`));});
    });
  } finally {await log.close();}
  return {command,args,seconds:(Date.now()-started)/1000,log:await metadata(logPath),exitCode:0};
}
function compareAbi(reference,candidate) {
  const ordered=entries=>entries.toSorted((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(candidate.artifacts.map(a=>a.id),reference.artifacts.map(a=>a.id));
  for(let i=0;i<reference.artifacts.length;i++){
    const a=reference.artifacts[i],b=candidate.artifacts[i];
    assert.deepEqual(ordered(b.wasm.exports),ordered(a.wasm.exports),a.id+': WASM export ABI changed');
    assert.deepEqual(ordered(b.wasm.imports),ordered(a.wasm.imports),a.id+': WASM import ABI changed');
  }
}
function validateParityReport(report,id) {
  assert.equal(report.schemaVersion,1,id+': report schema');assert.equal(report.passed,true,id+': comparison failed');
  assert(Array.isArray(report.cases)&&report.cases.length>0,id+': nonempty PCM comparisons');
  assert(report.cases.every(c=>c.maximumDifference===0),id+': exact PCM comparisons');
  if(Object.hasOwn(report,'maximumDifference'))assert.equal(report.maximumDifference,0,id+': maximum difference');
  if(Object.hasOwn(report,'deviceOpened'))assert.equal(report.deviceOpened,false,id+': no physical output');
  return {comparisons:report.cases.length,maximumDifference:0,
    ...(report.frameCountScope?{frameCountScope:report.frameCountScope}:{}),
    frameCounts:Object.fromEntries(Object.entries(report).filter(([key,value])=>
      typeof value==='number'&&/Frames$/.test(key)))};
}

export async function checkWasmSdk(options={}) {
  const referenceDirectory=await realpath(options['--reference-dir']??join(root,'docs/generated'));
  assert((await lstat(referenceDirectory)).isDirectory(),'Reference build must be a directory');
  // Only the repository deployment may contain the two separately tested
  // application-owned PCM devices. Every copied SDK snapshot, external
  // reference, prebuilt and freshly rebuilt candidate retains strict checks.
  const allowReferenceApplicationAudio=referenceDirectory===await realpath(join(root,'docs/generated'));
  const reusedDirectory=options['--sdk-dir']?await realpath(options['--sdk-dir']):null;
  if(reusedDirectory){assert((await lstat(reusedDirectory)).isDirectory(),'Prebuilt SDK output must be a directory');assert(!overlaps(referenceDirectory,reusedDirectory),'Reference and prebuilt SDK directories must be distinct and nonoverlapping');}
  let workDirectory;
  if(options['--work-dir']){
    workDirectory=await canonicalLocation(options['--work-dir']);
    assert(!overlaps(workDirectory,await realpath(root)),'Work directory must be outside and not contain the checkout');
    for(const input of [referenceDirectory,reusedDirectory].filter(Boolean))assert(!overlaps(workDirectory,input),'Work directory must not overlap either input build');
    await mkdir(workDirectory); // Existing output is always refused, even empty.
  }else {
    const parent=await realpath(tmpdir());
    assert(!inside(parent,await realpath(root)),'Temporary directory must be outside the checkout');
    for(const input of [referenceDirectory,reusedDirectory].filter(Boolean))assert(!inside(parent,input),'Temporary directory must not be inside either input build');
    workDirectory=await mkdtemp(join(parent,'tetorica-wasm-sdk-'));
    for(const input of [referenceDirectory,reusedDirectory].filter(Boolean))assert(!overlaps(workDirectory,input),'Temporary work directory must not overlap either input build');
  }
  const summary={schemaVersion:1,passed:false,startedAt:new Date().toISOString(),nodeVersion:process.version,
    workDirectory,referenceDirectory,reusedDirectory,stage:'preflight',artifacts:[],expectedArtifacts:[...WASM_SDK_ARTIFACT_IDS],
    limits:['Exact synchronous Node/WASM PCM and API parity, not browser/AudioWorklet timing or physical listening.',
      'Existing mixed-engine checks use committed partner-chip builds; each comparison replaces one core at a time.',
      'DX7 frame counts are mono; other checker counters retain their original units and are not combined.',
      'No package/archive build, publish, remote CI dispatch or Native/Tauri execution.']};
  const reportPath=join(workDirectory,'summary.json');
  let inventory,snapshot;
  const save=()=>writeFile(reportPath,serialize(summary));
  try {
    console.log('WASM SDK validation: '+workDirectory);
    for(const name of ['reports','logs'])await mkdir(join(workDirectory,name));
    inventory=await loadWasmSdkInventory({root});
    summary.sdk=inventory.pin;summary.expectedArtifacts=inventory.artifacts.map(a=>a.id);
    snapshot=await snapshotInputs(inventory);summary.inputSnapshot=snapshot;
    await save();
    summary.offlineCheck=await runWasmSdkCommand('python3',[join(root,'scripts/import_soundchip_sdk.py'),'--check'],join(workDirectory,'logs/offline.log'),120000);
    summary.reference=await verifyWasmBuildDirectory({root,directory:referenceDirectory,inventory,
      allowApplicationAudio:allowReferenceApplicationAudio});
    const dx7=await metadata(join(referenceDirectory,'msfa.wasm'));
    summary.dx7RuntimeCopies=[];
    for(const name of ['web/msfa_dx7/wasm/msfa.wasm','docs/js/msfa_dx7/wasm/msfa.wasm']){
      const copy=await metadata(join(root,name));assert.equal(copy.sha256,dx7.sha256,'DX7 runtime copy differs from central build: '+name);assert.equal(copy.bytes,dx7.bytes);summary.dx7RuntimeCopies.push(copy);
    }
    const reference=join(workDirectory,'reference'),candidate=join(workDirectory,'rebuilt');
    await copyBuild(referenceDirectory,reference,inventory);
    summary.referenceSnapshot=await verifyWasmBuildDirectory({root,directory:reference,inventory});
    summary.stage=reusedDirectory?'validating-prebuilt':'building';await save();
    if(reusedDirectory){
      summary.prebuilt=await verifyWasmBuildDirectory({root,directory:reusedDirectory,inventory});
      await copyBuild(reusedDirectory,candidate,inventory);
    }else {
      console.log(`Building all ${inventory.artifacts.length} cores with the fixed SDK…`);
      summary.build=await runWasmSdkCommand('sh',[join(inventory.sdkRoot,'scripts/build-wasm.sh'),'all',candidate],join(workDirectory,'logs/build.log'),45*60*1000);
      await writeFile(join(candidate,'package.json'),serialize({type:'module'}),{flag:'wx'});
    }
    summary.candidate=await verifyWasmBuildDirectory({root,directory:candidate,inventory});
    compareAbi(summary.referenceSnapshot,summary.candidate);
    summary.stage='comparing';await save();
    for(const [index,artifact] of inventory.artifacts.entries()){
      const id=artifact.id,checker=join(root,`scripts/check_${id}_wasm_sdk.mjs`);
      summary.activeArtifact=id;
      const output=join(workDirectory,'reports',id+'.json');
      console.log(`Comparing ${index+1}/${inventory.artifacts.length}: ${id}`);
      const command=await runWasmSdkCommand(process.execPath,[checker,'--legacy-dir',reference,'--sdk-dir',candidate,'--out',output],join(workDirectory,'logs',id+'.log'),5*60*1000);
      const parity=validateParityReport(JSON.parse(await readFile(output,'utf8')),id);
      summary.artifacts.push({id,passed:true,...parity,checker:await metadata(checker),command,report:await metadata(output)});
      delete summary.activeArtifact;
      await save();
    }
    summary.stage='integrity';await save();
    await verifySnapshot(snapshot,inventory);
    assert.deepEqual(await verifyWasmBuildDirectory({root,directory:referenceDirectory,inventory,
      allowApplicationAudio:allowReferenceApplicationAudio}),summary.reference,'Original reference build changed');
    assert.deepEqual(await verifyWasmBuildDirectory({root,directory:reference,inventory}),summary.referenceSnapshot,'Reference snapshot changed');
    assert.deepEqual(await verifyWasmBuildDirectory({root,directory:candidate,inventory}),summary.candidate,'Candidate build changed');
    if(reusedDirectory)assert.deepEqual(await verifyWasmBuildDirectory({root,directory:reusedDirectory,inventory}),summary.prebuilt,'Prebuilt source changed');
    assert.equal(summary.artifacts.length,inventory.artifacts.length);
    summary.totalComparisons=summary.artifacts.reduce((total,a)=>total+a.comparisons,0);
    summary.repositoryInputsUnchanged=true;summary.passed=true;summary.stage='complete';
  }catch(error){
    summary.error=String(error.stack??error);
    if(summary.activeArtifact)summary.failedArtifact=summary.activeArtifact;
    summary.notCompared=(summary.expectedArtifacts??[]).filter(id=>!summary.artifacts.some(a=>a.id===id));
    summary.remainingNotRun=summary.notCompared.filter(id=>id!==summary.failedArtifact);
    if(snapshot&&inventory)try{await verifySnapshot(snapshot,inventory);summary.repositoryInputsUnchanged=true;}catch(integrityError){summary.repositoryInputsUnchanged=false;summary.integrityError=String(integrityError.stack??integrityError);}
    throw error;
  }finally{summary.completedAt=new Date().toISOString();await save();}
  console.log(`PASS: ${summary.candidate.artifactCount} artifacts / ${summary.candidate.outputCount} outputs / ${summary.totalComparisons} exact comparisons. Report: ${reportPath}`);
  return summary;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options=parseWasmSdkArguments(process.argv.slice(2));
    if(options.help)console.log(usage);else await checkWasmSdk(options);
  }catch(error){console.error(error.stack??error);process.exitCode=1;}
}
