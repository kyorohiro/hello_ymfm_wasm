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
import {createScspFmDepthRevisionReadContext} from './mixer_calibration_scsp_fm_depth_revision.mjs';

export const SCSP_FM_MULTI_PARITY_BASE_COMMIT='81f5e7e591e4fdbf6f375ea97061eb6c514f3e97';
export const SCSP_FM_MULTI_PARITY_RECEIPT='docs/issues/scsp_fm_multi_source_revision_01.json';
export const SCSP_FM_MULTI_PARITY_REPORT='docs/issues/scsp_fm_multi_default_parity_01.json';
const predecessors=Object.freeze({
  'docs/synth-scsp/routing.js':'38edc71d46015b51c961f66e1775b84cb80d053c8c353dca3b36ed286a0c89cc',
  'docs/synth-scsp/patch.js':'8984615d18cdd29da641bc6ae0c8e67c18f8d66118fcc890d0bbb8bde9a50306',
  'docs/synth-scsp/instrument.js':'1c3040935033a465dd611633c2b6d6a4dead584b69e398e339a01d99953c63d5',
});
const root=new URL('../',import.meta.url),path=name=>new URL(name,root);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});
const floats=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength);
export function reconstructScspFmMultiParityPredecessor(name,current,receipt){
  const pin=predecessors[name],entry=receipt.sources[name];
  current=createScspFmDepthRevisionReadContext().restore(name,current);
  assert(pin,'Only independently pinned Synth predecessors may be loaded');
  assert.equal(receipt.baseCommit,SCSP_FM_MULTI_PARITY_BASE_COMMIT);
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
function exercise(owner,scenario,frequencyHz,dspEnabled,config=null){
  const chunks=[],states=[],i=owner.instrument,render=frames=>{states.push(metadata(i));chunks.push(owner.render(frames));};
  const pcm=scenario==='pcm8'?Int8Array.from({length:64},(_,n)=>Math.round(40*Math.sin(n*Math.PI/32))):Int16Array.from({length:64},(_,n)=>Math.round(8192*Math.sin(n*Math.PI/32)));
  i.invoke('applyPCM',[0,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  if(config?.fm?.algorithm==='custom'){
    i.invoke('applyPCM',[1,Int16Array.from({length:64},(_,n)=>Math.round(6000*(2*n/63-1))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
    i.invoke('setMix',[1,{pan:23,totalLevel:19}]);
  }
  if(config)i.setConfig(config);
  i.setEffect({enabled:dspEnabled,timeMs:20,feedback:.25});
  render(256);i.noteOn('baseline',69+12*Math.log2(frequencyHz/440));render(2048);
  i.invoke('setMix',[0,{pan:15,totalLevel:21}]);
  if(config){i.setConfig({fm:{depth:7,ratios:[1,1.5,2,2.5,3,3.5]}});i.invoke('setMix',[1,{totalLevel:33}]);}
  render(512);
  i.noteOff('baseline');render(4096);owner.stop();render(2048);
  const count=chunks.reduce((n,v)=>n+v.left.length,0),left=new Float32Array(count),right=new Float32Array(count);
  let at=0;for(const chunk of chunks){left.set(chunk.left,at);right.set(chunk.right,at);at+=chunk.left.length;}
  // Snapshot the native API's complete readable map, not unmapped holes.
  const addresses=[...Array.from({length:512},(_,index)=>index*2),0x400,0x402,0x408,
    ...Array.from({length:(0xee2-0x600)/2+1},(_,index)=>0x600+index*2)];
  const registers=Uint16Array.from(addresses,address=>owner.core.read(address));
  return {left,right,states,state:metadata(i),ram:owner.core.readRam(),registers,preset:i.exportPatch()};
}
function normalize(value){
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='bankId'?'independent-bank':normalize(item)]));
  return value;
}
export async function measureScspFmMultiDefaultParity({predecessorSources=null}={}){
  const reviewed=createScspFmDepthRevisionReadContext(),currentSources={};
  const receipt=predecessorSources?null:JSON.parse(await readFile(path(SCSP_FM_MULTI_PARITY_RECEIPT),'utf8')),originals={},sources={};
  for(const name of Object.keys(predecessors)){
    const current=reviewed.readSource(path(name));sources[name]=record(current);currentSources[name]=current.toString();
    if(predecessorSources){
      const bytes=Buffer.from(predecessorSources[name]);assert.equal(sha(bytes),predecessors[name],'Independent base81 source');originals[name]=bytes.toString();
    }else originals[name]=reconstructScspFmMultiParityPredecessor(name,current,receipt);
  }
  const Before=await beforeInstrument(originals),After=await beforeInstrument(currentSources),wasmBinary=await readFile(path('docs/generated/scsp_wasm.wasm'));
  const cases=[],scenarios=[];
  for(const sampleRate of [44100,48000])for(const scenario of ['pcm8','pcm16'])for(const frequencyHz of [220,440,880])for(const dspEnabled of [false,true])
    scenarios.push({kind:'pcm',sampleRate,scenario,frequencyHz,dspEnabled});
  for(const sampleRate of [44100,48000])for(const mode of ['fm2','fm4','fm6'])for(const algorithm of ['chain','pairs','branch'])
    scenarios.push({kind:'fm',sampleRate,scenario:'pcm16',frequencyHz:440,dspEnabled:true,mode,algorithm});
  for(const sampleRate of [44100,48000])for(const [graph,inputs] of [
    ['parallel',[[],[]]],['b-to-a',[[1],[]]],['a-to-b',[[],[0]]],
  ])for(const outputs of [[],[0],[1],[0,1]])
    scenarios.push({kind:'custom2',sampleRate,scenario:'pcm16',frequencyHz:440,dspEnabled:true,graph,outputs,presetVersion:5,inputs});
  for(const item of scenarios){
    const {sampleRate,scenario,frequencyHz,dspEnabled}=item;
    const before=await owner(Before,sampleRate,wasmBinary),after=await owner(After,sampleRate,wasmBinary);
    try{
      const config=item.kind==='fm'?{mode:item.mode,fm:{algorithm:item.algorithm}}:item.kind==='custom2'?{mode:'fm2',fm:{algorithm:'custom',custom:{inputs:item.inputs,outputs:item.outputs}}}:null;
      const a=exercise(before,scenario,frequencyHz,dspEnabled,config),b=exercise(after,scenario,frequencyHz,dspEnabled,config),label=JSON.stringify(item);
      assert.deepEqual(b.left,a.left,label+' left PCM');assert.deepEqual(b.right,a.right,label+' right PCM');
      assert.deepEqual(b.ram,a.ram,label+' full PCM and Delay RAM');assert.deepEqual(b.state,a.state,label+' legacy state');
      assert.deepEqual(b.states,a.states,label+' active/keyoff/stopped state snapshots');
      assert.deepEqual(b.registers,a.registers,label+' final registers');
      assert.deepEqual(normalize(after.trace),normalize(before.trace),label+' exact effective write sequence');
      assert.deepEqual(b.preset,a.preset,label+' legacy v4 preset');assert.equal(b.preset.version,item.kind==='custom2'?5:4);
      assert.equal(JSON.stringify(b.preset),JSON.stringify(a.preset),label+' exact v4/v5 serialized export');
      assert(b.left.every(Number.isFinite)&&b.right.every(Number.isFinite));
      cases.push({...item,stereoFrames:b.left.length,
        exactPcmEqual:true,exactRamEqual:true,legacyStateEqual:true,exactRegistersEqual:true,exactEffectiveWriteTraceEqual:true,exactPresetEqual:true,
        pcmLeftSha256:sha(floats(b.left)),pcmRightSha256:sha(floats(b.right)),ramSha256:sha(b.ram),registersSha256:sha(Buffer.from(b.registers.buffer)),traceSha256:sha(JSON.stringify(normalize(after.trace))),stateSnapshotsSha256:sha(JSON.stringify(b.states)),presetSha256:sha(JSON.stringify(b.preset))});
    }finally{before.dispose();after.dispose();}
  }
  return {schemaVersion:1,scope:'scsp-synth-multi-legacy-pcm-fixed-fm-custom2-parity',baseCommit:SCSP_FM_MULTI_PARITY_BASE_COMMIT,
    deviceOpened:false,reference:'Exact pre-multi-routing owner, patch and routing sources reconstructed without Git and executed with unchanged SCSP WASM.',
    tracePolicy:'Compare every effective register and RAM write without exclusions; final complete readable register state is exact.',
    statePolicy:'Normalize independent bank IDs only; compare active, edited, keyoff and stopped state snapshots. Every legacy state and v4/v5 preset field must match. Include all twelve former two-operator graph/output combinations.',
    sources,binary:record(wasmBinary),predecessors:Object.fromEntries(Object.keys(predecessors).map(name=>[name,record(Buffer.from(originals[name]))])),cases};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===0||args.length===1&&args[0]==='--check','Usage: node scripts/record_scsp_fm_multi_default_parity.mjs [--check]');
  const report=await measureScspFmMultiDefaultParity(),text=JSON.stringify(report,null,2)+'\n';
  if(args[0]==='--check')assert.equal(await readFile(path(SCSP_FM_MULTI_PARITY_REPORT),'utf8'),text);else await writeFile(path(SCSP_FM_MULTI_PARITY_REPORT),text);
  console.log(`SCSP Synth multi legacy PCM/fixed-FM/Custom2 parity: ${report.cases.length} cases PASS; no device opened.`);
}
