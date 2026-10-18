import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/spc_wasm.js';
import {SpcCore} from './spc.js';
import {createSyntheticSpc} from './spc_test_fixture.mjs';

const wasmBinary = await readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url));
const module = await factory({wasmBinary}), options = {moduleFactory:async () => module};
function eventSpc(settings = {}) {
  const bytes = createSyntheticSpc(settings);
  bytes.set([0x8f,0,0xf2,0xe8,0x20,0xc4,0xf3,0xbc,0x2f,0xfb],0x100+0x200);
  return bytes;
}
function render(core,count = 128) {
  const channels = [new Float32Array(count),new Float32Array(count)]; core.renderInto(...channels); return channels;
}
async function core(t, bytes) {const result=await SpcCore.create(options); t.after(()=>result.dispose()); result.load(bytes); return result;}

for (const settings of [{voices:1},{voices:3,echo:true,noise:true,pmon:true}]) test('live DSP observation changes neither PCM nor offline trace, including overflow',async t=>{
  const bytes=eventSpc(settings), reference=await core(t,bytes), observed=await core(t,bytes);
  observed.beginTrace(); observed.startDspObservation({capacity:16});
  assert.deepEqual(render(observed,512),render(reference,512),'bounded overflow cannot stop or change synthesis');
  const buffer=new Float64Array(48),count=observed.drainDspEventsInto(buffer),lost=observed.takeDspEventOverflow();
  assert.equal(count,16); assert.ok(lost>0); assert.equal(observed.takeDspEventOverflow(),0);
  assert.equal(observed.drainDspEventsInto(buffer),0);
  const trace=observed.endTrace(),all=[];
  for(let i=0;i<trace.events.length;i+=4)if(trace.events[i+1]===0)all.push(trace.events[i],trace.events[i+2],trace.events[i+3]);
  assert.deepEqual(Array.from(buffer),all.slice(0,48)); assert.equal(all.length/3,count+lost);
  assert.deepEqual(render(observed),render(reference));
});

test('late observation keeps absolute clocks and phase, repeated drains preserve chronology',async t=>{
  const bytes=eventSpc({echo:true}), reference=await core(t,bytes), observed=await core(t,bytes);
  assert.deepEqual(render(observed,256),render(reference,256));
  observed.startDspObservation({capacity:2048}); const buffer=new Float64Array(2048*3); let previous=256*32;
  for(let round=0;round<8;round++){
    assert.deepEqual(render(observed),render(reference)); const count=observed.drainDspEventsInto(buffer);
    assert.ok(count>0); assert.equal(observed.takeDspEventOverflow(),0);
    for(let index=0;index<count;index++){assert.ok(buffer[index*3]>=previous); assert.ok(buffer[index*3]<=observed.nativeFrames*32); previous=buffer[index*3];}
  }
  observed.stopDspObservation(); assert.deepEqual(render(observed),render(reference)); assert.equal(observed.drainDspEventsInto(buffer),0);
});

test('observer state, fixed buffers and resets are independent between instances',async t=>{
  const a=await core(t,eventSpc()), b=await core(t,eventSpc({noise:true}));
  a.startDspObservation({capacity:16}); b.startDspObservation({capacity:2048}); render(a); render(b);
  const first=new Float64Array(48),second=new Float64Array(6144);assert.equal(a.drainDspEventsInto(first),16);assert.ok(b.drainDspEventsInto(second)>16);
  assert.ok(a.takeDspEventOverflow()>0);assert.equal(b.takeDspEventOverflow(),0);
  const dsp=new Uint8Array(128);b.readDspRegistersInto(dsp);assert.equal(dsp[0x3d],1);
  a.load(eventSpc()); render(a);assert.equal(a.drainDspEventsInto(first),0,'load disables old observation');
  a.startDspObservation({capacity:16});a.dispose();assert.throws(()=>a.drainDspEventsInto(first),/disposed/);
  for(const capacity of [0,15,8193,NaN])assert.throws(()=>b.startDspObservation({capacity}),/capacity/);
  assert.throws(()=>b.drainDspEventsInto(new Float64Array(1)),/capacity/);assert.throws(()=>b.readDspRegistersInto(new Uint8Array(1)),/128/);
});
