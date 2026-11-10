// Real processor/core rendering into arrays, without AudioContext or speakers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RF5C164Synth} from '../js/rf5c164synth.js';

class Port {
  constructor(){this.messages=[];this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
  postMessage(data){this.messages.push(data);if(data.ready)this.resolve();if(data.error)this.reject(Error(data.error));}
}
let Processor;
const previous=new Map(['AudioWorkletProcessor','registerProcessor'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
globalThis.AudioWorkletProcessor=class{constructor(){this.port=new Port();}};
globalThis.registerProcessor=(name,type)=>{assert.equal(name,'tetorica-synth-pcm');Processor=type;};
try {await import('./synth_pcm_worklet.js');}
finally {for(const [name,value]of previous)value?Object.defineProperty(globalThis,name,value):delete globalThis[name];}
const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
async function worklet() {
  const old=Object.getOwnPropertyDescriptor(globalThis,'sampleRate');globalThis.sampleRate=48000;
  let processor;try {processor=new Processor({processorOptions:{wasmBinary}});await processor.port.ready;}
  finally {old?Object.defineProperty(globalThis,'sampleRate',old):delete globalThis.sampleRate;}
  return processor;
}
const send=(p,method,args=[])=>p.receive({method,args});
function render(p,frames) {
  const left=new Float32Array(frames),right=new Float32Array(frames);
  for(let i=0;i<frames;i+=128)assert(p.process([],[[left.subarray(i,Math.min(i+128,frames)),right.subarray(i,Math.min(i+128,frames))]]));
  return {left,right};
}
function program(p) {
  const pcm=new RF5C164Synth({transport:{write:(...args)=>send(p,'writeRegister',args),loadMemory:(...args)=>send(p,'loadMemory',args),reset:()=>send(p,'reset')}});
  const bank=new Uint8Array(65536).fill(255);for(let i=0;i<193;i++)bank[i]=i%2?128+1+i%126:1+i%126;
  pcm.loadMemory(bank);pcm.setChannel(0,{start:0,loopStart:0,step:1700,volume:96,pan:{left:15,right:15}});send(p,'keyOn',[0]);return pcm;
}

test('private PCM mute messages silence Code/raw writes without retriggering, changing release state, or losing reset policy',async()=>{
  const a=await worklet(),b=await worklet();
  try {
    const aa=program(a),bb=program(b);assert.deepEqual(render(a,303),render(b,303));
    send(a,'setChannelMuted',[0,true]);aa.setChannel(0,{volume:77,pan:{left:7,right:5}});bb.setChannel(0,{volume:77,pan:{left:7,right:5}});
    const muted=render(a,1703),reference=render(b,1703);
    assert(muted.left.every(value=>value===0));assert(muted.right.every(value=>value===0));assert(reference.left.some(value=>value!==0));
    send(a,'setChannelMuted',[0,false]);assert.deepEqual(render(a,2000),render(b,2000),'the worklet restores current pan at the continuing playback position');
    send(a,'releaseNote',[0]);send(b,'releaseNote',[0]);send(a,'setChannelMuted',[0,true]);render(a,70);render(b,70);
    send(a,'setChannelMuted',[0,false]);assert.deepEqual(render(a,300),render(b,300),'release processing remains independent of channel output mute');
    send(a,'setChannelMuted',[0,true]);send(a,'reset');program(a);assert(render(a,1000).left.every(value=>value===0));
    send(a,'setChannelMuted',[0,false]);assert(render(a,1000).left.some(value=>value!==0));
    assert(!a.dead);assert(!a.port.messages.some(message=>message.error));send(a,'dispose');assert.equal(a.mute,null);
  } finally {a.dispose();b.dispose();}
});
