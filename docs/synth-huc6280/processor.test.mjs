// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const source=await readFile(new URL('./processor.js',import.meta.url),'utf8');
function fixture() {
  let Constructor,resolve,reject;
  const messages=[],options=[],factoryOptions=[],core={disposed:0,dispose(){this.disposed++;}};
  const loading=new Promise((yes,no)=>{resolve=yes;reject=no;});
  class Instrument {
    constructor(chip){this.chip=chip;this.calls=[];this.preset={dda:{data:''}};}
    noteOn(...args){this.calls.push(args);return {channel:0,stolenId:null};}
    setPreset(value){if(typeof value?.dda?.data!=='string'||value.dda.data==='invalid')throw new RangeError('Invalid PCM');this.preset=value;return this.read();}
    loadPreset(value){return this.setPreset(value);}
    read(){return {preset:this.preset,voices:[]};}
    dispose(){this.chip.dispose();}
    generateStereo(frames){return {left:new Float32Array(frames).fill(.1),right:new Float32Array(frames).fill(.2)};}
  }
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''),{
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:value=>messages.push(value)};}},
    Huc6280AudioEngine:{create:value=>{options.push(value);value.moduleFactory();return loading;}},
    Huc6280Instrument:Instrument,HUC6280_CLOCK:3579545,sampleRate:48000,
    factory:value=>{factoryOptions.push(value);return Promise.resolve({});},Set,
    registerProcessor(name,value){assert.equal(name,'tetorica-huc6280-synth');Constructor=value;},
  });
  const binary=new Uint8Array([1,2]);
  const processor=new Constructor({processorOptions:{wasmBinary:binary}});
  return {processor,core,messages,options,factoryOptions,binary,resolve:()=>resolve(core),reject};
}
const output=()=>[[new Float32Array(128).fill(9),new Float32Array(128).fill(9)]];

test('HuC6280 processor starts silent, adopts host sample rate and orders commands after WASM initialization',async()=>{
  const f=fixture(),silent=output();assert.equal(f.processor.process([],silent),true);assert(silent[0].every(row=>row.every(value=>value===0)));
  f.processor.receive({id:1,method:'noteOn',args:['first',60]});f.processor.receive({id:2,method:'noteOn',args:['second',64]});
  f.resolve();await f.processor.ready;await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(f.options[0].outputSampleRate,48000);assert.equal(f.options[0].clock,3579545);assert.equal(f.options[0].masterVolume,1);
  assert.equal(f.factoryOptions[0].wasmBinary,f.binary);assert.equal(f.messages[0].ready,true);
  assert.deepEqual(f.processor.instrument.calls,[['first',60],['second',64]]);
  const pcm=output();assert.equal(f.processor.process([],pcm),true);assert(pcm[0][0].every(value=>value>.09));assert(pcm[0][1].every(value=>value>.19));
  f.processor.receive({id:3,method:'constructor',args:[]});await new Promise(resolve=>queueMicrotask(resolve));
  assert.match(f.messages.find(message=>message.id===3).error,/Unknown/);assert.equal(f.processor.dead,false);
  f.processor.receive({method:'dispose'});assert.equal(f.core.disposed,1);assert.equal(f.processor.process([],output()),false);
});

test('HuC6280 initialization cancellation disposes eventual core without publishing readiness',async()=>{
  const f=fixture();f.processor.receive({method:'dispose'});f.resolve();await f.processor.ready;
  assert.equal(f.core.disposed,1);assert.equal(f.messages.length,0);
});

test('processor retains only accepted PCM, resolves omitted-data edits, and keeps large data out of replies',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;
  const flush=()=>new Promise(resolve=>queueMicrotask(resolve));
  f.processor.receive({id:1,method:'loadPreset',args:[{dda:{data:'EBES',speed:1}}]});await flush();
  let reply=f.messages.find(message=>message.id===1);
  assert.equal(reply.ddaDataOmitted,true);assert.equal(Object.hasOwn(reply.value.preset.dda,'data'),false);
  f.processor.receive({id:2,method:'setPreset',args:[{dda:{speed:2}}],ddaDataUnchanged:true});await flush();
  assert.equal(f.processor.instrument.preset.dda.data,'EBES');assert.equal(f.processor.instrument.preset.dda.speed,2);
  f.processor.receive({id:3,method:'loadPreset',args:[{dda:{data:'invalid'}}]});await flush();
  assert.match(f.messages.find(message=>message.id===3).error,/Invalid PCM/);
  f.processor.receive({id:4,method:'read'});await flush();
  assert.equal(f.processor.acceptedDdaData,'EBES');assert.equal(f.messages.find(message=>message.id===4).ddaDataOmitted,true);
  f.processor.receive({id:5,method:'setPreset',args:[{dda:{data:'bad'}}],ddaDataUnchanged:true});await flush();
  assert.match(f.messages.find(message=>message.id===5).error,/cached DDA/);
  f.processor.receive({id:6,method:'loadPreset',args:[{dda:{data:''}}]});await flush();
  reply=f.messages.find(message=>message.id===6);assert.equal(reply.value.preset.dda.data,'');assert.equal(reply.ddaDataOmitted,undefined);
  f.processor.dispose();
});

test('HuC6280 initialization/render errors fail once and clear the audio block',async()=>{
  const failed=fixture();failed.reject(new Error('Bad WASM'));await failed.processor.ready;
  assert.equal(failed.messages.length,1);assert.equal(failed.messages[0].fatal,true);assert.match(failed.messages[0].error,/Bad WASM/);
  const f=fixture();f.resolve();await f.processor.ready;f.processor.instrument.generateStereo=()=>{throw new Error('Broken render');};
  const pcm=output();assert.equal(f.processor.process([],pcm),false);assert(pcm[0].every(row=>row.every(value=>value===0)));
  assert.equal(f.core.disposed,1);assert.equal(f.messages.filter(message=>message.fatal).length,1);
});

test('real HuC6280 worklet initializes and renders WASM with no Node or URL globals',()=>{
  const script=`
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const wasmBinary=await readFile(new URL(${JSON.stringify(new URL('../generated/huc6280_wasm.wasm',import.meta.url).href)}));
    let Constructor;
    globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:value=>{this.last=value;}};}};
    globalThis.registerProcessor=(name,value)=>{assert.equal(name,'tetorica-huc6280-synth');Constructor=value;};
    globalThis.sampleRate=48000;globalThis.URL=undefined;globalThis.process=undefined;globalThis.atob=undefined;globalThis.btoa=undefined;
    await import(${JSON.stringify(new URL('./processor.js',import.meta.url).href)});
    const processor=new Constructor({processorOptions:{wasmBinary}});await processor.ready;
    assert.equal(processor.last.ready,true);
    processor.receive({id:1,method:'noteOn',args:['real',60]});await new Promise(resolve=>queueMicrotask(resolve));
    assert.equal(processor.last.id,1);assert.equal(processor.last.error,undefined);
    const left=new Float32Array(2048),right=new Float32Array(2048);assert.equal(processor.process([],[[left,right]]),true);
    assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));
    const {createDefaultPreset}=await import(${JSON.stringify(new URL('./preset.js',import.meta.url).href)});
    const preset=createDefaultPreset();preset.source='dda';preset.dda={name:'Worklet test',data:'EB8AEA==',sampleRate:11025,rootNote:60,loop:true,speed:1};
    processor.receive({id:2,method:'loadPreset',args:[preset]});await new Promise(resolve=>queueMicrotask(resolve));
    assert.equal(processor.last.error,undefined);assert.equal(processor.last.ddaDataOmitted,true);
    assert.equal(Object.hasOwn(processor.last.value.preset.dda,'data'),false);
    processor.receive({id:3,method:'noteOn',args:['dda',60]});await new Promise(resolve=>queueMicrotask(resolve));
    processor.process([],[[left,right]]);assert(left.some(value=>Math.abs(value)>.001));
    const {data:_data,...dda}=preset.dda;
    processor.receive({id:4,method:'setPreset',args:[{...preset,dda:{...dda,speed:.5}}],ddaDataUnchanged:true});await new Promise(resolve=>queueMicrotask(resolve));
    assert.equal(processor.last.error,undefined);assert.equal(processor.last.ddaDataOmitted,true);
    processor.receive({method:'dispose'});assert.equal(processor.process([],[[left,right]]),false);
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr||child.stdout);
});
