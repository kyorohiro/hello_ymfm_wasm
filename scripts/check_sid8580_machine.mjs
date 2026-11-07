#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Actual CPU/CIA/VIC + SID execution; no register replay or injected reads.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {Sid8580MachineCore} from '../docs/sid8580-lab/core.js';
import {checkSid8580MachineBuild,machineDigest,machineRoot} from './sid8580_machine_artifacts.mjs';
import {sid8580MachineFixtures,createSid8580MachineFixture,SID8580_MACHINE_CLOCK} from '../test/helpers/sid8580_machine_fixtures.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  assert(['--work-dir','--out'].includes(args[i])&&args[i+1],`Unknown/missing option ${args[i]}`);
  assert(!options[args[i]],`Duplicate option ${args[i]}`);options[args[i]]=resolve(args[++i]);
}
const directory=options['--work-dir']??resolve(machineRoot,'build/sid8580-machine');
const receipt=await checkSid8580MachineBuild({directory});
const endpointBinary=await readFile(resolve(directory,'sid8580-endpoint.wasm')),
  machineBinary=await readFile(resolve(directory,'sid8580-machine.wasm'));
const profiles=bits=>({resonance:!!(bits&1),cutoff:!!(bits&2)});
const create=(rate,bits=0)=>Sid8580MachineCore.create({sampleRate:rate,endpointBinary,machineBinary,profiles:profiles(bits)});
const loadOptions=f=>({clock:'pal',model:'8580',subtune:f.subtune,environment:'minimal'});
const stateKeys=['state','errorCode','errorAddress','cycles','sidCycles','clockHz','sampleRate','model','hostDcHz',
  'initReturned','initPending','initCycles','initCycleLimit','initReturnCycle','bootCycles','irqCount','nmiCount',
  'playCalls','driverAddress','readCount','writeCount','pc'];
function stableState(s){
  const out=Object.fromEntries(stateKeys.map(key=>{assert(key in s,`Missing state field ${key}`);return [key,s[key]];}));
  for(const key of ['initReturned','initPending'])out[key]=!!out[key];
  out.model=Number(out.model);out.profiles=s.profileBits??(typeof s.profiles==='number'?s.profiles:Number(s.profiles.resonance)|(Number(s.profiles.cutoff)<<1));
  out.registers=s.registers??s.registers32;assert.equal(out.registers.length,32);return out;
}
function snapshot(core,error){
  const state=error?.nativeState??core.getState(),trace=error?.trace??core.readTrace(),sid=error?.sidReads??core.readSidReads();
  const ramRead=address=>error?.ram?error.ram[address]:core.readRam(address);
  return {state:stableState(state),ramStart:0x330,ram:Array.from({length:32},(_,i)=>ramRead(0x330+i)),
    ramExtra:[0xd419,0x400].map(address=>({address,value:ramRead(address)})),
    writes:trace.writes,reads:sid.reads,writeDropped:trace.dropped,readDropped:sid.dropped};
}
function observe(core){
  const before=core.getState();core.readTrace();core.readSidReads();core.readRam(0x330);
  assert.deepEqual(core.getState(),before,'A debug read changed the machine');
}
function advance(core,frames,chunk=4096,{inspect=false}={}){
  const pcm=new Float32Array(frames);
  for(let offset=0;offset<frames;offset+=chunk){
    const count=Math.min(chunk,frames-offset);core.renderInto(pcm.subarray(offset,offset+count));if(inspect)observe(core);
  }
  return Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength);
}
async function wasm(f,rate,bits=0,chunk=4096,{inspect=false}={}){
  const core=await create(rate,bits);let error=null,loadAccepted=true,renderAccepted=true,pcm=Buffer.alloc(rate*4);
  try{
    try{core.load(f.bytes,loadOptions(f));}catch(e){error=e;loadAccepted=false;renderAccepted=false;}
    if(loadAccepted){try{pcm=advance(core,rate,chunk,{inspect});}catch(e){error=e;renderAccepted=false;pcm=Buffer.alloc(rate*4);}}
    assert(!error||error.nativeState||core.handle,'Failure has no actual native diagnostic');
    return {loadAccepted,renderAccepted,pcm,...snapshot(core,error)};
  }finally{core.dispose();}
}
function native(f,rate,bits=0,chunk=4096){
  const mode=f.format==='RSID'?'rsid':f.timing;
  const argv=['--program','-','--mode',mode,'--rate',String(rate),'--profiles',String(bits),
    '--load',String(f.loadAddress),'--init',String(f.initAddress),'--play',String(f.playAddress??0),
    '--song',String(f.subtune-1),'--driver-page','0','--frames',String(rate),'--chunk',String(chunk)];
  const result=spawnSync(resolve(directory,'sid8580-machine'),argv,{input:f.program,maxBuffer:8*1024*1024,timeout:30000});
  assert.equal(result.status,0,result.stderr.toString());const j=JSON.parse(result.stderr.toString());
  return {loadAccepted:j.loadAccepted,renderAccepted:j.renderAccepted,pcm:result.stdout,state:stableState(j.state),
    ramStart:j.ramStart,ram:j.ram,writes:j.writes,reads:j.reads,ramExtra:j.ramExtra,
    writeDropped:j.writeDropped,readDropped:j.readDropped};
}
function ramAt(x,address){const value=x.ram[address-x.ramStart];assert(value!==undefined);return value;}
function expected(x,f,rate,bits){
  assert.equal(x.state.model,8580);assert.equal(x.state.clockHz,SID8580_MACHINE_CLOCK);
  assert.equal(x.state.sampleRate,rate);assert.equal(x.state.profiles,bits);assert.equal(x.state.hostDcHz,12);
  assert.equal(x.pcm.length,rate*4);const values=new Float32Array(x.pcm.buffer,x.pcm.byteOffset,x.pcm.length/4);
  assert(values.every(Number.isFinite),'Nonfinite PCM');assert.equal(x.writeDropped,0);assert.equal(x.readDropped,0);
  for(const [address,value]of f.expectedRam??[])assert.equal(ramAt(x,address),value,`${f.profile} RAM $${address.toString(16)}`);
  for(const address of f.expectedNonzeroRam??[])assert(ramAt(x,address)>0);
  if(f.expectedError){
    assert.equal(x.loadAccepted,false);assert.equal(x.renderAccepted,false);assert.equal(x.state.state,3);
    assert.equal(x.state.errorCode,5);assert.equal(x.state.errorAddress,f.expectedError.address);assert(values.every(v=>v===0));
    assert.equal(ramAt(x,0x33f),0,'CPU ran the epilogue after the unsupported read');
  }else{
    assert.equal(x.loadAccepted,true);assert.equal(x.renderAccepted,true);assert.equal(x.state.state,1);
    assert.equal(x.state.errorCode,0);assert.equal(x.state.initReturned,f.expectedInitReturned);
    assert.equal(x.state.initPending,false);assert(values.some(v=>v!==0),`${f.profile} produced no sound`);
    if(f.expectedLongInit)assert(x.state.initCycles>100000&&x.state.initCycles<2000000);
    if(f.expectedHostPlayCalls!==undefined)assert.equal(x.state.playCalls,f.expectedHostPlayCalls);
    if(f.profile==='psid-vbi'||f.profile==='psid-long-init')assert(x.state.playCalls>0&&x.state.irqCount>0);
    if(f.profile==='psid-cia')assert(x.state.playCalls>100&&x.state.irqCount>100);
    if(f.profile==='rsid-cia-nmi')assert(x.state.nmiCount>0);
    if(f.profile.startsWith('rsid-')&&f.profile!=='rsid-cia-nmi')assert(x.state.irqCount>0);
  }
  const reads=f.expectedReads??[];assert.equal(x.reads.length,reads.length,`${f.profile} unexpected actual SID reads`);
  for(let i=0;i<reads.length;i++){
    const actual=x.reads[i],e=reads[i];assert.equal(actual.address,e.address);assert.equal(actual.register,e.register);
    assert.equal(actual.error,e.unsupported?5:0);assert(actual.cycle>0&&actual.cycle<=x.state.sidCycles);
    if(e.value!==undefined)assert.equal(actual.value,e.value);if(e.nonzero)assert(actual.value>0&&actual.value<256);
    if(e.ram!==undefined)assert.equal(actual.value,ramAt(x,e.ram));
    if(e.unsupported)assert.equal(actual.value,256);
  }
  for(const feedback of f.feedback??[]){
    const read=x.reads[feedback.readIndex];
    assert(x.writes.some(w=>w.register===feedback.writeRegister&&w.value===read.value&&w.cycle+1-read.cycle===feedback.cyclesAfterRead),
      `${f.profile}: actual read did not feed the following STA on the correct cycle`);
  }
  if(f.bankedRamRead){
    assert.equal(ramAt(x,f.bankedRamRead.signatureAddress),f.bankedRamRead.value);
    assert.equal(x.reads.length,1,'Banked-out RAM access was falsely routed into the SID');
  }
}
const report={format:'tetorica-sid8580-c64-machine-verification',version:1,passed:false,productionAdopted:false,
  clockHz:SID8580_MACHINE_CLOCK,model:'8580',profilesDefault:{resonance:false,cutoff:false},
  outputs:receipt.outputs,bridge:receipt.wasmInterface,outputChain:receipt.outputChain,
  timing:'CPU tick -> SID tick/sample -> actual selected bus read/write -> CIA/VIC -> next CPU tick; read cycles are completed SID ticks, old write trace cycles require +1',
  cases:[],profileCases:[],checks:{},inputs:{}};
for(const path of ['scripts/check_sid8580_machine.mjs','test/helpers/sid8580_machine_fixtures.mjs',
  'test/helpers/psid_cia_fixtures.mjs','test/helpers/psid_vbi_machine_fixtures.mjs','test/helpers/rsid_fixtures.mjs',
  'docs/sid8580-lab/core.js','docs/sid8580-lab/parser.js','docs/sid8580-lab/psid_structure.js'])
  report.inputs[path]=machineDigest(await readFile(resolve(machineRoot,path)));
const baseline=new Map();
for(const rate of [44100,48000,96000])for(const f of sid8580MachineFixtures()){
  const x=await wasm(f,rate),split=await wasm(f,rate,0,997,{inspect:true}),n=native(f,rate);
  expected(x,f,rate,0);assert.deepEqual(split,x,`${f.profile}/${rate}: observed split differs`);
  assert.deepEqual(n,x,`${f.profile}/${rate}: Native differs`);baseline.set(`${rate}:${f.profile}`,x);
  const {pcm,...metadata}=x;report.cases.push({fixture:f.profile,rate,...metadata,pcm:machineDigest(pcm),program:machineDigest(f.program),nativeWasm:true,chunked:true});
  if(report.cases.length%13===0)console.log(`SID8580 C64 ${report.cases.length}/39 default cases`);
}
const filtered=createSid8580MachineFixture('bus-immediate',{filter:true}),filteredBaselines=new Map();
for(let bits=0;bits<4;bits++){
  const x=await wasm(filtered,48000,bits),split=await wasm(filtered,48000,bits,997,{inspect:true}),n=native(filtered,48000,bits);
  expected(x,filtered,48000,bits);assert.deepEqual(split,x);assert.deepEqual(n,x);filteredBaselines.set(bits,x);
  const {pcm,...metadata}=x;report.profileCases.push({bits,profiles:profiles(bits),...metadata,pcm:machineDigest(pcm),program:machineDigest(filtered.program),nativeWasm:true,chunked:true});
}
for(const [a,b]of [[0,1],[0,2],[0,3],[1,3],[2,3]]){
  assert.notDeepEqual(filteredBaselines.get(a).pcm,filteredBaselines.get(b).pcm,`Filter profile forwarding ${a}/${b} had no effect`);
  assert.deepEqual(filteredBaselines.get(a).reads,filteredBaselines.get(b).reads,'Filter profiles changed CPU register reads');
  assert.deepEqual(filteredBaselines.get(a).writes,filteredBaselines.get(b).writes,'Filter profiles changed CPU bus writes');
}
const core=await create(48000),control=await create(48000),good=createSid8580MachineFixture('bus-immediate'),bad=createSid8580MachineFixture('pot-x');
try{
  core.load(good.bytes,loadOptions(good));control.load(good.bytes,loadOptions(good));
  assert.deepEqual(advance(core,1000),advance(control,1000));const before=core.getState();
  for(const input of [bad.bytes,new Uint8Array(4)]){assert.throws(()=>core.load(input,loadOptions(bad)));assert.deepEqual(core.getState(),before);}
  assert.deepEqual(advance(core,4096),advance(control,4096),'Rejected candidate changed future PCM');
  core.stop();const stopped=core.getState();assert.equal(stopped.state,2);assert(advance(core,4096).every(x=>x===0));
  assert.deepEqual(core.getState(),stopped,'Stopped CPU/SID kept running');
  core.load(good.bytes,loadOptions(good));assert.deepEqual(advance(core,48000),baseline.get('48000:bus-immediate').pcm,'Reload did not restore initial PCM');
  const long=createSid8580MachineFixture('psid-long-init');core.load(long.bytes,loadOptions(long));assert.equal(core.getState().initPending,true);
  core.stop();const pendingStopped=core.getState();assert(advance(core,4096).every(b=>b===0));assert.deepEqual(core.getState(),pendingStopped);
  core.load(long.bytes,loadOptions(long));assert.deepEqual(advance(core,48000),baseline.get('48000:psid-long-init').pcm);
}finally{core.dispose();control.dispose();}
const first=await create(48000,0),second=new Sid8580MachineCore(first.api,48000,3,first.endpoint,first.linked);
try{
  first.load(filtered.bytes,loadOptions(filtered));second.load(filtered.bytes,loadOptions(filtered));
  const parts=[[],[]];
  for(let left=48000;left>0;){const n=Math.min(left,997);parts[0].push(advance(first,n));parts[1].push(advance(second,n));observe(first);observe(second);left-=n;}
  assert.deepEqual(Buffer.concat(parts[0]),filteredBaselines.get(0).pcm);assert.deepEqual(Buffer.concat(parts[1]),filteredBaselines.get(3).pcm);
  const {pcm:ignoredPcm,loadAccepted:ignoredLoad,renderAccepted:ignoredRender,...expectedFirst}=filteredBaselines.get(0);
  assert.deepEqual(snapshot(first),expectedFirst);
  const {pcm:ignoredOtherPcm,loadAccepted:ignoredOtherLoad,renderAccepted:ignoredOtherRender,...expectedSecond}=filteredBaselines.get(3);
  assert.deepEqual(snapshot(second),expectedSecond);
}finally{first.dispose();second.dispose();}
report.checks={defaultNativeWasmCases:report.cases.length,profileNativeWasmCases:report.profileCases.length,
  splitAndObservationInvariant:true,actualCpuReadsBranchesAndFourCycleFeedback:true,bankedRamNotASidRead:true,
  unsupportedPotHasAddressAndNoCpuEpilogue:true,realCiaVicIrqNmiAndMultispeed:true,longInitRetainedAndStopped:true,
  failedCandidatePreservesOldStateAndFuturePcm:true,stopReload:true,sharedModuleInstanceIsolation:true,
  independentFourProfileForwarding:true,productionPathsChanged:false,hardwareFidelityProven:false};
const bench=await create(48000),fixture=createSid8580MachineFixture('psid-vbi');
try{bench.load(fixture.bytes,loadOptions(fixture));const start=performance.now();advance(bench,96000);const ms=performance.now()-start;
  report.benchmark={frames:96000,seconds:2,ms,realtimeMultiple:2000/ms,scope:'C64 plus directly linked SID WASM; excludes initialization, UI, AudioWorklet and device output'};
}finally{bench.dispose();}
report.passed=true;
if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:true,checks:report.checks,benchmark:report.benchmark,out:options['--out']},null,2));
