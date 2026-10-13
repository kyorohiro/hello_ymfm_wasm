import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NativeFXEngine} from '../web/native_fx_engine.js';
import {createNativeFXController} from '../web/native_fx.js';

const module=await WebAssembly.compile(await readFile(new URL('../web/native_audio_effect.wasm',import.meta.url)));
function harness(){
 const engine=new NativeFXEngine(module,48000);
 const fx=createNativeFXController(command=>engine.command(structuredClone(command)));
 return {engine,fx};
}

test('native realtime PCM views are reused and refreshed safely after WASM memory growth',()=>{
 const {engine,fx}=harness();fx.setChain([fx.gain({gain:.5})]);
 const input=[new Float32Array(128).fill(.2),new Float32Array(128).fill(-.1)];
 const output=[new Float32Array(128),new Float32Array(128)];
 for(let i=0;i<10;i++)engine.process(input,output);
 const previousInput=engine.input,previousLeft=engine.outputLeft,previousRight=engine.outputRight;
 for(let i=0;i<1000;i++)engine.process(input,output);
 assert.equal(engine.input,previousInput);assert.equal(engine.outputLeft,previousLeft);assert.equal(engine.outputRight,previousRight);
 assert.ok(output[0].every(value=>Math.abs(value-.1)<1e-7));
 assert.ok(output[1].every(value=>Math.abs(value+.05)<1e-7));
 engine.api.memory.grow(1);engine.process(input,output);
 assert.notEqual(engine.input,previousInput);assert.equal(engine.input.buffer,engine.api.memory.buffer);
 assert.equal(engine.outputLeft.buffer,engine.api.memory.buffer);assert.equal(engine.outputRight.buffer,engine.api.memory.buffer);
 assert.ok(output[0].every(value=>Math.abs(value-.1)<1e-7));
 assert.ok(output[1].every(value=>Math.abs(value+.05)<1e-7));
 const short=[new Float32Array(37),new Float32Array(37)];
 engine.process([input[0].subarray(0,37)],short);
 assert.equal(engine.outputLeft.length,37);assert.equal(engine.outputRight.length,37);
 assert.ok(short.every(channel=>channel.every(value=>Math.abs(value-.1)<1e-7)));
});

test('an ambient reverb tail survives render-view changes and control traffic without PCM discontinuities',()=>{
 const a=harness(),b=harness();
 for(const h of [a,b])h.fx.setChain([h.fx.reverb({mix:.24,tone:6200})]);
 let offset=0;
 for(let block=0;block<1200;block++){
  const frames=block%11===0?37:128;
  const input=[Float32Array.from({length:frames},(_,i)=>.2*Math.sin((offset+i)*.007))];
  const left=[new Float32Array(frames),new Float32Array(frames)],right=[new Float32Array(frames),new Float32Array(frames)];
  if(block===700)b.engine.api.memory.grow(1);
  if(block%31===0)b.fx.syncTempo();
  a.engine.process(input,left);b.engine.process(input,right);
  assert.deepEqual(left,right);offset+=frames;
 }
});

test('concurrent native FX ramps finish, cancel and remain finite on the audio clock',()=>{
 const {engine,fx}=harness();
 const units=[fx.filter(),fx.delay(),fx.distortion(),fx.bitcrusher(),fx.wobble(),fx.flanger(),fx.slicer(),fx.chorus()];
 fx.setChain(units);
 const controls=[['cutoff',600],['feedback',.1],['drive',2],['bitDepth',12],['depth',200],['depth',.001],['floor',.2],['depth',.003]];
 for(let i=0;i<units.length;i++)units[i][controls[i][0]].rampTo(controls[i][1],.02);
 const output=[new Float32Array(128),new Float32Array(128)],input=[Float32Array.from({length:128},(_,i)=>.03*Math.sin(i*.1))];
 for(let block=0;block<20;block++){engine.process(input,output);assert.ok(output.every(channel=>channel.every(Number.isFinite)));}
 assert.equal(engine.ramps.size,0);
 for(let i=0;i<units.length;i++)assert.equal(engine.units.get(units[i].type+units[i].slot).values[controls[i][0]],controls[i][1]);
 units[0].cutoff.rampTo(1800,1);engine.process(input,output);
 units[0].cutoff.set(800);assert.equal(engine.ramps.size,0);
 engine.process(input,output);assert.equal(engine.units.get('filter0').values.cutoff,800);
});
