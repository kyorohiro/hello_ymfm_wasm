import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';import {Scsp} from '../js/scsp.js';import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';import {SynthInstrument} from './instrument.js';
const binary=await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url)),source=await readFile(new URL('./processor.js',import.meta.url),'utf8');
async function make(t,rate){let Class;const messages=[];vm.runInNewContext(source.replace(/^import .*;\n/gm,''),{factory,Scsp,Pcm44100Resampler,SynthInstrument,sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor(name,value){assert.equal(name,'tetorica-scsp-synth');Class=value;}});const p=new Class({processorOptions:{wasmBinary:binary}});await p.ready;t.after(()=>p.port.onmessage({data:{method:'dispose'}}));assert(messages.some(m=>m.ready));return {p,messages,async command(method,args=[]){p.port.onmessage({data:{id:1,method,args}});await p.ready;await Promise.resolve();const result=messages.at(-1);assert(!result.error,result.error);return result.value;},render(n){const left=new Float32Array(n),right=left.slice();assert(p.process([],[[left,right]]));return {left,right};}};}
test('dedicated processor handles grouped commands, all host rates and render partitions with exact Stop silence',async t=>{
 for(const rate of [44100,48000,96000]){
  const a=await make(t,rate),b=await make(t,rate);for(const x of [a,b]){await x.command('setConfig',[{mode:'fm2'}]);await x.command('noteOn',['note',69]);}
  const whole=a.render(8192),left=new Float32Array(8192),right=left.slice();for(let at=0;at<8192;at+=37){const part=b.render(Math.min(37,8192-at));left.set(part.left,at);right.set(part.right,at);}assert.deepEqual(whole,{left,right});assert(left.some(x=>Math.abs(x)>.01));
  await a.command('setConfig',[{mode:'pcm'}]);assert(a.render(128).left.every(x=>x===0));await a.command('noteOn',['next',69]);await a.command('stopVoices');assert(a.render(128).left.every(x=>x===0));
 }
});
