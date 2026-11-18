// SPDX-License-Identifier: BSD-3-Clause
// Exact Synth PCM/fixed-FM/old Custom2 comparison. No AudioContext or output device is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp} from '../docs/js/scsp.js';
import {Pcm44100Resampler} from '../docs/js/pcm_44100_resampler.js';
import {SynthInstrument} from '../docs/synth-scsp/instrument.js';

export const SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_BASE_COMMIT='d76285ad9b0eb786ce77cdd77272d5398047d185';
export const SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_RECEIPT='docs/issues/scsp_fm_multi_self_feedback_source_revision_01.json';
export const SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_REPORT='docs/issues/scsp_fm_multi_self_feedback_default_parity_01.json';
const predecessors=Object.freeze({
  'docs/synth-scsp/routing.js':'5606bd6f099cf43e05d9b64d34db39b462de7c8df40303e3f8497fb67d952183',
  'docs/synth-scsp/patch.js':'cec5cf6e9c41f0bc63534b5769af538c59998ccd65a247564a0dcbf9e9729562',
  'docs/synth-scsp/instrument.js':'5e67487c4d5f776ccf5e83179b9289f4c886a47c44d96f926cdc0b09d75ccb39',
});
const root=new URL('../',import.meta.url),path=name=>new URL(name,root);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});
const floats=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength);
export function reconstructScspFmMultiSelfFeedbackParityPredecessor(name,current,receipt){
  const pin=predecessors[name],entry=receipt.sources[name];
  assert(pin,'Only independently pinned Synth predecessors may be loaded');
  assert.equal(receipt.baseCommit,SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_BASE_COMMIT);
  assert.deepEqual(record(current),entry.after,'Current complete Synth source');
  const parts=[];let cursor=0;
  for(const h of entry.reverseHunks){
    assert(Number.isSafeInteger(h.afterOffset)&&h.afterOffset>=cursor&&h.afterOffset+h.afterBytes<=current.length);
    parts.push(current.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;
  }
  parts.push(current.subarray(cursor));const before=Buffer.concat(parts);
  assert.deepEqual(record(before),entry.before);assert.equal(sha(before),pin,'Independent complete pre-UI Synth identity');
  return before.toString();
}
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function absoluteImports(source,filename,replacements={}){
  return source.replace(/from\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g,(_all,quote,name)=>{
    const target=new URL(name,path(filename)),clean=target.href.split('?')[0];
    return 'from '+quote+(replacements[clean]??target.href)+quote;
  });
}
async function beforeInstrument(originals){
  const routingPath='docs/synth-scsp/routing.js',patchPath='docs/synth-scsp/patch.js',instrumentPath='docs/synth-scsp/instrument.js';
  const routing=dataUrl(absoluteImports(originals[routingPath],routingPath));
  const patch=dataUrl(absoluteImports(originals[patchPath],patchPath,{[path(routingPath).href]:routing}));
  return (await import(dataUrl(absoluteImports(originals[instrumentPath],instrumentPath,{
    [path(routingPath).href]:routing,[path(patchPath).href]:patch,
  })))).SynthInstrument;
}
function metadata(instrument){
  const state=structuredClone(instrument.read());
  const normalize=value=>{
    if(Array.isArray(value))return value.map(normalize);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='bankId'?'independent-bank':normalize(item)]));
    return value;
  };
  return normalize(state);
}
async function owner(Class,rate,wasmBinary){
  const core=await Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary}}),trace=[];
  const write=core.write.bind(core),load=core.loadRam.bind(core);
  core.write=(address,value,mask)=>{write(address,value,mask);trace.push({address,value:core.read(address),mask:mask??0xffff});};
  core.loadRam=(bytes,address=0)=>{load(bytes,address);trace.push({ram:address,bytes:bytes.length,sha256:sha(bytes)});};
  const instrument=new Class(core),converter=new Pcm44100Resampler(instrument.synth,rate);
  return {core,instrument,trace,render(frames){const left=new Float32Array(frames),right=new Float32Array(frames);converter.render(left,right);return {left,right};},stop(){instrument.stopVoices();converter.reset();},dispose(){instrument.dispose();}};
}
function exercise(owner,scenario,frequencyHz,dspEnabled,config=null,retrigger=false){
  const chunks=[],states=[],registerSnapshots=[],rawStacks=[],i=owner.instrument;
  const addresses=[...Array.from({length:512},(_,index)=>index*2),0x400,0x402,0x408,
    ...Array.from({length:(0xee2-0x600)/2+1},(_,index)=>0x600+index*2)];
  const observe=()=>{states.push(metadata(i));registerSnapshots.push(Uint16Array.from(addresses,address=>owner.core.read(address)));
    rawStacks.push(Uint16Array.from({length:64},(_,index)=>owner.core.read(0x600+index*2)));};
  const render=frames=>{observe();chunks.push(owner.render(frames));observe();};
  const pcm=scenario==='pcm8'?Int8Array.from({length:64},(_,n)=>Math.round(40*Math.sin(n*Math.PI/32))):Int16Array.from({length:64},(_,n)=>Math.round(8192*Math.sin(n*Math.PI/32)));
  i.invoke('applyPCM',[0,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  if(config?.fm?.algorithm==='custom'){
    i.invoke('applyPCM',[1,Int16Array.from({length:64},(_,n)=>Math.round(6000*(2*n/63-1))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
    i.invoke('setMix',[1,{pan:23,totalLevel:19}]);
  }
  if(config)i.setConfig(config);
  i.setEffect({enabled:dspEnabled,timeMs:20,feedback:.25});
  const session=retrigger?i.beginCode().session:null;
  render(256);if(retrigger)i.code(session,'noteOn',[0,'A4']);else i.noteOn('baseline',69+12*Math.log2(frequencyHz/440));render(2048);
  if(retrigger){i.code(session,'noteOn',[0,'C5']);render(257);}
  i.invoke('setMix',[0,{pan:15,totalLevel:21}]);
  if(config){i.setConfig({fm:{depth:7,...(config.fm.depths?{depths:config.fm.depths.map(value=>value===12?11:value+1)}:{}),ratios:[1,1.5,2,2.5,3,3.5]}});i.invoke('setMix',[1,{totalLevel:33}]);}
  render(512);
  if(retrigger)i.code(session,'noteOff',[0]);else i.noteOff('baseline');render(4096);owner.stop();render(2048);
  const count=chunks.reduce((n,v)=>n+v.left.length,0),left=new Float32Array(count),right=new Float32Array(count);
  let at=0;for(const chunk of chunks){left.set(chunk.left,at);right.set(chunk.right,at);at+=chunk.left.length;}
  // Snapshot the native API's complete readable map, not unmapped holes.
  const registers=Uint16Array.from(addresses,address=>owner.core.read(address));
  return {left,right,states,registerSnapshots,rawStacks,state:metadata(i),ram:owner.core.readRam(),registers,preset:i.exportPatch()};
}
function normalize(value){
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='bankId'?'independent-bank':normalize(item)]));
  return value;
}
export async function measureScspFmMultiSelfFeedbackDefaultParity({predecessorSources=null}={}){
  const receipt=predecessorSources?null:JSON.parse(await readFile(path(SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_RECEIPT),'utf8')),originals={},sources={};
  for(const name of Object.keys(predecessors)){
    const current=await readFile(path(name));sources[name]=record(current);
    if(predecessorSources){
      const bytes=Buffer.from(predecessorSources[name]);assert.equal(sha(bytes),predecessors[name],'Independent based762 source');originals[name]=bytes.toString();
    }else originals[name]=reconstructScspFmMultiSelfFeedbackParityPredecessor(name,current,receipt);
  }
  const Before=await beforeInstrument(originals),wasmBinary=await readFile(path('docs/generated/scsp_wasm.wasm'));
  const cases=[],scenarios=[];
  for(const sampleRate of [44100,48000])for(const scenario of ['pcm8','pcm16'])for(const frequencyHz of [220,440,880])for(const dspEnabled of [false,true])
    scenarios.push({kind:'pcm',sampleRate,scenario,frequencyHz,dspEnabled});
  for(const sampleRate of [44100,48000])for(const mode of ['fm2','fm4','fm6'])for(const algorithm of ['chain','pairs','branch'])
    scenarios.push({kind:'fm',sampleRate,scenario:'pcm16',frequencyHz:440,dspEnabled:true,mode,algorithm});
  for(const sampleRate of [44100,48000])for(const [graph,inputs] of [
    ['parallel',[[],[]]],['b-to-a',[[1],[]]],['a-to-b',[[],[0]]],
  ])for(const outputs of [[],[0],[1],[0,1]])
    scenarios.push({kind:'custom2',sampleRate,scenario:'pcm16',frequencyHz:440,dspEnabled:true,graph,outputs,presetVersion:5,inputs});
  for(const sampleRate of [44100,48000])for(const [graph,inputs,depths] of [
    ['self-a',[[0],[]],null],['self-a-to-b',[[0],[0]],[5,8,9,9,9,9]],
    ['self-b',[[],[1]],null],['self-b-to-a',[[1],[1]],[8,5,9,9,9,9]],
  ])for(const outputs of [[],[0],[1],[0,1]])
    scenarios.push({kind:'self2',sampleRate,scenario:'pcm16',frequencyHz:440,dspEnabled:true,graph,inputs,outputs,presetVersion:8,selfRetriggerTested:true,selfRetriggerOwner:'code',...(depths?{depths}:{})});
  for(const sampleRate of [44100,48000])for(const [mode,graph,inputs,outputs,depths] of [
    ['fm4','merge-fanout',[[1,2],[3],[3],[]],[0,2],null],
    ['fm4','reverse-merge',[[],[0],[0],[1,2]],[2,3],[5,7,9,3,9,9]],
    ['fm4','disconnected-pairs',[[2],[],[],[1]],[0,3],null],
    ['fm6','merge-fanout',[[3,4],[0],[],[5],[2],[]],[0,1,4],null],
    ['fm6','reverse-merge',[[],[],[0,1],[1],[2,3],[4]],[4,5],[4,6,8,5,7,9]],
    ['fm6','disconnected-chains',[[1],[2],[],[4],[5],[]],[0,3],null],
  ])scenarios.push({kind:'custom-multi',sampleRate,scenario:'pcm16',frequencyHz:440,dspEnabled:true,mode,graph,inputs,outputs,presetVersion:depths?7:6,...(depths?{depths}:{})});
  for(const item of scenarios){
    const {sampleRate,scenario,frequencyHz,dspEnabled}=item;
    const before=await owner(Before,sampleRate,wasmBinary),after=await owner(SynthInstrument,sampleRate,wasmBinary);
    try{
      const config=item.kind==='fm'?{mode:item.mode,fm:{algorithm:item.algorithm}}:['custom2','self2','custom-multi'].includes(item.kind)?{mode:item.mode??'fm2',fm:{algorithm:'custom',custom:{inputs:item.inputs,outputs:item.outputs},...(item.depths?{depths:item.depths}:{})}}:null;
      const a=exercise(before,scenario,frequencyHz,dspEnabled,config,item.kind==='self2'),b=exercise(after,scenario,frequencyHz,dspEnabled,config,item.kind==='self2'),label=JSON.stringify(item);
      assert.deepEqual(b.left,a.left,label+' left PCM');assert.deepEqual(b.right,a.right,label+' right PCM');
      assert.deepEqual(b.ram,a.ram,label+' full PCM and Delay RAM');assert.deepEqual(b.state,a.state,label+' legacy state');
      assert.deepEqual(b.states,a.states,label+' active/keyoff/stopped state snapshots');
      assert.deepEqual(b.registerSnapshots,a.registerSnapshots,label+' complete register snapshot sequence');
      assert.deepEqual(b.rawStacks,a.rawStacks,label+' all 64 raw sound-stack cells at every checkpoint');
      assert.deepEqual(b.registers,a.registers,label+' final registers');
      assert.deepEqual(normalize(after.trace),normalize(before.trace),label+' exact effective write sequence');
      assert.deepEqual(b.preset,a.preset,label+' legacy v4 preset');assert.equal(b.preset.version,item.presetVersion??(item.kind==='custom2'?5:4));
      assert.equal(JSON.stringify(b.preset),JSON.stringify(a.preset),label+' exact v4/v5 serialized export');
      assert(b.left.every(Number.isFinite)&&b.right.every(Number.isFinite));
      cases.push({...item,stereoFrames:b.left.length,
        exactPcmEqual:true,exactRamEqual:true,legacyStateEqual:true,exactRegistersEqual:true,exactEffectiveWriteTraceEqual:true,exactPresetEqual:true,exactRegisterSnapshotsEqual:true,exactRawStackEqual:true,exactStateSnapshotsEqual:true,
        pcmLeftSha256:sha(floats(b.left)),pcmRightSha256:sha(floats(b.right)),ramSha256:sha(b.ram),registersSha256:sha(Buffer.from(b.registers.buffer)),traceSha256:sha(JSON.stringify(normalize(after.trace))),stateSnapshotsSha256:sha(JSON.stringify(b.states)),registerSnapshotsSha256:sha(Buffer.concat(b.registerSnapshots.map(values=>Buffer.from(values.buffer)))),rawStackTraceSha256:sha(Buffer.concat(b.rawStacks.map(values=>Buffer.from(values.buffer)))),presetSha256:sha(JSON.stringify(b.preset))});
    }finally{before.dispose();after.dispose();}
  }
  return {schemaVersion:1,scope:'scsp-synth-multi-self-feedback-legacy-and-custom2-self-parity',baseCommit:SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_BASE_COMMIT,
    deviceOpened:false,reference:'Exact pre-multi-self-feedback owner, patch and routing sources reconstructed without Git and executed with unchanged SCSP WASM.',
    tracePolicy:'Compare every effective register and RAM write without exclusions; final complete readable register state is exact.',
    statePolicy:'Normalize independent bank IDs only; compare active, edited, keyoff and stopped state snapshots. Every legacy state and serialized v4/v5/v6/v7/v8 preset field must match. Include all sixteen prior Custom2 self graph/output combinations with real same-lane Code retriggers, mixed MDL and raw-stack checkpoints, plus six former non-self four/six-OP graphs.',
    sources,binary:record(wasmBinary),predecessors:Object.fromEntries(Object.keys(predecessors).map(name=>[name,record(Buffer.from(originals[name]))])),cases};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===0||args.length===1&&args[0]==='--check','Usage: node scripts/record_scsp_fm_multi_self_feedback_default_parity.mjs [--check]');
  const report=await measureScspFmMultiSelfFeedbackDefaultParity(),text=JSON.stringify(report,null,2)+'\n';
  if(args[0]==='--check')assert.equal(await readFile(path(SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_REPORT),'utf8'),text);else await writeFile(path(SCSP_FM_MULTI_SELF_FEEDBACK_PARITY_REPORT),text);
  console.log(`SCSP Synth multi-self-feedback legacy and Custom2-self parity: ${report.cases.length} cases PASS; no device opened.`);
}
