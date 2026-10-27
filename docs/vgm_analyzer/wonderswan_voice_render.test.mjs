import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import {WonderSwanAudioEngine} from '../../web/wonderswanaudioengine.js';
import {createWonderSwanVoiceSamples} from './wonderswan_voice_samples.js';
import {renderWonderSwanVoicePreview} from './wonderswan_voice_render.js';

const RATE=44100,binary=await readFile(new URL('../generated/wonderswan_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary:binary});
const getFactory=async name=>{assert.equal(name,'wonderswan');return async()=>module;};
const peak=values=>values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);

// Original authored test signals, unrelated to a game/ROM/recorded song. Source
// commands are retained separately from the capture's arrays for comparison.
function fixture({start=0,count=256,clock=3072000}={}){
  const writes=[[0,17,8],[0,20,15],[0,9,0x67],[0,8,0xff],[0,10,0xff],[0,11,0xff],[start,16,0x2f]];
  for(let index=0;index<count;index++)writes.push([start+Math.floor(index*RATE/12000),9,(index*73+19)&255]);
  const end=start+Math.ceil(count*RATE/12000)+30;
  writes.push([end,16,0x0f]);
  writes.sort((a,b)=>a[0]-b[0]);
  return {clock,writes,end,memory:Uint8Array.from({length:64},(_,index)=>(index*29+7)&255)};
}
function captureSource(source){
  const capture=createWonderSwanVoiceSamples(source.clock);
  for(const [time,register,value]of source.writes)capture.write(register,value,time);
  capture.finish(source.end);
  return capture;
}
async function originalPcm(source,{includeWave=false}={}){
  const engine=await WonderSwanAudioEngine.create({moduleFactory:async()=>module,clock:source.clock,outputSampleRate:RATE});
  const left=new Float32Array(source.end),right=new Float32Array(source.end);let position=0;
  try{
    engine.loadWonderSwanMemory(source.memory??new Uint8Array(64));
    const advance=end=>{if(end>position){const pcm=engine.processFrames(end-position);left.set(pcm.left,position);right.set(pcm.right,position);position=end;}};
    for(const [time,register,original]of source.writes){advance(time);const value=register===16&&!includeWave?(original&32?original&0x22:0):original;engine.writeWonderSwan(register,value);}
    advance(source.end);return {left,right,sampleRate:RATE};
  }finally{engine.dispose();}
}
async function compareEveryCapture(source){
  const original=await originalPcm(source),capture=captureSource(source);assert(capture.samples.length);
  for(const sample of capture.samples){
    const pcm=await renderWonderSwanVoicePreview(sample,{getFactory}),start=sample.sourceStartSample,end=start+sample.durationSamples;
    assert.equal(pcm.sampleRate,RATE);assert.equal(pcm.left.length,sample.durationSamples);
    assert.deepEqual(pcm.left,original.left.slice(start,end));assert.deepEqual(pcm.right,original.right.slice(start,end));
  }
  return {capture,original};
}

for(const clock of [3072000,3200011])for(const start of [0,3])test(`WonderSwan Voice PCM preview matches isolated original output, clock ${clock}, source start ${start}`,async()=>{
  const source=fixture({start,clock}),{capture,original}=await compareEveryCapture(source);
  assert.equal(capture.samples.length,1);assert.equal(new Set(capture.samples[0].data).size,256,'every unsigned byte, including high-bit values, is retained');
  assert(peak(original.left)>.05);assert(original.left.some(value=>value<0));assert(original.left.some(value=>value>0));
  const mixed=await originalPcm(source,{includeWave:true});assert.notDeepEqual(mixed.left,original.left,'unrelated loaded wave RAM is deliberately excluded from the Voice preview');
});

test('WonderSwan second ten-second capture preserves a write made after the last native tick',async()=>{
  // The interval starts at sample 1. At boundary 441001 the last native tick
  // was before the write at 441000, so authored and held DAC values differ.
  const source={clock:3072000,end:441101,writes:[[0,17,8],[0,20,15],[0,9,20],[1,16,34],[2,9,40],[440999,9,60],[441000,9,200],[441002,9,240],[441101,16,32]]};
  const {capture}=await compareEveryCapture(source);assert.equal(capture.samples.length,2);
  const second=capture.samples[1];assert.equal(second.sourceStartSample,441001);assert.equal(second.initial.registers[9],200);assert.equal(second.initial.heldRegisters[9],60);
});

test('WonderSwan Voice preview retains same-time routing, output, gate and mode transitions',async()=>{
  const source={clock:3200011,end:201,writes:[
    [0,17,8],[0,20,15],[0,9,20],[3,16,0x2f],[3,9,0],[3,9,255],
    [7,20,8],[9,9,40],[11,20,2],[11,9,210],[15,17,0],[17,9,70],
    [23,17,8],[23,20,5],[23,9,90],[31,30,2],[39,16,0x20],
    [39,9,110],[39,16,0x22],[39,9,130],[47,16,2],[47,9,150],[47,16,0x22],
    [47,20,15],[49,9,190],[79,20,0],[83,20,15],[101,9,0],[123,9,255],[201,16,0],
  ]};
  const {capture,original}=await compareEveryCapture(source);assert.equal(capture.samples.length,3);
  assert.notDeepEqual(original.left,original.right,'original dynamic stereo routing survives capture');
});

test('WonderSwan Voice isolation deliberately excludes the held sample of a preceding wavetable voice',async()=>{
  const source=fixture({start:15,count:64});
  source.writes.push([0,2,255],[0,3,7],[0,16,2]);source.writes.sort((a,b)=>a[0]-b[0]);
  const {capture,original}=await compareEveryCapture(source),full=await originalPcm(source,{includeWave:true});
  const start=capture.samples[0].sourceStartSample;
  assert.equal(capture.samples[0].initial.heldRegisters[16],2);
  assert.equal(original.left[start],0,'the isolated source had no preceding Voice output');
  assert.notEqual(full.left[start],0,'the actual preceding wavetable can hold a non-Voice sample at this point');
});

test('WonderSwan Voice renderer rejects malformed captures before opening a WASM handle',async()=>{
  const sample=captureSource(fixture()).samples[0];let factories=0;
  const getFactory=async()=>{factories++;return async()=>module;};
  const bad=[
    {...sample,kind:'wave'},{...sample,clock:0},{...sample,clock:100000001},{...sample,durationSamples:0},{...sample,durationSamples:441001},
    {...sample,sourceStartSample:-1},{...sample,times:Uint32Array.of(0)},{...sample,times:null},
    {...sample,initial:{...sample.initial,registers:new Uint8Array(31)}},
    {...sample,initial:{...sample.initial,heldRegisters:Array(32).fill(-1)}},
    {...sample,times:[0,1],registers:[9,9],values:[0,256]},
    {...sample,times:[2,1],registers:[9,9],values:[0,1]},
    {...sample,times:[sample.durationSamples+1],registers:[9],values:[0]},
    {...sample,times:[0],registers:[8],values:[0]},
  ];
  for(const value of bad)await assert.rejects(renderWonderSwanVoicePreview(value,{getFactory}),/Invalid WonderSwan Voice PCM capture/);
  assert.equal(factories,0);
  await assert.rejects(renderWonderSwanVoicePreview(sample),/Missing sample factory/);
  const controller=new AbortController();controller.abort();await assert.rejects(renderWonderSwanVoicePreview(sample,{getFactory,signal:controller.signal}),{name:'AbortError'});assert.equal(factories,0);
});

test('WonderSwan Voice renderer cancellation and success each release the actual WASM handle',async()=>{
  const sample=captureSource(fixture({start:3,count:5000})).samples[0];let creates=0,destroys=0;
  const wrapped=new Proxy(module,{get(target,key){if(key==='_wonderswan_create')return(...args)=>{creates++;return target[key](...args);};if(key==='_wonderswan_destroy')return(...args)=>{destroys++;return target[key](...args);};return Reflect.get(target,key);}});
  const getFactory=async()=>async()=>wrapped;
  const controller=new AbortController();setTimeout(()=>controller.abort(),0);
  await assert.rejects(renderWonderSwanVoicePreview(sample,{getFactory,signal:controller.signal}),{name:'AbortError'});
  assert.equal(creates,1);assert.equal(destroys,1);
  const first=await renderWonderSwanVoicePreview(sample,{getFactory}),saved=first.left.slice();
  await renderWonderSwanVoicePreview(sample,{getFactory});assert.equal(creates,3);assert.equal(destroys,3);assert.deepEqual(first.left,saved,'subsequent render/disposal cannot overwrite an exported recording');
});
