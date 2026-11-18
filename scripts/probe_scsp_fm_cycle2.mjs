// SPDX-License-Identifier: BSD-3-Clause
// Research only: physical SCSP slots. No Synth graph/API or audio device is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp} from '../docs/js/scsp.js';
import {ScspSynth} from '../docs/js/scspsynth.js';
import {Pcm44100Resampler} from '../docs/js/pcm_44100_resampler.js';

export const SCSP_CYCLE2_RESEARCH_BASE='553c59bbf05f601b38ee24196a8d570105c5c1db';
export const SCSP_CYCLE2_VARIANTS=Object.freeze(['current-forward-return1','current-forward-return2','current-forward-average12','both-previous1','two-bank-average']);
export const SCSP_CYCLE2_PLACEMENTS=Object.freeze([[0,1],[1,0],[6,7],[7,6],[0,31],[31,0],[6,31],[31,6],[12,27],[27,12]].map(Object.freeze));
const root=new URL('../',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const signed=value=>value&0x8000?value-65536:value;
const ring=(core,index)=>signed(core.read(0x600+(index&63)*2));
const put=(core,index,value)=>core.write(0x600+(index&63)*2,value&65535);
const fullStack=core=>Int16Array.from({length:64},(_,i)=>ring(core,i));
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const validSlot=value=>Number.isInteger(value)&&value>=0&&value<32;
const word=(depth,x,y,off=false)=>off?0:(depth<<12)|(x<<6)|y;
let module,wasm;
async function core(){
  if(!wasm)wasm=await readFile(new URL('docs/generated/scsp_wasm.wasm',root));
  module??=factory({wasmBinary:wasm});return Scsp.create({moduleFactory:()=>module});
}

/** Simulate the pinned 64-cell write order independently of an age formula.
 * This is a zero-slot-delay model, not a claim about the physical SCSP pipeline. */
export function cycle2TapAge(source,target,offset){
  if(!validSlot(source)||!validSlot(target)||!Number.isInteger(offset)||offset<0||offset>63)throw new RangeError('Invalid physical SCSP tap');
  const cells=Array.from({length:64},(_,index)=>({source:index%32,frame:index<32?-2:-1}));
  for(let slot=0;slot<=target;slot++){
    if(slot===target){const entry=cells[(slot+offset)&63];if(entry.source!==source)throw new RangeError('Offset does not select the requested source slot');return {source:entry.source,age:entry.frame===0?0:-entry.frame};}
    cells[slot]={source:slot,frame:0};
  }
}

/** Register experiment plan. First/second refer to physical execution order;
 * logical A/B roles remain attached to their waveforms when slots are swapped. */
export function cycle2RegisterPlan({aSlot=6,bSlot=7,variant='current-forward-return1',depth=8,adapterOff=false}={}){
  if(!validSlot(aSlot)||!validSlot(bSlot)||aSlot===bSlot)throw new RangeError('Two distinct physical slots are required');
  if(!SCSP_CYCLE2_VARIANTS.includes(variant)||!Number.isInteger(depth)||depth<0||depth>12||typeof adapterOff!=='boolean')throw new TypeError('Invalid cycle experiment plan');
  const first=aSlot<bSlot?{role:'A',slot:aSlot,source:bSlot}:{role:'B',slot:bSlot,source:aSlot};
  const second=aSlot<bSlot?{role:'B',slot:bSlot,source:aSlot}:{role:'A',slot:aSlot,source:bSlot};
  const earlierSame=(second.source-second.slot+64)%64,laterSame=first.source-first.slot;
  const returnOffsets=variant==='current-forward-return2'?[laterSame,laterSame]:variant==='current-forward-average12'||variant==='two-bank-average'?[(laterSame+32)%64,laterSame]:[(laterSame+32)%64,(laterSame+32)%64];
  const forwardOffsets=variant==='both-previous1'?[(earlierSame+32)%64,(earlierSame+32)%64]:variant==='two-bank-average'?[earlierSame,(earlierSame+32)%64]:[earlierSame,earlierSame];
  for(const [entry,offsets]of [[first,returnOffsets],[second,forwardOffsets]]){
    [entry.xOffset,entry.yOffset]=offsets;entry.word=word(depth,...offsets,adapterOff);
    entry.ages=offsets.map(offset=>cycle2TapAge(entry.source,entry.slot,offset).age);
  }
  return {aSlot,bSlot,variant,depth,adapterOff,first,second};
}

// Literal reference recurrences intentionally do not consume register-plan ages
// or offsets. This independently tests both the bank formula and command words.
function expectedAges(variant){
  switch(variant){
    case 'current-forward-return1':return {first:[1,1],second:[0,0]};
    case 'current-forward-return2':return {first:[2,2],second:[0,0]};
    case 'current-forward-average12':return {first:[1,2],second:[0,0]};
    case 'both-previous1':return {first:[1,1],second:[1,1]};
    case 'two-bank-average':return {first:[1,2],second:[0,1]};
    default:throw new TypeError('Unknown recurrence');
  }
}
const waves={
  A:Int16Array.from({length:64},(_,i)=>Math.round(7200*Math.sin(i*Math.PI/32)+1500*Math.cos(i*3*Math.PI/32))),
  B:Int8Array.from({length:64},(_,i)=>Math.round(36*(2*i/64-1)+5*Math.sin(i*Math.PI/8))),
};
const initialFor=(role,stale)=>stale?(role==='A'?[7000,-3000]:[-5000,9000]):[0,0];
async function node(plan,{kind='actual',role=null,stale=false,mix='separate'}={}){
  const raw=await core(),stats={registerWrites:0,ramLoads:0,renderCalls:0,renderedFrames:0,resets:0};
  const rawWrite=raw.write.bind(raw),rawLoad=raw.loadRam.bind(raw),rawRender=raw.renderInto.bind(raw),rawReset=raw.reset.bind(raw);
  raw.write=(...args)=>{const result=rawWrite(...args);stats.registerWrites++;return result;};
  raw.loadRam=(...args)=>{const result=rawLoad(...args);stats.ramLoads++;return result;};
  raw.renderInto=(left,right,frames=left.length,offset=0)=>{rawRender(left,right,frames,offset);stats.renderCalls++;stats.renderedFrames+=frames;};
  raw.reset=(...args)=>{const result=rawReset(...args);stats.resets++;return result;};
  const synth=new ScspSynth(raw),samples={};
  assert(fullStack(raw).every(value=>value===0),'A freshly reset dedicated native instance starts with zero stack');
  for(const name of ['A','B'])samples[name]=synth.loadPCM(waves[name],{baseFrequencyHz:44100/64,loopStartSamples:0,modulationDepth:12});
  const single=kind==='isolated',early=plan.first.role,entries=single?[{role,slot:0,xOffset:1,yOffset:2}]:[plan.first,plan.second].map(entry=>kind==='cut'&&entry.role===early?{...entry,xOffset:([0,1,2,3].filter(i=>i!==plan.aSlot&&i!==plan.bSlot))[0],yOffset:([0,1,2,3].filter(i=>i!==plan.aSlot&&i!==plan.bSlot))[1]}:entry);
  // For a cut edge offsets address two unused physical slots, in the same
  // current bank as the consumer. We inject exact signed values before a frame.
  if(kind==='cut')for(const entry of entries)if(entry.role===early){entry.scratch=[entry.xOffset,entry.yOffset];entry.xOffset=(entry.xOffset-entry.slot+64)%64;entry.yOffset=(entry.yOffset-entry.slot+64)%64;}
  const slots=Object.fromEntries(entries.map(entry=>[entry.role,entry.slot]));
  let currentDepth=plan.depth,currentOff=plan.adapterOff;
  for(const entry of entries){
    const {role,slot,xOffset,yOffset}=entry;
    synth.setPreset(slot,{sample:samples[role],frequencyHz:role==='A'?440:660,totalLevel:role==='A'?12:16,directLevel:mix==='carrier'?(role==='A'?0:5):7,pan:mix==='separate'?(role==='A'?31:15):0,
      modulation:{depth:currentDepth,xOffset,yOffset,writeInhibit:false},envelope:{attackRate:31,decay1Rate:0,decay2Rate:0,decayLevel:0,releaseRate:31,keyRateScaling:15}});
    const seeds=initialFor(role,stale);put(raw,slot,seeds[0]);put(raw,slot+32,seeds[1]);
  }
  const applyWords=()=>{for(const entry of entries)raw.write(entry.slot*32+14,word(currentDepth,entry.xOffset,entry.yOffset,currentOff));};
  const keyOn=()=>{for(const entry of entries)synth.keyOn(entry.slot);applyWords();};keyOn();
  return {core:raw,synth,entries,slots,kind,role,stats,applyWords,keyOn,
    depth(depth,off=false){currentDepth=depth;currentOff=off;for(const entry of entries)synth.setModulation(entry.slot,{depth});applyWords();},
    release(){for(const entry of entries)synth.keyOff(entry.slot);},
    pitch(){for(const entry of entries)synth.setFrequency(entry.slot,entry.role==='A'?330:550);},
    stop(){synth.stopVoices();},dispose(){synth.dispose();}};
}
const one=(node,left,right)=>{node.core.renderInto(left,right,1);return [left[0],right[0]];};
const history=(role,stale)=>new Map([[-2,initialFor(role,stale)[0]],[-1,initialFor(role,stale)[1]]]);
const fetch=(map,n,age)=>{assert(map.has(n-age),`Unknown history ${n}-${age}`);return map.get(n-age);};
function resample(native,rate,frames){
  let cursor=0;
  const source={sampleRate:44100,get nativeFrames(){return cursor;},renderInto(left,right,n,offset=0){assert(cursor+n<=native.left.length);left.set(native.left.subarray(cursor,cursor+n),offset);right.set(native.right.subarray(cursor,cursor+n),offset);cursor+=n;}};
  const converter=new Pcm44100Resampler(source,rate),left=new Float32Array(frames),right=new Float32Array(frames);
  for(let offset=0;offset<frames;offset+=127)converter.render(left,right,Math.min(127,frames-offset),offset);
  return {left,right,nativeFrames:cursor};
}

/** Actual native cross-cycle versus (1) a cut return edge with independent
 * history injection and (2) one dedicated native core per operator. */
export async function probeScspCycle2({aSlot=6,bSlot=7,variant='current-forward-return1',depth=8,adapterOff=false,sampleRate=44100,frames=512,stale=true,lifecycle=false,mix='separate',wrongReturnAges=null}={}){
  if(![44100,48000].includes(sampleRate)||!Number.isInteger(frames)||frames<8||frames>8192||!['separate','center','carrier'].includes(mix))throw new TypeError('Invalid probe rendering options');
  const plan=cycle2RegisterPlan({aSlot,bSlot,variant,depth,adapterOff}),ages=expectedAges(variant),actual=await node(plan,{stale,mix}),cut=await node(plan,{kind:'cut',stale,mix}),isolated={};
  const nodes=[actual,cut],count=Math.ceil(frames*44100/sampleRate)+2;
  try{
    for(const role of ['A','B']){isolated[role]=await node(plan,{kind:'isolated',role,stale,mix});nodes.push(isolated[role]);}
    let cutHistory=history(plan.second.role,stale),isolatedHistory={A:history('A',stale),B:history('B',stale)},expectedStack=fullStack(actual.core);
    const streams=Object.fromEntries(['actual','cut','isolated'].map(name=>[name,{left:new Float32Array(count),right:new Float32Array(count)}]));
    const left=new Float32Array(1),right=new Float32Array(1),rawTrace=[],opTrace={A:[],B:[]},events=[];
    let cutExact=true,cutRawExact=true,isolatedRawExact=true,isolatedPcmExact=true,isolatedMaxNativeDifference=0;
    for(let global=0;global<count;global++){
      if(lifecycle&&[64,96,144,192,256,320].includes(global)){
        const name=({64:'adapter-depth-Off',96:'depth-On8',144:'live-pitch',192:'keyOff-release',256:'raw-retrigger',320:'global-Stop-and-retrigger'})[global];
        const before=fullStack(actual.core);
        for(const value of nodes){if(global===64)value.depth(0,true);if(global===96)value.depth(8);if(global===144)value.pitch();if(global===192)value.release();if(global===256)value.keyOn();if(global===320){value.stop();assert(fullStack(value.core).every(v=>v===0));value.keyOn();}}
        if(global!==320)assert.deepEqual(fullStack(actual.core),before,'Parameter/key transitions cannot silently clear raw history');
        else{cutHistory=history(plan.second.role,false);isolatedHistory={A:history('A',false),B:history('B',false)};expectedStack.fill(0);}
        events.push({globalNativeFrame:global,nativeEpochFrame:actual.core.nativeFrames,action:name,historyRetained:global!==320,globalReset:global===320});
      }
      const n=actual.core.nativeFrames,bank=(n%2)*32,cutEntry=cut.entries.find(e=>e.role===plan.first.role),cutAges=wrongReturnAges??ages.first;
      assert(nodes.every(value=>value.core.nativeFrames===n),'All independent cores remain on the same native epoch frame');
      for(let tap=0;tap<2;tap++)put(cut.core,bank+cutEntry.scratch[tap],fetch(cutHistory,n,cutAges[tap]));
      const a=one(actual,left,right),b=one(cut,left,right);
      for(const scratch of cutEntry.scratch)for(const page of [0,32]){assert.equal(ring(actual.core,scratch+page),0);put(cut.core,scratch+page,0);}
      const cutRaw=ring(cut.core,bank+plan.second.slot);cutHistory.set(n,cutRaw);
      const singlePcm={};
      for(const entry of [plan.first,plan.second]){
        const source=entry===plan.first?plan.second.role:plan.first.role,sourceAges=entry===plan.first?ages.first:ages.second,single=isolated[entry.role];
        for(let tap=0;tap<2;tap++)put(single.core,bank+1+tap,fetch(isolatedHistory[source],n,sourceAges[tap]));
        singlePcm[entry.role]=one(single,left,right);const sample=ring(single.core,bank);isolatedHistory[entry.role].set(n,sample);expectedStack[bank+entry.slot]=sample;
      }
      const expected=[singlePcm.A[0]+singlePcm.B[0],singlePcm.A[1]+singlePcm.B[1]],currentStack=fullStack(actual.core);
      for(let channel=0;channel<2;channel++){
        streams.actual[channel?'right':'left'][global]=a[channel];streams.cut[channel?'right':'left'][global]=b[channel];streams.isolated[channel?'right':'left'][global]=expected[channel];
        if(a[channel]!==b[channel])cutExact=false;if(a[channel]!==expected[channel])isolatedPcmExact=false;
        isolatedMaxNativeDifference=Math.max(isolatedMaxNativeDifference,Math.abs(a[channel]-expected[channel]));
      }
      const cutStack=fullStack(cut.core);if(!Array.from(currentStack).every((v,i)=>v===cutStack[i]))cutRawExact=false;
      if(!wrongReturnAges)assert.deepEqual(cutStack,currentStack,'Full ring state matches after restoring scratch cells');
      if(!Array.from(currentStack).every((v,i)=>v===expectedStack[i]))isolatedRawExact=false;
      if(!wrongReturnAges)assert.deepEqual(currentStack,expectedStack,'Separate per-OP native recurrences reproduce every raw stack cell');
      rawTrace.push(currentStack);for(const role of ['A','B'])opTrace[role].push(ring(actual.core,bank+plan[role==='A'?'aSlot':'bSlot']));
    }
    if(!wrongReturnAges){assert(cutExact&&cutRawExact,'Cut-edge native PCM and restored full ring must be exact');assert(isolatedRawExact,'Isolated per-OP raw values must be exact');if(mix!=='center')assert(isolatedPcmExact,'Independently mixed per-OP PCM must be exact');}
    const pcm=resample(streams.actual,sampleRate,frames),cutPcm=resample(streams.cut,sampleRate,frames),singlePcm=resample(streams.isolated,sampleRate,frames);
    if(!wrongReturnAges){assert.deepEqual(cutPcm,pcm);if(mix!=='center')assert.deepEqual(singlePcm,pcm);}
    assert(isolatedMaxNativeDifference<=1/32768,'Independent centered PCM rounding differs by at most one native 16-bit LSB');
    const isolatedMaxOutputDifference=Math.max(...pcm.left.map((value,index)=>Math.abs(value-singlePcm.left[index])),...pcm.right.map((value,index)=>Math.abs(value-singlePcm.right[index])));
    const peak=Math.max(...pcm.left.map(Math.abs),...pcm.right.map(Math.abs));assert(peak<.98&&pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite),'Finite output without mixer clipping');
    return {aSlot,bSlot,variant,depth,adapterOff,sampleRate,frames,stale,lifecycle,mix,registerPlan:plan,nativeFramesCompared:count,resamplerConsumedNativeFrames:pcm.nativeFrames,nativeEpochFrames:actual.core.nativeFrames,
      cutEdgeExactPcm:cutExact,cutEdgeExactRestoredRawStack:cutRawExact,isolatedExactRawStack:isolatedRawExact,isolatedExactPcm:isolatedPcmExact,isolatedMaxNativeDifference,isolatedMaxNativeDifferenceLsb:isolatedMaxNativeDifference*32768,isolatedMaxOutputDifference,isolatedMaxOutputDifferenceLsb:isolatedMaxOutputDifference*32768,independentNativeEpochsExact:true,finite:true,peak,
      nativeCommandStats:{actual:actual.stats,cutEdge:cut.stats,isolatedA:isolated.A.stats,isolatedB:isolated.B.stats},
      pcmLeftSha256:sha(Buffer.from(pcm.left.buffer)),pcmRightSha256:sha(Buffer.from(pcm.right.buffer)),rawStackSha256:sha(Buffer.concat(rawTrace.map(v=>Buffer.from(v.buffer)))),operatorRawSha256:Object.fromEntries(['A','B'].map(role=>[role,sha(Buffer.from(Int16Array.from(opTrace[role]).buffer))])),events};
  }finally{for(const value of nodes)value.dispose();}
}

/** Raw dedicated-instance history behavior, separate from Synth allocation. */
export async function probeScspCycle2HistoryPolicy(){
  const plan=cycle2RegisterPlan({variant:'current-forward-average12'}),value=await node(plan,{stale:true}),left=new Float32Array(8192),right=new Float32Array(8192);
  try{
    const cells=[6,38,7,39],seeds=[7000,-3000,-5000,9000];assert.deepEqual(cells.map(cell=>ring(value.core,cell)),seeds);
    value.keyOn();assert.deepEqual(cells.map(cell=>ring(value.core,cell)),seeds);
    value.core.renderInto(left,right,257);value.release();value.core.renderInto(left,right,8192);
    const markers=[1234,-4567,8910,-1121];cells.forEach((cell,index)=>put(value.core,cell,markers[index]));const inactive=fullStack(value.core);
    value.core.renderInto(left,right,128);assert.deepEqual(fullStack(value.core),inactive,'Inactive sources retain old stack data rather than producing zeros');
    value.keyOn();assert.deepEqual(cells.map(cell=>ring(value.core,cell)),markers);
    const replacement=value.synth.getState().slots[7].sample;value.synth.setPreset(6,{sample:replacement,frequencyHz:523.25});value.synth.keyOn(6);value.applyWords();assert.deepEqual(cells.map(cell=>ring(value.core,cell)),markers,'A physical-slot sample reuse does not clear native history');
    const ram=value.core.readRam();value.stop();assert(fullStack(value.core).every(v=>v===0));assert.deepEqual(value.core.readRam(),ram);
    value.keyOn();value.depth(0,true);for(const entry of value.entries)value.synth.setMix(entry.slot,{directLevel:0});value.core.renderInto(left,right,2);
    assert(left.subarray(0,2).every(v=>v===0)&&right.subarray(0,2).every(v=>v===0));const primed=fullStack(value.core);assert(cells.every(cell=>primed[cell]!==0));
    value.depth(8);value.synth.setMix(7,{directLevel:5});assert.deepEqual(fullStack(value.core),primed,'Live enable uses the primed histories without retriggering');
    return {freshDedicatedResetStartsZero:true,keyOnRetainsExplicitSeeds:true,releaseEventuallyStopsStackWrites:true,inactiveMarkersRetained:true,retriggerRetainsMarkers:true,physicalSlotSampleReuseRetainsMarkers:true,globalStopClearsAll64:true,globalStopRetainsPcmRam:true,
      mutedOffPrimeFrames:2,mutedOffPrimePcmExactlySilent:true,mutedOffPrimeOverwritesBothBanks:true,liveEnablePreservesPrimedHistory:true,
      primingLimit:'The native probe advances exactly two frames. An ordinary JavaScript wait in Playground has no sample-accurate start guarantee; use it only as a minimum muted warm-up, not as a promise of identical phase/history.',nativeCommandStats:value.stats};
  }finally{value.dispose();}
}

export async function measureScspCycle2Research({onProgress=()=>{}}={}){
  const cases=[];
  for(const [aSlot,bSlot]of SCSP_CYCLE2_PLACEMENTS)for(const variant of SCSP_CYCLE2_VARIANTS)for(const mode of ['adapterOff','native0',1,4,8,12])for(const sampleRate of [44100,48000]){
    cases.push(await probeScspCycle2({aSlot,bSlot,variant,depth:typeof mode==='number'?mode:0,adapterOff:mode==='adapterOff',sampleRate}));
    if(cases.length%100===0)onProgress(cases.length);
  }
  const lifecycle=[];
  for(const [aSlot,bSlot]of [[6,7],[7,6],[0,31],[31,0]])for(const variant of SCSP_CYCLE2_VARIANTS)for(const sampleRate of [44100,48000])lifecycle.push(await probeScspCycle2({aSlot,bSlot,variant,sampleRate,frames:1024,lifecycle:true}));
  const center=[];for(const variant of SCSP_CYCLE2_VARIANTS)for(const sampleRate of [44100,48000])center.push(await probeScspCycle2({variant,sampleRate,mix:'center'}));
  const carrier=[];for(const variant of SCSP_CYCLE2_VARIANTS)for(const sampleRate of [44100,48000])carrier.push(await probeScspCycle2({variant,sampleRate,mix:'carrier'}));
  const wrong=[];for(const ages of [[2,2],[1,2]]){const value=await probeScspCycle2({depth:8,wrongReturnAges:ages});assert.equal(value.cutEdgeExactPcm,false);wrong.push({wrongReturnAges:ages,cutEdgeExactPcm:value.cutEdgeExactPcm});}
  const historyPolicy=await probeScspCycle2HistoryPolicy();
  const groups=new Map();for(const c of cases.filter(c=>c.depth>=4&&c.variant.startsWith('current-forward-'))){const key=JSON.stringify([c.aSlot,c.bSlot,c.depth,c.sampleRate]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c.rawStackSha256);}
  assert([...groups.values()].every(values=>new Set(values).size===3),'High-depth history alternatives must be empirically distinguishable');
  const sourceNames=['scripts/probe_scsp_fm_cycle2.mjs','scripts/scsp_fm_cycle2.test.mjs','docs/js/scsp.js','docs/js/scspsynth.js','docs/js/pcm_44100_resampler.js','third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp','third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h'];
  const sources=Object.fromEntries(await Promise.all(sourceNames.map(async name=>[name,record(await readFile(new URL(name,root)))])));
  return {schemaVersion:1,scope:'scsp-two-operator-cross-cycle-native-research',baseCommit:SCSP_CYCLE2_RESEARCH_BASE,deviceOpened:false,nativeSampleRate:44100,coreWasm:record(wasm),sources,
    reference:'Actual two-OP core compared with a return-edge cut into two unused ring cells, using its own logged source history. The cut-edge full64-ring comparison is after restoring those scratch cells, and actual scratch cells must remain zero. The separate-OP model combines the two dedicated cores post-frame slot samples into their actual physical cells, retaining known initial/inactive cells elsewhere; that complete64-cell image must equal the actual ring. No Synth routing/command helper is imported.',
    mixing:'Main cases pan A left and B right so the independent single-OP PCM has identical integer mixing. Center-output cases require cut-edge exact PCM and isolated exact raw stack; independently rounded single-OP PCM differs by at most one native 16-bit LSB when summed. Carrier cases use A directLevel0/B directLevel5 with centered output and retain exact separate-core PCM. Direct output muting does not mute the stack feedback.',
    history:'Raw fresh instances start with zero history. Explicit stale histories survive keyOn, live edits, release and retrigger; only core Stop/reset clears all ring cells. This prototype does not change production history semantics.',
    tapAgeAssumption:'Nominal ages describe source generations while that source writes continuously. Inactive sources or inhibited stack writes can retain older values; the bank selection does not manufacture a fresh zero sample.',
    timing:'Native taps are measured at 44100 Hz; the same native PCM is streamed through the existing resampler at44100/48000 Hz. No setTimeout schedule or physical audio device is used.',
    voices:{A:{format:'signed PCM16',samples:64,initialFrequencyHz:440,totalLevel:12},B:{format:'signed PCM8',samples:64,initialFrequencyHz:660,totalLevel:16},loopStartSamples:0,modulationPadding:12,initialStaleHistory:{A:[7000,-3000],B:[-5000,9000]},nominalDepthCodes:[0,1,4,8,12]},
    cases,lifecycle,center,carrier,historyPolicy,wrongHistoryModels:wrong,highDepthDistinctGroups:groups.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),usage='Usage: node scripts/probe_scsp_fm_cycle2.mjs [report.json]\nResearch only: offline native SCSP; no physical audio device. Default report: build/scsp-cycle2-20261118/native-research.json';
  if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
  assert(args.length<=1&&(!args.length||!args[0].startsWith('-')&&args[0].toLowerCase().endsWith('.json')),usage);
  const out=args[0]??'build/scsp-cycle2-20261118/native-research.json';
  const report=await measureScspCycle2Research({onProgress:n=>console.log(`SCSP cycle2 research ${n}/600 cases`)});await mkdir(resolve(out,'..'),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({cases:report.cases.length,lifecycle:report.lifecycle.length,center:report.center.length,carrier:report.carrier.length,wrong:report.wrongHistoryModels,deviceOpened:report.deviceOpened,highDepthDistinctGroups:report.highDepthDistinctGroups},null,2));
}
