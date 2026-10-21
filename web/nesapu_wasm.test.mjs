import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {NesApu} from './nesapu.js';
import {NesApuSynth,NesApuDirectTransport} from './nesapusynth.js';
import {createSoundChip} from './soundchip.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {ChipClockResampler,CHIP_CLOCKS} from './playground_chip_clock.js';
import {NesVoiceInspector} from './playground_native_voice_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import factory from '../docs/generated/nesapu_wasm.js';

const wasmBinary=await readFile(new URL('../docs/generated/nesapu_wasm.wasm',import.meta.url));
test('asynchronous NES defaults to real WASM while the synchronous constructor stays an explicit JS reference',async()=>{
  const reference=new NesApu({fds:true}),chip=await NesApu.create({fds:true,sampleRate:48000});
  try{assert.equal(reference.backend,'javascript');assert.equal(chip.backend,'wasm');assert.equal(chip.sampleRate(),48000);assert.equal(chip.engine,undefined);assert.equal(chip.getState().fdsEnabled,true);}
  finally{reference.dispose();chip.dispose();}
  await assert.rejects(NesApu.create({moduleFactory:async()=>{throw new Error('WASM unavailable');}}),/WASM unavailable/);
  const controller=new AbortController();controller.abort();await assert.rejects(NesApu.create({signal:controller.signal}),/abort/i);
});

test('injected module loaders preserve options and preallocate stable PCM views and RAM staging',async()=>{
  let module,allocations=0,seen;
  const chip=await createSoundChip('nes',{fds:true,moduleFactory:async options=>{seen=options;module=await factory(options);const malloc=module._malloc;module._malloc=bytes=>{allocations++;return malloc(bytes);};return module;},moduleOptions:{wasmBinary,customOption:'retained'}});
  try{
    assert.equal(seen.customOption,'retained');const initial=allocations,views=Array.from({length:129},(_,frames)=>chip.generateStereoView(frames));
    for(let iteration=0;iteration<5;iteration++)for(let frames=0;frames<=128;frames++)assert.equal(chip.generateStereoView(frames),views[frames]);
    chip.loadMemory(new Uint8Array(65536),0);assert.equal(allocations,initial,'render spans and full RAM uploads use preallocated WASM storage');
    assert.equal(chip.readMemory(0),0);const owned=chip.generateStereo(128),saved=owned.left.slice();
    const ptr=module._malloc(module.HEAPU8.buffer.byteLength+65536);assert(ptr);chip.generateStereoView(128);assert(chip.getState().registers.length===144);module._free(ptr);
    chip.generateStereo(1024);assert.deepEqual(owned.left,saved);chip.dispose();assert.deepEqual(owned.left,saved);assert.throws(()=>chip.generateStereo(1),/disposed/);
  }finally{chip.dispose();}
});

test('NES default loader honors a caller-supplied locateFile without a WASM binary override',async()=>{
  const located=[],url=new URL('../docs/generated/nesapu_wasm.wasm',import.meta.url);
  const chip=await NesApu.create({moduleOptions:{locateFile(name){located.push(name);return url.href;},print(){},printErr(){}}});
  try{assert.equal(chip.backend,'wasm');assert.deepEqual(located,['nesapu_wasm.wasm']);assert.equal(chip.generateStereoView(128).left.length,128);}
  finally{chip.dispose();}
});

test('WASM NES address, memory, FDS, mute and frame bounds match the public contract',async()=>{
  const chip=await NesApu.create();try{
    for(const fn of [()=>chip.writeRegister(0x4030,0),()=>chip.writeRegister(0x4000,256),()=>chip.writeRegister(0x4080,128),()=>chip.loadMemory(new Uint8Array(2),65535),()=>chip.setChannelEnabled(5,true),()=>chip.setChannelMuted(5,true),()=>chip.generateStereo(-1)])assert.throws(fn);
    chip.loadMemory(new Uint8Array(0),65536);chip.loadMemory(new Uint8Array([85,170]),0xc000);assert.equal(chip.readMemory(0xc000),85);
    chip.setChannelMuted(0,true);assert.equal(chip.getState().muteMask,1);chip.reset();assert.equal(chip.getState().muteMask,1);assert.equal(chip.readMemory(0xc000),0);
  }finally{chip.dispose();}
});

for(const sampleRate of [44100,48000,96000])test(`WASM wrapper PCM matches the synchronous JS reference at ${sampleRate} Hz`,async()=>{
  const chip=await NesApu.create({fds:true,sampleRate}),reference=new NesApu({fds:true,sampleRate});
  try{
    for(const target of [chip,reference]){
      const synth=new NesApuSynth({transport:new NesApuDirectTransport(target)});synth.pulse.noteOn(0,'C4');synth.triangle.noteOn('E3');synth.noise.setVoice({volume:3,period:7});synth.noise.noteOn();synth.fds.setWave(Array.from({length:64},(_,index)=>index));synth.fds.setModulation({table:Array.from({length:32},(_,index)=>index%8),rate:150,depth:4});synth.fds.noteOn('G4');
      await synth.dmc.loadSample(new Uint8Array(17).fill(85));synth.dmc.play({loop:true,rate:10});
    }
    for(const frames of [1,37,128,1024,4096]){const actual=chip.generateStereo(frames),expected=reference.generateStereo(frames);assert.deepEqual(actual,expected);}
  }finally{chip.dispose();reference.dispose();}
});

async function pendingProcessor(){
  const source=(await readFile(new URL('./playground_nes_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  let resolve,reject,Processor;const pending=new Promise((r,j)=>{resolve=r;reject=j;}),messages=[];
  vm.runInNewContext(source,{sampleRate:48000,factory:{},CHIP_CLOCKS,ChipClockResampler,NesVoiceInspector,receiveChipInspector,
    NesApuWasm:{create:()=>pending},createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)};}},registerProcessor(_name,Value){Processor=Value;}});
  const processor=new Processor({processorOptions:{fds:true,wasmBinary}});return {processor,messages,resolve,reject};
}
test('NES Worklet initializes asynchronously, outputs silence meanwhile, and disposes a late module without Ready',async()=>{
  const p=await pendingProcessor(),output=[new Float32Array(128).fill(1),new Float32Array(128).fill(1)];
  assert.equal(p.processor.process([],[output]),true);assert(output.every(channel=>channel.every(value=>value===0)));
  p.processor.receive({method:'dispose'},p.processor.port);let disposed=0;p.resolve({dispose(){disposed++;}});await p.processor.initializing;
  assert.equal(disposed,1);assert.equal(p.processor.process([],[output]),false);assert.equal(p.messages.some(message=>message.ready),false);
});
test('NES Worklet initialization failures stay visible and never start the JS reference renderer',async()=>{
  const p=await pendingProcessor();p.reject(new Error('WASM instantiate failed'));await p.processor.initializing;
  assert.equal(p.processor.dead,true);assert.equal(p.messages[0].error,'WASM instantiate failed');assert.equal(p.processor.chip,null);
});
