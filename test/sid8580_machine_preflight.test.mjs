// SPDX-License-Identifier: BSD-3-Clause
// Actual research WASM and original programs; no mock CPU/SID read values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Sid8580MachineCore} from '../docs/sid8580-lab/core.js';
import {finishResearchPreflight} from '../docs/sid8580-lab/preflight.js';
import {createSid8580MachineFixture} from './helpers/sid8580_machine_fixtures.mjs';
import {createPsidVbiMachineFixture} from './helpers/psid_vbi_machine_fixtures.mjs';

const [endpointBinary,machineBinary]=await Promise.all([
  readFile(new URL('../docs/generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url)),
  readFile(new URL('../docs/generated/sid8580-machine/sid8580-machine.wasm',import.meta.url)),
]);
const create=()=>Sid8580MachineCore.create({sampleRate:48000,endpointBinary,machineBinary});
const options={clock:'pal',model:'8580',subtune:1,environment:'minimal'};
function authored(options){
  const original=createPsidVbiMachineFixture(options),bytes=original.bytes.slice();
  // A new declaration on a copy of our own test program. No game file or old
  // helper/header is patched in place.
  assert.equal(new DataView(original.bytes.buffer).getUint16(118),0x14);
  new DataView(bytes.buffer).setUint16(118,0x24);
  assert.equal(new DataView(original.bytes.buffer).getUint16(118),0x14);
  return {...original,bytes};
}
const bytes=output=>Buffer.from(output.buffer,output.byteOffset,output.byteLength);

test('real long initialization completes before the candidate becomes selectable',async()=>{
  const core=await create(),fixture=createSid8580MachineFixture('psid-long-init');
  try{
    const initial=core.load(fixture.bytes,options);
    assert.equal(initial.initPending,true);assert.equal(initial.initReturned,false);assert.equal(initial.playCalls,0);
    const ready=await finishResearchPreflight(core);
    assert.equal(ready.initPending,false);assert.equal(ready.initReturned,true);assert.equal(ready.state,1);
    assert(ready.initCycles>100000&&ready.initCycles<2000000);
    assert(ready.initReturnCycle>100000);assert(ready.positionFrames>0);
    assert.equal(core.readRam(fixture.initCounterAddress),0,'A play call ran before init returned');
    assert.equal(core.readRam(fixture.initMarkerAddress),0xa5);
    const pcm=core.render(1024);assert(pcm.every(Number.isFinite));assert(pcm.some(x=>x!==0));
  }finally{core.dispose();}
});

test('an actual ROM access after the initial100k cycles rejects preflight',async()=>{
  const core=await create(),fixture=authored({delayBlocks:1,delayOuter:110,fault:'late-rom'});
  try{
    const initial=core.load(fixture.bytes,options);assert.equal(initial.initPending,true);assert.equal(initial.errorCode,0);
    await assert.rejects(finishResearchPreflight(core),error=>error.code===4&&error.address===0xe456);
    const failed=core.getState();assert.equal(failed.state,3);assert.equal(failed.initReturned,false);
    assert(failed.cycles>100000);assert.equal(failed.playCalls,0);assert.equal(core.readRam(fixture.initMarkerAddress),0);
  }finally{core.dispose();}
});

test('AbortSignal is observed at a yield and the pending candidate can be stopped immediately',async()=>{
  const core=await create(),fixture=authored({delayBlocks:2,delayOuter:110}),controller=new AbortController();
  let timer;
  try{
    core.load(fixture.bytes,options);assert.equal(core.getState().initPending,true);
    // Queue before the helper's first yield, rather than waiting for the whole
    // synchronous/native initialization to complete.
    timer=setTimeout(()=>controller.abort(),0);
    await assert.rejects(finishResearchPreflight(core,{signal:controller.signal}),{name:'AbortError'});
    const cancelled=core.getState();assert.equal(cancelled.initPending,true);assert.equal(cancelled.initReturned,false);
    assert(cancelled.positionFrames>0);assert(cancelled.cycles<2000000);
    core.stop();const stopped=core.getState();assert.equal(stopped.state,2);
    assert(core.render(4096).every(x=>x===0));assert.deepEqual(core.getState(),stopped);
  }finally{clearTimeout(timer);core.dispose();}
  assert.throws(()=>core.getState(),/disposed/);
});

test('a signal already aborted performs no render or CPU advancement',async()=>{
  const core=await create(),fixture=createSid8580MachineFixture('psid-long-init'),controller=new AbortController();
  try{
    core.load(fixture.bytes,options);const before=core.getState();controller.abort();
    await assert.rejects(finishResearchPreflight(core,{signal:controller.signal}),{name:'AbortError'});
    assert.deepEqual(core.getState(),before);
  }finally{core.dispose();}
});

test('failed and cancelled independent candidates leave old state and future PCM unchanged',async()=>{
  const current=await create(),control=await create(),good=createSid8580MachineFixture('bus-immediate');
  try{
    current.load(good.bytes,options);control.load(good.bytes,options);
    assert.deepEqual(bytes(current.render(1000)),bytes(control.render(1000)));
    const accepted=current.getState();
    for(const mode of ['late-error','abort']){
      const candidate=await create();let timer;
      try{
        const fixture=authored({delayBlocks:1,delayOuter:110,...(mode==='late-error'?{fault:'late-rom'}:{})});
        candidate.load(fixture.bytes,options);
        if(mode==='late-error')await assert.rejects(finishResearchPreflight(candidate),error=>error.code===4);
        else{
          const controller=new AbortController();timer=setTimeout(()=>controller.abort(),0);
          await assert.rejects(finishResearchPreflight(candidate,{signal:controller.signal}),{name:'AbortError'});
        }
      }finally{clearTimeout(timer);candidate.dispose();}
      assert.deepEqual(current.getState(),accepted,'The accepted engine was replaced or advanced');
    }
    assert.deepEqual(bytes(current.render(4096)),bytes(control.render(4096)),'Old future PCM was altered by a candidate');
    assert.deepEqual(current.getState(),control.getState());
  }finally{current.dispose();control.dispose();}
});

test('a genuine nonreturning init reaches the native2M deadline, not an unbounded preflight',async()=>{
  const core=await create(),fixture=authored({delayBlocks:0,fault:'init-loop'});
  try{
    core.load(fixture.bytes,options);assert.equal(core.getState().initPending,true);
    await assert.rejects(finishResearchPreflight(core),error=>error.code===11);
    const failed=core.getState();assert.equal(failed.state,3);assert.equal(failed.initReturned,false);
    assert.equal(failed.initCycleLimit,2000000);assert(failed.initCycles>=failed.initCycleLimit);assert.equal(failed.playCalls,0);
  }finally{core.dispose();}
});
