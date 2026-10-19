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
 for(const process of [function(i,o){o[0][0]=NaN;},function(){throw new Error('bad')},function(){throw null;}]) {
  controller.liveFx('gain',{process});
  const errors=[];out=block();processor.process(out,e=>errors.push(e));assert.equal(out[0][0],.5);assert.equal(errors.length,1);
  processor.process(out,e=>errors.push(e));assert.equal(errors.length,1);
  assert.match(errors[0], /\[liveFx:gain\]/);
  assert.match(errors[0], /Apply to retry/);
 }
 assert.throws(()=>controller.liveFx('x',{process:async()=>{}}));
 assert.throws(()=>controller.liveFx('x',{process:gain,context:{fn(){}}}));
});
test('invalid channel replacements and array shape changes bypass only that effect',()=>{
 const malformed=[
  function(input,output){output[0]=Float32Array.of(.5);},
  function(input,output){output[0]=null;},
  function(input,output){output.length=0;},
  function(input,output){input.length=0;throw new Error('bad');},
  function(input,output){input[0]=new Float32Array(1);},
  function(input,output){output[0]=new Float64Array(input[0].length);},
  function(input,output){output.push(new Float32Array(input[0].length));},
  function(input,output){input.length=1;},
  function(input,output){delete output[1];},
  function(input,output){output.length=0;Object.freeze(output);},
  function(input,output){input.length=0;Object.freeze(input);throw new Error('bad');},
 ];
 for(const process of malformed){
  const processor=new LiveFX(48000),errors=[];
  const controller=createNativeFXController(data=>processor.command(data));
  controller.liveFx('bad',{process});
  controller.liveFx('good',{process:gain,context:{gain:.5}});
  for(let iteration=0;iteration<3;iteration++){
   const out=block();processor.process(out,error=>errors.push(error));
   assert.ok(out[0].every(value=>value===.25),'the following effect receives the preserved dry input');
   assert.ok(out[1].every(value=>value===.125));
  }
  assert.equal(errors.length,1,'the malformed effect is bypassed after its first failure');
  assert.match(errors[0],/\[liveFx:bad\]/);
  assert.equal(processor.effects.get('bad').bypass,true);
  assert.equal(processor.effects.get('good').state.blocks,3);
 }
});
test('owned channel arrays and sample buffers are reused between blocks without freezing valid replacements',()=>{
 const processor=new LiveFX(48000),controller=createNativeFXController(data=>processor.command(data));
 controller.liveFx('copy',{process(input,output,state){
  state.input=input;state.output=output;
  for(let ch=0;ch<input.length;ch++){
   input[ch][0]*=.5;
   output[ch].set(input[ch]);
  }
 }});
 const first=block();processor.process(first,assert.fail);
 assert.equal(first[0][0],.25);assert.equal(first[0][1],.5);
 const {input,output}=processor.effects.get('copy').state;
 assert.notEqual(input[0],first[0]);assert.notEqual(output[0],first[0]);assert.notEqual(input[0],output[0]);
 assert.equal(Object.isFrozen(input),false);assert.equal(Object.isFrozen(output),false);
 const inputLeft=input[0],outputLeft=output[0];
 const second=block();processor.process(second,assert.fail);
 assert.equal(processor.effects.get('copy').state.input,input);
 assert.equal(processor.effects.get('copy').state.output,output);
 assert.equal(input[0],inputLeft);assert.equal(output[0],outputLeft);
 assert.equal(second[0][0],.25);assert.equal(second[0][1],.5);
});

test('valid Float32Array channel replacement remains audible and cannot replace the rack’s reusable buffers',()=>{
 const processor=new LiveFX(48000),controller=createNativeFXController(data=>processor.command(data));
 controller.liveFx('replace',{context:{gain:.5},process(input,output,state,context){
  if(!state.input){state.input=input;state.output=output;state.inputLeft=input[0];state.outputLeft=output[0];}
  if(input!==state.input||output!==state.output||input[0]!==state.inputLeft||output[0]!==state.outputLeft)throw Error('Rack buffers changed');
  for(let ch=0;ch<input.length;ch++)output[ch]=Float32Array.from(input[ch],value=>value*context.gain);
  state.replacement=output[0];
 }});
 controller.liveFx('after',{process:gain,context:{gain:.5}});
 for(let iteration=0;iteration<10;iteration++){
  const out=block();processor.process(out,assert.fail);
  assert.ok(out[0].every(value=>value===.125));assert.ok(out[1].every(value=>value===.0625));
  const state=processor.effects.get('replace').state;
  assert.equal(state.output[0],state.outputLeft,'owned output is restored after each callback');
  assert.notEqual(state.output[0],state.replacement);
 }
 assert.equal(processor.effects.get('after').state.blocks,10);
 assert.equal(processor.effects.get('replace').bypass,false);
});

test('valid input and output replacements work at cached segment lengths and restore their canonical arrays',()=>{
 const processor=new LiveFX(48000),controller=createNativeFXController(data=>processor.command(data));
 controller.liveFx('replace',{process(input,output){
  for(let ch=0;ch<input.length;ch++){
   input[ch]=Float32Array.from(input[ch],value=>value*.5);
   output[ch]=input[ch];
  }
 }});
 for(let iteration=0;iteration<2;iteration++)for(const length of [1,37,128]){
  const out=[new Float32Array(length).fill(.5)];processor.process(out,assert.fail);
  assert.ok(out[0].every(value=>value===.25));
  const buffers=processor.buffers.get(1).get(length);
  assert.equal(buffers.input.length,1);assert.equal(buffers.output.length,1);
  assert.equal(buffers.input[0],buffers.inputStorage[0]);assert.equal(buffers.output[0],buffers.outputStorage[0]);
 }
 assert.equal(processor.buffers.get(1).size,3,'rendering reuses each bounded segment cache');
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
  assert.equal(run()[0][0],.5); // Starts dry when added to an already rendering rack.
  run(); // Finish the 240-frame registration fade.
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

test('adding gain to an already running rack fades dry to wet without a block boundary step',()=>{
 for(const rate of [44100,48000]) {
  const p=new LiveFX(rate);
  p.process(block(),assert.fail); // The rack already carries audio (including possible DC).
  const controller=createNativeFXController(d=>p.command(d));
  controller.liveFx('gain',{process:gain,context:{gain:.5}});
  const frames=Math.round(rate*.005),samples=[];
  for(let b=0;b<4;b++) {
   const out=block();p.process(out,assert.fail);
   for(let i=0;i<out[0].length;i++)assert.equal(out[1][i],out[0][i]/2);
   samples.push(...out[0]);
  }
  assert.equal(samples[0],.5,'starts at preceding dry value');
  assert.equal(samples[frames],.25,'settles to requested gain in 5 ms');
  for(let i=1;i<samples.length;i++)assert.ok(Math.abs(samples[i]-samples[i-1])<=.25/frames+1e-7);
  p.clear();controller.liveFx('fresh',{process:gain,context:{gain:.5}});
  const out=block();p.process(out,assert.fail);
  assert.equal(out[0][0],.25,'registration before audio processing is immediate');
 }
});

test('a DSP can sanitize nonfinite source samples without dry/wet mixing reintroducing NaN',()=>{
 const sanitize=function(input,output){
  for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++){
   const value=input[ch][i];output[ch][i]=Number.isFinite(value)?value*.5:.25;
  }
 };
 const invalid=()=>[Float32Array.of(NaN,Infinity,-Infinity,.5),Float32Array.of(Infinity,NaN,-Infinity,-.5)];
 for(const rate of [44100,48000])for(const running of [false,true]){
  const rack=new LiveFX(rate),errors=[];
  if(running)rack.process(block(),assert.fail);
  const fx=createNativeFXController(data=>rack.command(data));
  fx.liveFx('sanitize',{process:sanitize});
  const samples=invalid();rack.process(samples,error=>errors.push(error));
  for(const channel of samples)for(const value of channel)assert.ok(Number.isFinite(value));
  if(running){
   assert.equal(samples[0][0],0,'nonfinite dry signal begins fade from silence');
   assert.ok(samples[0][1]>0&&samples[0][1]<.25,'sanitized wet signal fades in');
   for(let b=0;b<70;b++)rack.process(invalid(),error=>errors.push(error));
  }
  const settled=invalid();rack.process(settled,error=>errors.push(error));
  assert.deepEqual(settled,[Float32Array.of(.25,.25,.25,.25),Float32Array.of(.25,.25,.25,-.25)]);
  assert.deepEqual(errors,[]);
 }
});
