import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createYm2608AdpcmRelease} from './adpcm_audio_receiver.js';
import factory from '../generated/ym2608_wasm.js';
import {Ym2608AudioEngine} from '../js/ym2608audioengine.js';
import {YM2608Synth} from '../js/ym2608synth.js';
import {createDefaultPreset,decodeBase64} from './preset.js';

const release=(owner='note1')=>({type:'synth-adpcm-release',action:'release',owner,durationSeconds:.008});
const cancel=(owner,options={})=>({type:'synth-adpcm-release',action:'cancel',owner,...options});
function fixture(rate=48000) {
  let frame=0,stops=0;const writes=[];
  const physical=(register,value)=>writes.push({register,value,frame});
  const receiver=createYm2608AdpcmRelease({sampleRate:rate,nowFrame:()=>frame,writePhysical:physical,onStop:()=>stops++});
  const raw=(register,value,port=1)=>{const filtered=receiver.filterWrite(port,register,value);physical(register,filtered);return filtered;};
  const move=next=>{while(receiver.nextFrame()<=next){frame=receiver.nextFrame();receiver.advance(frame);}frame=next;receiver.advance(frame);};
  raw(11,192);raw(0,0xb0);writes.length=0;
  return {receiver,writes,raw,move,setFrame(value){frame=value;},get frame(){return frame;},get stops(){return stops;}};
}
for(const rate of [44100,48000])test(`receiver-relative ${rate}Hz release has a complete bounded cosine and leaves native volume zero`,()=>{
  const f=fixture(rate);f.move(2048);assert.equal(f.receiver.receive(release()),true);
  const state=f.receiver.getState(),end=2048+Math.round(rate*.008);
  assert.equal(state.startFrame,2048);assert.equal(state.endFrame,end);
  f.move(end);
  const levels=f.writes.filter(w=>w.register===11);
  assert(levels.length<=256);assert(levels.length>180);
  assert(levels.find(w=>w.value===0).frame<end-4,'zero has rendered before resetting the decoder');
  for(let i=1;i<levels.length;i++)assert(levels[i].value<=levels[i-1].value&&levels[i-1].value-levels[i].value<=1);
  assert.deepEqual(f.writes.slice(-2).map(({register,value})=>[register,value]),[[11,0],[0,1]]);
  assert.equal(f.receiver.getState().physicalVolume,0);assert.equal(f.receiver.getState().nominalVolume,192);assert.equal(f.stops,1);
  f.raw(0,0xb0);assert.deepEqual(f.writes.slice(-2).map(({register,value})=>[register,value]),[[11,192],[0,0xb0]]);
});
test('inverse rounding boundaries match the per-frame envelope for all authored byte levels',()=>{
  for(const rate of [44100,48000])for(let volume=1;volume<=255;volume++) {
    const f=fixture(rate);f.raw(11,volume);f.receiver.receive(release());const end=f.receiver.getState().endFrame;
    let at=0;
    while(f.receiver.nextFrame()!==Infinity) {
      const physical=f.receiver.getState().physicalVolume;let expected=at+1;
      while(expected<end&&Math.round(volume*(1+Math.cos(expected/end*Math.PI))/2)===physical)expected++;
      assert.equal(f.receiver.nextFrame(),expected,`${rate}Hz volume${volume} frame${at}`);
      f.move(expected);at=expected;
    }
    assert.equal(at,end);
  }
});
test('R11 edits and mute/unmute retain the same deadline and latest authored nominal level',()=>{
  const f=fixture();f.receiver.receive(release());const end=f.receiver.getState().endFrame;
  f.move(100);const expected=Math.round(99*(1+Math.cos(100/end*Math.PI))/2);
  assert.equal(f.raw(11,99),expected);assert.equal(f.receiver.getState().endFrame,end);
  assert.equal(f.raw(11,0),0);f.move(200);assert.equal(f.raw(11,87),Math.round(87*(1+Math.cos(200/end*Math.PI))/2));
  f.move(end);assert.equal(f.receiver.getState().nominalVolume,87);assert.equal(f.receiver.getState().physicalVolume,0);
  f.raw(0,0xb0);assert.equal(f.writes.at(-2).value,87);
});
test('raw gate and range writes cancel only the receiver tail and restore nominal before the raw command',()=>{
  for(const register of [0,2,3,4,5,12,13]) {
    const f=fixture();f.receiver.receive(release());f.move(100);const before=f.writes.length;
    f.raw(register,register===0?0xb0:2);const count=f.writes.length;f.move(1000);
    assert.equal(f.writes.length,count);assert.equal(f.receiver.getState().active,false);
    assert.deepEqual(f.writes[before],{register:11,value:192,frame:100});
  }
  const f=fixture();f.receiver.receive(release());f.setFrame(384);f.raw(0,0xb0);f.receiver.advance(384);
  assert(!f.writes.some(w=>w.register===0&&w.value===1),'a raw retrigger at the deadline wins over the old tail');
});
test('owner cancellation restores recent tails but cannot stop or restore a newer gate/release',()=>{
  const f=fixture();f.receiver.receive(release('old'));f.move(120);f.receiver.receive(cancel('old'));
  f.receiver.receive(cancel('old',{restore:true}));assert.equal(f.writes.at(-1).value,192);
  f.raw(0,0xb0);f.receiver.receive(release('new'));const count=f.writes.length;
  f.receiver.receive(cancel('old',{stop:true,restore:true}));assert.equal(f.writes.length,count);assert.equal(f.receiver.getState().owner,'new');
  f.receiver.receive(cancel('new',{stop:true}));assert.deepEqual(f.writes.slice(-2).map(({register,value})=>[register,value]),[[11,0],[0,1]]);
});
test('repeated requests do not extend their deadline; invalid messages preserve the current release',()=>{
  const f=fixture();f.receiver.receive(release());const initial=f.receiver.getState();f.move(100);f.receiver.receive(release());
  assert.equal(f.receiver.getState().endFrame,initial.endFrame);
  for(const message of [release(''),{...release('bad'),durationSeconds:NaN},{...release('bad'),durationSeconds:2},cancel('note1',{stop:'yes'}),{...release('bad'),action:'unknown'}]) {
    f.receiver.receive(message);assert.equal(f.receiver.getState().owner,'note1');assert.equal(f.receiver.getState().endFrame,initial.endFrame);
  }
  assert.equal(f.receiver.getState().rejectedMessages,5);assert.equal(f.receiver.receive({type:'other'}),false);
});
test('reset is silent and filtering unrelated chip registers preserves them',()=>{
  const f=fixture();f.receiver.receive(release());f.move(100);const count=f.writes.length;
  for(const [port,register,value]of [[0,11,7],[0,0x28,0xf0],[1,9,64],[1,10,31],[1,1,0xc2]])assert.equal(f.receiver.filterWrite(port,register,value),value);
  f.receiver.reset();assert.equal(f.writes.length,count);assert.equal(f.receiver.nextFrame(),Infinity);assert.equal(f.receiver.getState().nominalVolume,0);
});

let module;
const moduleFactory=async()=>module??=await factory({wasmBinary:await readFile(new URL('../generated/ym2608_wasm.wasm',import.meta.url))});
async function native(rate) {
  const engine=await Ym2608AudioEngine.create({ym2608ModuleFactory:moduleFactory,outputSampleRate:rate,masterVolume:1});
  let frame=0;const writes=[];
  const physical=(register,value)=>{engine.writeYm2608(1,register,value);writes.push({register,value,frame});};
  const receiver=createYm2608AdpcmRelease({sampleRate:rate,nowFrame:()=>frame,writePhysical:physical});
  const chip=new YM2608Synth({transport:{write:(port,register,value)=>engine.writeYm2608(port,register,receiver.filterWrite(port,register,value)),
    loadAdpcmMemory:(bytes,address)=>engine.loadAdpcmBMemory(bytes,address),reset:()=>{receiver.reset();engine.reset();}}});
  const sample=createDefaultPreset().adpcm;await chip.adpcm.loadMemory(decodeBase64(sample.data),0);
  chip.adpcm.setSample(sample);chip.adpcm.setPlaybackRate(sample.sampleRate);chip.adpcm.setVolume(sample.volume);chip.adpcm.setPan(true,true);chip.adpcm.keyOn({repeat:true});
  function render(frames) {
    const left=new Float32Array(frames);let offset=0;
    while(offset<frames) {
      receiver.advance(frame);const count=Math.min(frames-offset,receiver.nextFrame()-frame);
      const pcm=engine.processFrames(count);left.set(pcm.left,offset);offset+=count;frame+=count;
    }
    receiver.advance(frame);return left;
  }
  return {engine,receiver,chip,writes,render,get frame(){return frame;},dispose:()=>engine.dispose()};
}
for(const rate of [44100,48000])test(`real WASM ${rate}Hz delayed one-command delivery keeps the whole receiver-relative fade`,async()=>{
  for(const hold of [128,640,2176])for(const delayMs of [0,1,3,5,8,15,30]) {
    const delay=Math.ceil(delayMs*rate/1000),f=await native(rate),reference=await native(rate);
    try {
      assert.deepEqual(f.render(hold+delay),reference.render(hold+delay));
      const arrival=f.frame;f.receiver.receive(release());const frames=Math.round(rate*.008);
      assert.equal(f.receiver.getState().startFrame,arrival);assert.equal(f.receiver.getState().endFrame,arrival+frames);
      const actual=f.render(frames+16),continued=reference.render(frames+16);let power=0;
      for(let i=0;i<actual.length;i++) {
        const gain=i>=frames?0:(1+Math.cos(i/frames*Math.PI))/2;
        power+=(actual[i]-continued[i]*gain)**2;
      }
      assert(Math.sqrt(power/actual.length)<.0006,'full native fade agrees with the intended envelope, even after late arrival');
      assert.deepEqual(actual.subarray(0,2),continued.subarray(0,2),'delivery does not create an abrupt first-level cut');
      assert(actual.subarray(frames-3).every(v=>v===0),'the final reset follows already-rendered silence');
      assert.equal(f.writes.find(w=>w.register===0).frame,arrival+frames);
      assert(new Set(f.writes.filter(w=>w.register===11).map(w=>w.frame)).size>180,'delayed delivery cannot collapse the fade into one frame');
      assert.equal(f.chip.adpcm.registers[11],192,'the chip client shadow retains authored volume');
    }finally{f.dispose();reference.dispose();}
  }
});
