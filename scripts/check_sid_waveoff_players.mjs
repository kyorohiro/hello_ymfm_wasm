// SPDX-License-Identifier: BSD-3-Clause
// Independent C++/WASM capture for the deliberately changed startup phase.
// Historical005 stays immutable; old CPU/register/envelope invariants remain
// independently enforced even when the corrected PCM differs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SidPlayerCore} from '../docs/sid-player/core.js';
import {validateBrowserPsid} from '../docs/js/sid_psid.js';
import {createSidReferenceFixture} from '../test/fixtures/sid-reference/fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const options={write:false,oldWasm:join(root,'build/validation/sid-waveoff-before-20261108-3hxrot69/tetorica_src/runtime/generated/sid-player/sid-player.wasm'),
  baseline:join(root,'test/fixtures/sid-player/vbi_waveoff_baseline_01.json'),out:join(root,'docs/issues/sid_waveoff_player_regression_01.json'),workDir:join(root,'build/validation')};
for(let index=2;index<process.argv.length;index++){
  const flag=process.argv[index];if(flag==='--write'){options.write=true;continue;}
  const key={'--old-wasm':'oldWasm','--baseline':'baseline','--out':'out','--work-dir':'workDir'}[flag],value=process.argv[++index];
  assert(key&&value&&!value.startsWith('--'),'Usage: [--write] --old-wasm CHECKPOINT --baseline JSON --out JSON --work-dir OUTPUT');options[key]=resolve(value);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const sourceRecord=async path=>({path,...record(await readFile(join(root,path)))});
const historicalPath='test/fixtures/sid-player/vbi_baseline_005.json',historicalBytes=await readFile(join(root,historicalPath)),historical=JSON.parse(historicalBytes);
const historicalSha='dca5233ecb0871b15b272dffa59700483b56c160163ebd44ca11cdb7e256d915';
assert.equal(sha(historicalBytes),historicalSha,'Historical005 changed; never rewrite it to bless the new phase');
const oldBinary=await readFile(options.oldWasm),newWasmPath='docs/generated/sid-player/sid-player.wasm',newBinary=await readFile(join(root,newWasmPath));
assert(!oldBinary.equals(newBinary),'New SID Player WASM has not been staged yet');
const paths=['test/helpers/sid_waveoff_player_reference.cpp','tetorica_src/wasm/sid_player_core.h','third_party/chips-m6502/upstream/m6502.h','third_party/chips-m6581/m6581.h'];
const inputs=await Promise.all(paths.map(sourceRecord));
await mkdir(options.workDir,{recursive:true});const directory=await mkdtemp(join(options.workDir,'sid-waveoff-vbi-')),native=join(directory,'sid-waveoff-player');
const compiler=process.env.CXX||'c++',flags=['-std=c++17','-O2','-ffp-contract=off'];
const header=join(root,'tetorica_src/wasm/sid_player_core.h');
execFileSync(compiler,[...flags,'-DSID_WAVEOFF_PLAYER_HEADER='+JSON.stringify(header),join(root,paths[0]),'-o',native],{cwd:root,stdio:'pipe'});
const compilerVersion=execFileSync(compiler,['--version'],{encoding:'utf8'}).trim();
const pcmBytes=pcm=>Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength);
const reduced=state=>({cycles:state.cycles,initCycles:state.initCycles,playCalls:state.playCalls,skippedVbis:state.skippedVbis,registers:state.registers,voices:state.voices});
const nonPhase=state=>({...state,voices:state.voices.map(({phase,...voice})=>voice)});
function render(core,frames,chunk){const output=new Float32Array(frames);for(let at=0;at<frames;at+=chunk)core.renderInto(output.subarray(at,Math.min(frames,at+chunk)));return output;}
function nativeCapture(payload,parsed,rate,frames,chunk){
  const result=spawnSync(native,[payload,String(rate),String(parsed.loadAddress),String(parsed.initAddress),String(parsed.playAddress),String(parsed.subtune-1),String(frames),String(chunk)],{maxBuffer:4*1024*1024});
  assert.equal(result.status,0,result.stderr.toString());assert.equal(result.stdout.length,frames*4);
  return {pcm:result.stdout,...JSON.parse(result.stderr.toString())};
}
const cases=[];let pcmChanges=0,phaseChanges=0;
for(const previous of historical.cases){
  const fixture=createSidReferenceFixture(previous.profile);assert.equal(sha(fixture.bytes),previous.fixtureSha256);
  const parsed=validateBrowserPsid(fixture.bytes,{vbiBackend:'direct'}),payload=join(directory,`${previous.profile}-${previous.sampleRate}.payload`);await writeFile(payload,parsed.program);
  const old=await SidPlayerCore.create({sampleRate:previous.sampleRate,wasmBinary:oldBinary}),current=await SidPlayerCore.create({sampleRate:previous.sampleRate,wasmBinary:newBinary});
  try{
    old.load(fixture.bytes);current.load(fixture.bytes);
    const oldPcm=render(old,previous.frames,128),newPcm=render(current,previous.frames,128),oldState=reduced(old.getState()),newState=reduced(current.getState());
    assert.equal(sha(pcmBytes(oldPcm)),previous.pcmSha256,'Pre-fix checkpoint must match historicalPCM');assert.deepEqual(oldState,previous.state);
    assert.equal(sha(JSON.stringify(old.readTrace())),previous.traceSha256,'Pre-fix checkpoint must match historicaltrace');
    assert.deepEqual(current.readTrace(),old.readTrace(),'CPU bus writes and cycles must remain exact');assert.deepEqual(nonPhase(newState),nonPhase(oldState),'Only phase may differ in register/execution/envelope observations');
    const a=nativeCapture(payload,parsed,previous.sampleRate,previous.frames,128),b=nativeCapture(payload,parsed,previous.sampleRate,previous.frames,37);
    assert(a.pcm.equals(pcmBytes(newPcm)),'Independent Native and currentWASM PCM differ');assert(b.pcm.equals(a.pcm),'Native chunking changed PCM');
    assert.deepEqual(a.state,newState);assert.deepEqual(b.state,newState);assert.deepEqual(a.trace,current.readTrace());assert.deepEqual(b.trace,a.trace);
    let peak=0,sum=0;for(const value of newPcm){assert(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));sum+=value*value;}assert(peak>.00001,'The self-authored fixture must produce actual finite sound');
    const pcmChanged=sha(a.pcm)!==previous.pcmSha256,phaseChanged=JSON.stringify(newState.voices)!==JSON.stringify(oldState.voices);pcmChanges+=Number(pcmChanged);phaseChanges+=Number(phaseChanged);
    cases.push({sampleRate:previous.sampleRate,profile:previous.profile,frames:previous.frames,fixtureSha256:previous.fixtureSha256,
      historicalPcmSha256:previous.pcmSha256,pcmSha256:sha(a.pcm),traceSha256:previous.traceSha256,state:newState,
      pcmChanged,phaseChanged,oldCheckpointMatchesHistorical:true,nativeWasmPcmAndStateExact:true,nativeChunks:[128,37],cpuTraceAndNonPhaseStateUnchanged:true,rms:Math.sqrt(sum/newPcm.length),peak});
  }finally{old.dispose();current.dispose();}
}
assert.equal(cases.length,12);assert(pcmChanges>0&&phaseChanges>0,'The intended phase fix must be observed, not a blanket no-op approval');
const baseline={format:'tetorica-psid-vbi-waveoff-baseline',version:1,
  purpose:'Corrected startup phase with no selected waveform; independently captured Native PCM exactly matches currentWASM, while historical005 remains immutable',
  historicalBaseline:{path:historicalPath,...record(historicalBytes)},currentWasm:{path:newWasmPath,...record(newBinary)},nativeInputs:inputs,cases};
if(options.write)await writeFile(options.baseline,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});
else assert.deepEqual(JSON.parse(await readFile(options.baseline,'utf8')),baseline,'Corrected baseline differs; create a reviewed new version, do not overwrite');
const proof={schemaVersion:1,passed:true,historicalBaseline:baseline.historicalBaseline,
  oldCheckpoint:{path:relative(root,options.oldWasm),...record(oldBinary),allHistoricalPcmTraceStateMatched:true},currentWasm:baseline.currentWasm,
  native:{inputs,compiler,compilerVersion,flags,binary:{path:relative(root,native),...record(await readFile(native))},chunks:[128,37]},
  baseline:{path:relative(root,options.baseline),...record(await readFile(options.baseline))},cases:cases.length,pcmChanges,phaseChanges,
  invariants:['All12 old checkpoint PCM/trace/state match immutablehistorical005','All12 currentCPU trace/registers/envelopes/execution match historical005','All12 newNative/WASM fullFloat32 PCM/trace/state exact','Native render chunk128/37 exact'],
  applicationWasmNotBuiltHere:true,firmwareOrGameDataIncluded:false,pcmSaved:false,checker:await sourceRecord('scripts/check_sid_waveoff_players.mjs')};
await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:cases.length,pcmChanges,phaseChanges,baseline:options.baseline,out:options.out}));
