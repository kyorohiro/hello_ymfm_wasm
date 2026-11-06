// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('./processor.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function setup({delay=false}={}) {
  const replies=[],cores=[],samplers=[];let Processor,release,failRender=false;
  class Base {constructor(){this.port={postMessage:value=>replies.push(value)};}}
  class Instrument {
    constructor(core){this.core=core;this.generation=0;this.playing=false;this.preset={brr:{data:''}};}
    read(){return {preset:this.preset,generation:this.generation};}
    setPreset(p){if(p.bad)throw Error('invalid preset');this.preset=p;return this.read();}
    loadPreset(p){this.setPreset(p);this.generation++;this.playing=false;return this.read();}
    noteOn(){this.playing=true;return {channel:0,stolenId:null};}
    noteOff(){this.playing=false;return true;}
    stop(){this.playing=false;this.generation++;return this.read();}
    dispose(){this.core.dispose();}
  }
  class Resampler {
    constructor(instrument,rate,options){Object.assign(this,{instrument,rate,options,resets:0});samplers.push(this);}
    reset(){this.resets++;}
    render(left,right){if(failRender)throw Error('render failed');left.fill(this.instrument.playing?.25:0);right.set(left);}
  }
  const create=()=>{const core={disposed:false,dispose(){this.disposed=true;}};cores.push(core);return core;};
  const core={create:()=>delay?new Promise(resolve=>{release=()=>resolve(create());}):Promise.resolve(create())};
  vm.runInNewContext(source,{AudioWorkletProcessor:Base,SnesDspCore:core,SnesInstrument:Instrument,SpcResampler:Resampler,
    factory:()=>{},sampleRate:48000,Float32Array,Set,Object,Error,TypeError,registerProcessor(name,ctor){assert.equal(name,'tetorica-sdsp-synth');Processor=ctor;}});
  const processor=new Processor({processorOptions:{wasmBinary:new ArrayBuffer(4)}});
  const command=async(method,args=[],extra={})=>{const id=replies.length+100;processor.receive({id,method,args,...extra});await processor.ready;await Promise.resolve();return replies.find(reply=>reply.id===id);};
  return {processor,replies,cores,samplers,command,release:()=>release(),failRender:()=>{failRender=true;}};
}

test('processor resets buffered resampling on sample replacement and Stop, preserving metadata edit phase',async()=>{
  const f=setup();await f.processor.ready;
  const s=f.samplers[0];assert.equal(s.rate,48000);assert.equal(s.options.sourceFrames,1);
  await f.command('loadPreset',[{brr:{data:'AA=='}}]);assert.equal(s.resets,1);
  await f.command('noteOn',['held',60]);const output=[[new Float32Array(4),new Float32Array(4)]];
  assert.equal(f.processor.process([],output),true);assert(output[0][0].every(value=>value===.25));
  await f.command('setPreset',[{brr:{data:'AA=='},level:17}]);assert.equal(s.resets,1);
  await f.command('stop');assert.equal(s.resets,2);f.processor.process([],output);assert(output[0][0].every(value=>value===0));
  f.processor.dispose();
});

test('accepted BRR references survive rejected edits and large assets are omitted from replies',async()=>{
  const f=setup();await f.processor.ready;
  let reply=await f.command('loadPreset',[{brr:{data:'AA=='}}]);assert.equal(reply.brrDataOmitted,true);assert.equal(Object.hasOwn(reply.value.preset.brr,'data'),false);
  reply=await f.command('setPreset',[{brr:{},level:9}],{brrDataUnchanged:true});assert.equal(reply.error,undefined);assert.equal(f.processor.acceptedBrrData,'AA==');
  reply=await f.command('setPreset',[{brr:{data:'AQ=='},bad:true}]);assert.match(reply.error,/invalid/);assert.equal(f.processor.acceptedBrrData,'AA==');
  reply=await f.command('read',[],{brrDataUnchanged:true});assert.match(reply.error,/cached BRR/);
  reply=await f.command('setPreset',[{brr:{data:'AA=='}}],{brrDataUnchanged:true});assert.match(reply.error,/cached BRR/);
  reply=await f.command('unknown');assert.match(reply.error,/Unknown/);
  await f.command('loadPreset',[{brr:{data:''}}]);assert.equal(f.processor.acceptedBrrData,'');f.processor.dispose();
});

test('processor initialization, fatal rendering and early disposal always produce silent buffers',async()=>{
  const f=setup({delay:true}),output=[[new Float32Array(3).fill(1),new Float32Array(3).fill(1)]];
  assert.equal(f.processor.process([],output),true);assert(output[0].every(side=>side.every(value=>value===0)));
  f.processor.dispose();f.release();await f.processor.ready;assert.equal(f.cores[0].disposed,true);
  const live=setup();await live.processor.ready;await live.command('noteOn');live.failRender();
  output[0].forEach(side=>side.fill(1));assert.equal(live.processor.process([],output),false);
  assert(output[0].every(side=>side.every(value=>value===0)));assert.equal(live.replies.filter(reply=>reply.fatal).length,1);
  assert.equal(live.cores[0].disposed,true);assert.equal(live.processor.process([],output),false);
});

test('both BRR assets are elided independently and invalid references or rejected replacements preserve both caches',async()=>{
  const f=setup();await f.processor.ready;
  const first={brr:{data:'AA=='},pmon:{source:'brr',brr:{data:'AQ=='}}};
  let reply=await f.command('loadPreset',[first]);
  assert(reply.brrDataOmitted&&reply.modBrrDataOmitted);assert.equal(Object.hasOwn(reply.value.preset.pmon.brr,'data'),false);
  reply=await f.command('setPreset',[{brr:{},pmon:{source:'brr',brr:{root:61}}}],{brrDataUnchanged:true,modBrrDataUnchanged:true});
  assert.equal(reply.error,undefined);assert.equal(f.processor.instrument.preset.brr.data,'AA==');
  assert.equal(f.processor.instrument.preset.pmon.brr.data,'AQ==');
  reply=await f.command('setPreset',[{brr:{data:'Ag=='},pmon:{brr:{data:'Aw=='}},bad:true}]);
  assert.match(reply.error,/invalid/);assert.equal(f.processor.acceptedBrrData,'AA==');assert.equal(f.processor.acceptedModBrrData,'AQ==');
  for(const [method,args,extra]of[
    ['read',[],{modBrrDataUnchanged:true}],
    ['setPreset',[{brr:{data:'AA=='},pmon:{brr:{data:'AQ=='}}}],{modBrrDataUnchanged:true}],
    ['setPreset',[{brr:{data:'AA=='},pmon:{brr:{}}}],{modBrrDataUnchanged:false}],
    ['setPreset',[{brr:{data:'AA=='}}],{modBrrDataUnchanged:true}],
  ]){reply=await f.command(method,args,extra);assert.match(reply.error,/cached modulator BRR/);}
  assert.equal(f.processor.acceptedModBrrData,'AQ==');
  reply=await f.command('setPreset',[{brr:{},pmon:{brr:{data:'Ag=='}}}],{brrDataUnchanged:true});
  assert.equal(reply.error,undefined);assert.equal(f.processor.acceptedBrrData,'AA==');assert.equal(f.processor.acceptedModBrrData,'Ag==');
  await f.command('loadPreset',[{brr:{data:''},pmon:{source:'wave',brr:{data:''}}}]);
  assert.equal(f.processor.acceptedBrrData,'');assert.equal(f.processor.acceptedModBrrData,'');f.processor.dispose();
});
