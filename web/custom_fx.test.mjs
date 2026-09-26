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
