import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';import {Scsp} from '../js/scsp.js';import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';import {SynthInstrument} from './instrument.js';
const binary=await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url)),source=await readFile(new URL('./processor.js',import.meta.url),'utf8');
async function make(t,rate){let Class;const messages=[];vm.runInNewContext(source.replace(/^import .*;\n/gm,''),{factory,Scsp,Pcm44100Resampler,SynthInstrument,sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor(name,value){assert.equal(name,'tetorica-scsp-synth');Class=value;}});const p=new Class({processorOptions:{wasmBinary:binary}});await p.ready;t.after(()=>p.port.onmessage({data:{method:'dispose'}}));assert(messages.some(m=>m.ready));return {p,messages,async command(method,args=[]){p.port.onmessage({data:{id:1,method,args}});await p.ready;await Promise.resolve();const result=messages.at(-1);assert(!result.error,result.error);return result.value;},render(n){const left=new Float32Array(n),right=left.slice();assert(p.process([],[[left,right]]));return {left,right};}};}
test('dedicated processor handles grouped commands, all host rates and render partitions with exact Stop silence',async t=>{
 for(const rate of [44100,48000,96000])for(const mode of ['fm2','fm4','fm6']){
  const a=await make(t,rate),b=await make(t,rate);for(const x of [a,b]){await x.command('setConfig',[{mode}]);await x.command('setEffect',[{enabled:true,timeMs:20,send:7,returnLevel:7}]);await x.command('noteOn',['note',69]);}
  const whole=a.render(8192),left=new Float32Array(8192),right=left.slice();for(let at=0;at<8192;at+=37){const part=b.render(Math.min(37,8192-at));left.set(part.left,at);right.set(part.right,at);}assert.deepEqual(whole,{left,right});assert(left.some(x=>Math.abs(x)>.01));
  await a.command('setConfig',[{fm:{algorithm:'pairs'}}]);assert(a.render(128).left.every(v=>v===0));
  await a.command('setConfig',[{mode:'pcm'}]);assert(a.render(128).left.every(x=>x===0));await a.command('noteOn',['next',69]);await a.command('stopVoices');assert(a.render(128).left.every(x=>x===0));
 }
});

test('processor Code shares authored groups and fences stale messages without stopping the keyboard',async t=>{
 const f=await make(t,48000);await f.command('setConfig',[{mode:'fm6'}]);const {session}=await f.command('beginCode');
 await f.command('code',[session,'noteOn',[0,'A4']]);await f.command('noteOn',['keyboard',60]);assert(f.render(4096).left.some(x=>Math.abs(x)>.01));
 await f.command('endCode',[session]);const author=await f.command('readAuthoring');assert.equal(author.state.voiceGroups.length,1);assert.equal(author.state.voiceGroups[0].id,'keyboard');assert(author.state.voiceGroups[0].held);
 assert(f.render(4096).left.some(x=>Math.abs(x)>.01));
 f.p.port.onmessage({data:{id:99,method:'code',args:[session,'allNotesOff',[]]}});await f.p.ready;await Promise.resolve();
 assert.equal(f.messages.at(-1).name,'AbortError');assert.equal(f.messages.at(-1).id,99);assert.equal(f.p.instrument.read().voiceGroups[0].id,'keyboard');
});

test('processor accepts fractional performance bend, preserves portable transpose and resets on command',async t=>{
 const f=await make(t,48000);await f.command('setConfig',[{mode:'fm2',transpose:2}]);assert.equal(await f.command('setPitchBend',[.5]),.5);
 await f.command('noteOn',['keyboard',69]);const {session}=await f.command('beginCode');await f.command('code',[session,'noteOn',[0,69]]);
 let state=(await f.command('readAuthoring')).state;assert.equal(state.pitchBend,.5);assert.equal(state.config.transpose,2);
 for(const group of state.voiceGroups){const [modulator,carrier]=group.slots;assert(Math.abs(state.slots[carrier].frequencyHz-440*2**(2.5/12))<1e-8);assert(Math.abs(state.slots[modulator].frequencyHz-880*2**(2.5/12))<1e-8);}
 assert.equal((await f.command('exportPatch')).transpose,2);assert(f.render(4096).left.some(x=>Math.abs(x)>.01));
 await f.command('setPitchBend',[0]);state=(await f.command('readAuthoring')).state;assert.equal(state.pitchBend,0);
 for(const group of state.voiceGroups)assert(Math.abs(state.slots[group.slots[1]].frequencyHz-440*2**(2/12))<1e-8);
});
