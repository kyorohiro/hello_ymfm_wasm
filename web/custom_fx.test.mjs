import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LiveFX} from './custom_fx.js';
import {createNativeFXController} from './native_fx.js';
const gain=function(input,output,state,context){
 state.blocks=(state.blocks??0)+1;
 for(let c=0;c<input.length;c++)for(let i=0;i<input[c].length;i++)output[c][i]=input[c][i]*context.gain;
};
const block=()=>[new Float32Array(128).fill(.5),new Float32Array(128).fill(.25)];
test('named functions, methods, context copies, replacement state and removal',()=>{
 const processor=new LiveFX(48000);
 const controller=createNativeFXController(d=>processor.command(d));
 const context={gain:.5};
 controller.liveFx('gain',{context,process:gain});
 context.gain=0;
 let out=block();processor.process(out,assert.fail);assert.equal(out[0][0],.25);
 assert.equal(out[1][0],.125);
 const state=processor.effects.get('gain').state;
 controller.updateContext('gain',{gain:.25});
 out=block();processor.process(out,assert.fail);assert.equal(out[0][0],.125);
 controller.liveFx('gain',{context:{gain:1},process(input,output,state,context){output.forEach((ch,c)=>ch.set(input[c]));}});
 assert.equal(processor.effects.get('gain').state,state);
 controller.liveFx('gain',{process:gain,context:{gain:1},resetState:true});
 assert.notEqual(processor.effects.get('gain').state,state);
 controller.removeLiveFx('gain');out=block();processor.process(out,assert.fail);assert.equal(out[0][0],.5);
});
test('bad registration is atomic; runtime exception/nonfinite bypass preserves input',()=>{
 const processor=new LiveFX(48000),controller=createNativeFXController(d=>processor.command(d));
 controller.liveFx('gain',{process:gain,context:{gain:.5}});
 assert.throws(()=>processor.command({action:'register',name:'gain',source:'invalid {'}));
 let out=block();processor.process(out,assert.fail);assert.equal(out[0][0],.25);
 for(const process of [function(i,o){o[0][0]=NaN;},function(){throw new Error('bad')}]) {
  controller.liveFx('gain',{process});
  const errors=[];out=block();processor.process(out,e=>errors.push(e));assert.equal(out[0][0],.5);assert.equal(errors.length,1);
  processor.process(out,e=>errors.push(e));assert.equal(errors.length,1);
 }
 assert.throws(()=>controller.liveFx('x',{process:async()=>{}}));
 assert.throws(()=>controller.liveFx('x',{process:gain,context:{fn(){}}}));
});
test('actual WASM worklet accepts liveFx on main and direct Worker port; Stop clears it',async()=>{
 const messages=[];
 globalThis.sampleRate=48000;
 globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:d=>messages.push(d)};}};
 globalThis.registerProcessor=()=>{};
 try {
  const {NativeFXProcessor}=await import('./native-fx-worklet.js');
  const module=await WebAssembly.compile(await readFile(new URL('./native_audio_effect.wasm',import.meta.url)));
  const processor=new NativeFXProcessor({processorOptions:{module}});
  const run=()=>{const out=block();processor.process([block()],[out]);return out;};
  const main=createNativeFXController(data=>processor.port.onmessage({data}));
  main.liveFx('gain',{process:gain,context:{gain:.5}});
  assert.equal(run()[0][0],.25);
  const port={start(){},close(){}};
  processor.port.onmessage({data:{op:'attach',port}});
  assert.equal(run()[0][0],.5);
  const worker=createNativeFXController(data=>port.onmessage({data}));
  worker.liveFx('gain',{process:gain,context:{gain:.5}});
  worker.updateContext('gain',{gain:.25});
  assert.equal(run()[0][0],.125);
  processor.port.onmessage({data:{op:'emergency'}});
  assert.equal(run()[0][0],.5);
  processor.port.onmessage({data:{op:'main'}});
  worker.liveFx('stale',{process:gain,context:{gain:0}});
  assert.equal(run()[0][0],.5);
  assert.equal(messages.length,0);
 } finally {delete globalThis.sampleRate;delete globalThis.AudioWorkletProcessor;delete globalThis.registerProcessor;}
});

test('monitor is opt-in, collects contiguous per-FX stereo windows and stops after one reply',async()=>{
 const messages=[];
 globalThis.sampleRate=48000;
 globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:d=>messages.push(d)};}};
 globalThis.registerProcessor=()=>{};
 try {
  const {NativeFXProcessor}=await import('./native-fx-worklet.js?monitor-test');
  const module=await WebAssembly.compile(await readFile(new URL('./native_audio_effect.wasm',import.meta.url)));
  const p=new NativeFXProcessor({processorOptions:{module}});
  const port={start(){},close(){}};
  p.port.onmessage({data:{op:'attach',port}});
  const fx=createNativeFXController(data=>port.onmessage({data}));
  fx.liveFx('half',{process:gain,context:{gain:.5}});
  fx.liveFx('quarter',{process:gain,context:{gain:.5}});
  const render=()=>p.process([block()],[block()]);
  for(let i=0;i<20;i++)render();
  assert.equal(messages.length,0);
  p.port.onmessage({data:{op:'fx-monitor',enabled:true,id:1,name:'quarter',channel:1}});
  for(let i=0;i<15;i++)render();
  assert.equal(messages.length,0);
  render();
  const data=messages.at(-1);
  assert.equal(data.id,1);assert.equal(data.input.length,2048);
  assert.ok(data.input.every(v=>v===.125));assert.ok(data.output.every(v=>v===.0625));
  for(let i=0;i<20;i++)render();
  assert.equal(messages.length,1);
  p.port.onmessage({data:{op:'fx-monitor',enabled:true,id:2,name:'half'}});
  render();p.port.onmessage({data:{op:'fx-monitor',enabled:false}});
  for(let i=0;i<20;i++)render();
  assert.equal(messages.length,1);assert.equal(p.monitor,null);
  p.port.onmessage({data:{op:'fx-monitor',enabled:true,id:3,name:'half'}});
  fx.removeLiveFx('half');
  assert.equal(messages.at(-1).id,3);
  assert.equal(p.monitor,null);
 }finally{delete globalThis.sampleRate;delete globalThis.AudioWorkletProcessor;delete globalThis.registerProcessor;}
});

test('display FFT resolves a sine bin and preserves the gain difference',async()=>{
 const {spectrum}=await import('../docs/playground/playground_fx_monitor.js');
 const input=Float32Array.from({length:2048},(_,i)=>Math.sin(2*Math.PI*64*i/2048));
 const before=spectrum(input),after=spectrum(input.map(x=>x*.5));
 const peak=before.indexOf(Math.max(...before));
 assert.equal(peak,64);
 assert.ok(Math.abs(before[peak])<.02);
 assert.ok(Math.abs((after[peak]-before[peak])+6.0206)<.01);
 assert.ok(spectrum(new Float32Array(2048)).every(x=>x===-100));
});
