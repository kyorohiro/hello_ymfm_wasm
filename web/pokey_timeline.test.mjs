import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePokeyTimeline,createPokeyTimelineCursor,POKEY_TIMELINE_MAX_BYTES} from './pokey_timeline.js';
import {createPokeyTimelineBuilder} from './pokey_timeline_builder.js';

const trace=(data,durationSamples=44100)=>({version:1,clock:1789790,durationSamples,data:Uint8Array.from(data)});
test('POKEY compact timeline preserves canonical sample order and owns caller bytes',()=>{
  const raw=trace([0,15,3,0,1,0xa8,129,1,0,9,0,1,0xa0]),prepared=preparePokeyTimeline(raw);raw.data.fill(255);
  for(const rate of [44100,48000]){const events=[],cursor=createPokeyTimelineCursor(prepared,rate);cursor.advance(0,(reg,value)=>events.push([0,reg,value]));const frame=Math.ceil(129*rate/44100);cursor.advance(frame-1,()=>assert.fail('early write'));cursor.advance(frame,(reg,value)=>events.push([frame,reg,value]));assert.deepEqual(events,[[0,15,3],[0,1,0xa8],[frame,0,9],[frame,1,0xa0]]);}
});
test('POKEY compact preflight rejects malformed, oversized and out-of-duration input',()=>{
  for(const data of [[128],[128,0,0,0],[255,255,255,255,16,0,0],[0,16,0],[0,0],[1,0,0]])assert.throws(()=>preparePokeyTimeline(trace(data,0)),/POKEY timeline/);
  assert.throws(()=>preparePokeyTimeline({...trace([]),data:new Uint8Array(POKEY_TIMELINE_MAX_BYTES+1)}),/8 MiB/);
  assert.deepEqual(preparePokeyTimeline(trace([],10)).data,new Uint8Array());
});
test('POKEY density checks every rolling actual-output 128-frame interval',()=>{
  const data=[];for(let n=0;n<513;n++)data.push(n===256?116:0,1,n&255);
  assert.throws(()=>preparePokeyTimeline(trace(data),{sampleRate:48000}),/one output quantum/);
  assert.doesNotThrow(()=>preparePokeyTimeline(trace(data),{sampleRate:50000}));
  assert.throws(()=>preparePokeyTimeline(trace(Array.from({length:513},()=>[0,1,0]).flat())),/one sample/);
});
test('POKEY builder raw/high state, no-reset adoption and packed rebasing are exact',()=>{
  const builder=createPokeyTimelineBuilder();builder.at(10).writeRegister(15,3);builder.writeRegister(1,0xa6);builder.adoptRegisterState();builder.at(20).keyOff(0);builder.setVolume(0,9);builder.at(30).keyOn(0);
  const result=builder.finish(40);assert.deepEqual([...result.data],[10,15,3,0,1,0xa6,10,1,0xa0,10,1,0xa9]);assert.throws(()=>builder.at(40),/finished/);
  const packed=Uint8Array.from([0,0,7,5,1,0xa8]),copy=createPokeyTimelineBuilder({packedData:packed});packed.fill(255);copy.at(130).packed(0,6,2,135);assert.deepEqual([...copy.finish(200).data],[130,1,0,7,5,1,0xa8]);
});
test('POKEY invalid packed runs do not partially alter builder state',()=>{
  for(const bytes of [[0,1,0xa8,1,16,0],[1,1,0xa8],[0,1,0xa8,128]]){
    const b=createPokeyTimelineBuilder({packedData:Uint8Array.from(bytes)});b.at(10);const before=b._getState();assert.throws(()=>b.packed(0,bytes.length,bytes.length===3?1:2,11));assert.deepEqual(b._getState(),before);assert.equal(b.finish(10).data.length,0);
  }
});
