// SPDX-License-Identifier: BSD-3-Clause
// Exact Synth default PCM comparison. No AudioContext or output device is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp} from '../docs/js/scsp.js';
import {Pcm44100Resampler} from '../docs/js/pcm_44100_resampler.js';
import {createScspFmCustom2RevisionReadContext} from './mixer_calibration_scsp_fm_custom_revision.mjs';

export const SCSP_DSP_UI_PARITY_BASE_COMMIT='176eb363ef9533f9d226b4e0eed6800ac1b03d6c';
export const SCSP_DSP_UI_PARITY_RECEIPT='docs/issues/scsp_dsp_routing_ui_source_revision_01.json';
export const SCSP_DSP_UI_PARITY_REPORT='docs/issues/scsp_dsp_routing_ui_default_parity_01.json';
const predecessors=Object.freeze({
  'docs/synth-scsp/dsp.js':'6c275811a85a7ed6904f00868241414029ec919776bc68f897120a99e031ebb0',
  'docs/synth-scsp/dsp_program.js':'34e3da7a3ffbe083348ac50555ce2176e35dafd202722e313f6bfd55cba4f2b7',
  'docs/synth-scsp/instrument.js':'298ece3982e02d6129752f1daf0708a4e16b3247dcf4ee0a18242342c81da3f5',
});
const root=new URL('../',import.meta.url),path=name=>new URL(name,root);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});
const floats=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength);
export function reconstructScspDspUiParityPredecessor(name,current,receipt){
  const pin=predecessors[name],entry=receipt.sources[name];
  current=createScspFmCustom2RevisionReadContext().restore(name,current);
  assert(pin,'Only independently pinned Synth predecessors may be loaded');
  assert.equal(receipt.baseCommit,SCSP_DSP_UI_PARITY_BASE_COMMIT);
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
async function beforeInstrument(originals,readReviewed){
  const routingPath='docs/synth-scsp/routing.js',patchPath='docs/synth-scsp/patch.js';
  const routing=dataUrl(absoluteImports(readReviewed(routingPath).toString(),routingPath));
  const patch=dataUrl(absoluteImports(readReviewed(patchPath).toString(),patchPath,{[path(routingPath).href]:routing}));
  const programPath='docs/synth-scsp/dsp_program.js',dspPath='docs/synth-scsp/dsp.js',instrumentPath='docs/synth-scsp/instrument.js';
  const program=dataUrl(absoluteImports(originals[programPath],programPath));
  const dsp=dataUrl(absoluteImports(originals[dspPath],dspPath,{[path(programPath).href]:program}));
  return (await import(dataUrl(absoluteImports(originals[instrumentPath],instrumentPath,{
    [path(dspPath).href]:dsp,[path(patchPath).href]:patch,[path(routingPath).href]:routing,
  })))).SynthInstrument;
}
function metadata(instrument){
  const state=structuredClone(instrument.read());
  delete state.dspRouting;delete state.dspReturns;delete state.dspRoutingOverrides;
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
function exercise(owner,scenario,frequencyHz,dspEnabled){
  const chunks=[],i=owner.instrument,render=frames=>chunks.push(owner.render(frames));
  const pcm=scenario==='pcm8'?Int8Array.from({length:64},(_,n)=>Math.round(40*Math.sin(n*Math.PI/32))):Int16Array.from({length:64},(_,n)=>Math.round(8192*Math.sin(n*Math.PI/32)));
  i.invoke('applyPCM',[0,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  i.setEffect({enabled:dspEnabled,timeMs:20,feedback:.25});
  render(256);i.noteOn('baseline',69+12*Math.log2(frequencyHz/440));render(2048);
  i.invoke('setMix',[0,{pan:15,totalLevel:21}]);render(512);
  i.noteOff('baseline');render(4096);owner.stop();render(2048);
  const count=chunks.reduce((n,v)=>n+v.left.length,0),left=new Float32Array(count),right=new Float32Array(count);
  let at=0;for(const chunk of chunks){left.set(chunk.left,at);right.set(chunk.right,at);at+=chunk.left.length;}
  // Snapshot the native API's complete readable map, not unmapped holes.
  const addresses=[...Array.from({length:512},(_,index)=>index*2),0x400,0x402,0x408,
    ...Array.from({length:(0xee2-0x600)/2+1},(_,index)=>0x600+index*2)];
  const registers=Uint16Array.from(addresses,address=>owner.core.read(address));
  return {left,right,state:metadata(i),ram:owner.core.readRam(),registers};
}
function legacyTrace(trace){
  return trace.filter(item=>!(item.address===54&&item.mask===0xff&&(item.value&0xff)===0))
    .map(({mask,...item})=>item);
}
export async function measureScspDspUiDefaultParity(){
  const context=createScspFmCustom2RevisionReadContext(),readReviewed=name=>context.readSource(path(name));
  const receipt=JSON.parse(await readFile(path(SCSP_DSP_UI_PARITY_RECEIPT),'utf8')),originals={},sources={},currentSources={};
  for(const name of Object.keys(predecessors)){
    const current=readReviewed(name);sources[name]=record(current);currentSources[name]=current.toString();
    originals[name]=reconstructScspDspUiParityPredecessor(name,current,receipt);
  }
  const Before=await beforeInstrument(originals,readReviewed),After=await beforeInstrument(currentSources,readReviewed),wasmBinary=await readFile(path('docs/generated/scsp_wasm.wasm'));
  const cases=[];
  for(const sampleRate of [44100,48000])for(const scenario of ['pcm8','pcm16'])for(const frequencyHz of [220,440,880])for(const dspEnabled of [false,true]){
    const before=await owner(Before,sampleRate,wasmBinary),after=await owner(After,sampleRate,wasmBinary);
    try{
      const a=exercise(before,scenario,frequencyHz,dspEnabled),b=exercise(after,scenario,frequencyHz,dspEnabled),label=[sampleRate,scenario,frequencyHz,dspEnabled].join('/');
      assert.deepEqual(b.left,a.left,label+' left PCM');assert.deepEqual(b.right,a.right,label+' right PCM');
      assert.deepEqual(b.ram,a.ram,label+' full PCM and Delay RAM');assert.deepEqual(b.state,a.state,label+' legacy state');
      assert.deepEqual(b.registers,a.registers,label+' final registers');
      assert.deepEqual(legacyTrace(after.trace),legacyTrace(before.trace),label+' legacy effective write sequence');
      assert(b.left.every(Number.isFinite)&&b.right.every(Number.isFinite));
      cases.push({sampleRate,scenario,frequencyHz,dspEnabled,stereoFrames:b.left.length,
        exactPcmEqual:true,exactRamEqual:true,legacyStateEqual:true,exactRegistersEqual:true,exactLegacyEffectiveWriteTraceEqual:true,
        addedSilentReturn1Writes:after.trace.length-before.trace.length,
        pcmLeftSha256:sha(floats(b.left)),pcmRightSha256:sha(floats(b.right)),ramSha256:sha(b.ram),registersSha256:sha(Buffer.from(b.registers.buffer)),legacyTraceSha256:sha(JSON.stringify(legacyTrace(after.trace)))});
    }finally{before.dispose();after.dispose();}
  }
  return {schemaVersion:1,scope:'scsp-synth-two-bus-ui-default-audio-parity',baseCommit:SCSP_DSP_UI_PARITY_BASE_COMMIT,
    deviceOpened:false,reference:'Exact three Synth source predecessors reconstructed without Git and executed with unchanged SCSP WASM.',
    tracePolicy:'Compare all effective writes after excluding only silent EFREG1 low-byte writes; retain voice direct writes at the same address. Final complete register state is exact.',
    statePolicy:'Normalize independent bank IDs and remove only newly exposed top-level DSP routing/return metadata. No new routing API is called.',
    sources,binary:record(wasmBinary),predecessors:Object.fromEntries(Object.keys(predecessors).map(name=>[name,receipt.sources[name].before])),cases};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===0||args.length===1&&args[0]==='--check','Usage: node scripts/record_scsp_dsp_routing_ui_default_parity.mjs [--check]');
  const report=await measureScspDspUiDefaultParity(),text=JSON.stringify(report,null,2)+'\n';
  if(args[0]==='--check')assert.equal(await readFile(path(SCSP_DSP_UI_PARITY_REPORT),'utf8'),text);else await writeFile(path(SCSP_DSP_UI_PARITY_REPORT),text);
  console.log(`SCSP Synth two-bus UI default parity: ${report.cases.length} cases PASS; no device opened.`);
}
