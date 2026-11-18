// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import createSsfPlayerModule from '../generated/ssf-player/ssf_player.js';
import {createScspSsfRenderer} from './ssf_renderer.js';
import {decodeScspSsfDspSnapshot,SCSP_SSF_DSP_SNAPSHOT_WORDS} from './ssf_snapshot.js';
import {prepareScspSsfSource} from './ssf_source.js';
import {createScspSsfDspFixture,createScspSsfDspMotionFixture} from '../../test/helpers/scsp_ssf_dsp_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/ssf-player/ssf_player.wasm',import.meta.url));
const fixture=createScspSsfDspFixture();
const source=await prepareScspSsfSource(fixture.files,fixture.files[0].path);
const render=(renderer,count)=>{const left=new Float32Array(count),right=new Float32Array(count);return {left,right,produced:renderer.process(left,right,count)};};
function words(){const value=new Uint32Array(SCSP_SSF_DSP_SNAPSHOT_WORDS);value.set([0x53445031,1,37,0,512,64,32,16]);return value;}

test('DSP observation decodes every raw word and signed boundary into detached arrays',()=>{
  const raw=words();raw[8]=0x8000;raw[519]=0xffff;raw.set([0x1000,0x1fff,0,0xfff],520);raw[584]=0xabcd;raw.set([0x8000,0xffff,0,0x7fff],616);
  const dsp=decodeScspSsfDspSnapshot(raw,37);assert.equal(dsp.frame,37);
  assert(dsp.program instanceof Uint16Array);assert.equal(dsp.program.length,512);assert.equal(dsp.program[0],0x8000);assert.equal(dsp.program[511],0xffff);
  assert.deepEqual([...dsp.coefficients.slice(0,4)],[-4096,-1,0,4095]);assert.deepEqual([...dsp.outputs.slice(0,4)],[-32768,-1,0,32767]);assert.equal(dsp.addresses[0],0xabcd);
  raw.fill(0);assert.equal(dsp.program[0],0x8000);assert.equal(dsp.coefficients[0],-4096);
});

test('missing, malformed, wrong-frame and out-of-range DSP payloads reject instead of implying silence',()=>{
  for(const value of [undefined,null,[],new Uint16Array(632),new Uint32Array(631)])assert.throws(()=>decodeScspSsfDspSnapshot(value));
  for(const [index,value]of [[0,0],[1,2],[4,511],[5,63],[6,31],[7,15],[8,0x10000],[520,0x2000],[584,0x10000],[616,0x10000]]){
    const raw=words();raw[index]=value;assert.throws(()=>decodeScspSsfDspSnapshot(raw));
  }
  assert.throws(()=>decodeScspSsfDspSnapshot(words(),38),/frame/);
});

test('real 68000 writes yield all128 exact opaque instructions,64 signed coefficients,32 addresses and16 running outputs',async t=>{
  const renderer=await createScspSsfRenderer(source,{wasmBinary});t.after(()=>renderer.dispose());render(renderer,4096);
  const snapshot=renderer.readSnapshot(),dsp=snapshot.dsp;
  assert.equal(dsp.frame,snapshot.frame);assert.deepEqual(dsp.program,fixture.program);assert.deepEqual(dsp.coefficients,fixture.coefficients);assert.deepEqual(dsp.addresses,fixture.addresses);assert.deepEqual(dsp.outputs,fixture.outputs);
  assert.equal(snapshot.slots[0].dsp.input,0);assert.equal(snapshot.slots[0].dsp.send,7);
  snapshot.slots.slice(0,16).forEach((slot,index)=>{assert.equal(slot.dsp.returnLevel,1+index%7);assert.equal(slot.dsp.pan,index*3&31);});
  const frozen=structuredClone(dsp);render(renderer,517);assert.deepEqual(dsp,frozen);assert(renderer.readSnapshot().dsp.frame>dsp.frame);
});

test('DSP and slot observers are passive across short blocks: exact PCM, native time, RAM and slot state',async t=>{
  const observed=await createScspSsfRenderer(source,{wasmBinary}),reference=await createScspSsfRenderer(source,{wasmBinary});t.after(()=>{observed.dispose();reference.dispose();});
  observed.readSnapshot();
  for(let index=0;index<96;index++){
    assert.deepEqual(render(observed,257),render(reference,257));const snapshot=observed.readSnapshot();assert.equal(snapshot.dsp.frame,snapshot.frame);assert.equal(observed.readSnapshot(),snapshot);
  }
  assert.deepEqual(observed.readSnapshot(),reference.readSnapshot());assert.equal(observed.framesRendered,reference.framesRendered);
});

test('later sound-CPU writes update DSP program, coefficient and address observations while prior snapshots stay frozen',async t=>{
  const fixture=createScspSsfDspMotionFixture(),source=await prepareScspSsfSource(fixture.files,fixture.files[0].path),renderer=await createScspSsfRenderer(source,{wasmBinary});t.after(()=>renderer.dispose());
  const coefficients=new Set(),program=new Set(),addresses=new Set();let prior;
  for(let index=0;index<36;index++){
    render(renderer,2048);const snapshot=renderer.readSnapshot();
    if(prior)assert.deepEqual(prior.snapshot,prior.frozen);
    coefficients.add(snapshot.dsp.coefficients[1]);program.add(snapshot.dsp.program[508]);addresses.add(snapshot.dsp.addresses[31]);
    assert.equal(snapshot.dsp.frame,snapshot.frame);prior={snapshot: snapshot.dsp,frozen:structuredClone(snapshot.dsp)};
  }
  assert.deepEqual([...coefficients].sort((a,b)=>a-b),[-2048,-1024]);assert.deepEqual([...program].sort((a,b)=>a-b),[0,0x8000]);assert.deepEqual([...addresses].sort((a,b)=>a-b),fixture.motion.addressValues.sort((a,b)=>a-b));
});

test('native DSP ABI rejects invalid calls and reads without advancing its native frame',async t=>{
  let module,handle;const renderer=await createScspSsfRenderer(source,{wasmBinary,moduleFactory:async options=>{module=await createSsfPlayerModule(options);const create=module._ssf_create;module._ssf_create=(...args)=>(handle=create(...args));return module;}});t.after(()=>renderer.dispose());render(renderer,4096);
  const pointer=module._malloc(632*4);try{
    const frame=module._ssf_native_frame(handle),before=renderer.readSnapshot();
    assert.equal(module._ssf_read_dsp_snapshot(0,pointer,632),0);assert.equal(module._ssf_read_dsp_snapshot(handle,0,632),0);assert.equal(module._ssf_read_dsp_snapshot(handle,pointer,631),0);
    for(let index=0;index<16;index++)assert.equal(module._ssf_read_dsp_snapshot(handle,pointer,632),1);
    assert.equal(module._ssf_native_frame(handle),frame);assert.equal(renderer.readSnapshot(),before);
    const raw=new Uint32Array(module.HEAPU8.buffer,pointer,632).slice();assert.deepEqual(decodeScspSsfDspSnapshot(raw,before.frame),before.dsp);
  }finally{module._free(pointer);}
});

test('legacy ABI3 stays playable with DSP explicitly absent; incomplete ABI4 is rejected',async t=>{
  const renderer=await createScspSsfRenderer(source,{wasmBinary,moduleFactory:async options=>{const module=await createSsfPlayerModule(options);module._ssf_abi_version=()=>3;delete module._ssf_read_dsp_snapshot;return module;}});t.after(()=>renderer.dispose());
  render(renderer,1024);assert(!Object.hasOwn(renderer.readSnapshot(),'dsp'));
  await assert.rejects(createScspSsfRenderer(source,{wasmBinary,moduleFactory:async options=>{const module=await createSsfPlayerModule(options);delete module._ssf_read_dsp_snapshot;return module;}}),/ABI/);
});
