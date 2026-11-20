import test from 'node:test';
import assert from 'node:assert/strict';
import { WonderSwanSynth } from '../js/wonderswansynth.js';
import { buildAswanOperations as build, compileAswanOperations as compile, createAswanOperationResetState as reset } from './operations.js';
import { createAswanCodeClient } from './code_endpoint.js';
import { createAswanTimedSnapshot } from './timed_state.js';

function synth() {
  const writes=[];
  const chip=new WonderSwanSynth({transport:{writeRegister(register,value){writes.push({register,value});},writeMemory(){},reset(){}}});
  chip.initialize(); writes.length=0;
  return {chip,writes};
}
test('ASWAN recorder is detached, synchronous and state-free; compilation reuses immediate register math',()=>{
  const {chip,writes}=synth(); let count=0, recorder;
  const plan=build(b=>{count++;recorder=b;b.atSample(0).setVolume(0,4,9);b.atSeconds(.1).setFrequency(0,440);b.atSample(4410).setNoise({enabled:true,type:2,reset:true});b.setNoise({enabled:true,type:2,reset:true});b.setSweep({enabled:true,step:-1,time:3});});
  assert.equal(count,1);assert.equal(writes.length,0);
  assert.throws(()=>recorder.setNote(0,60),/no longer active/);
  const before=chip._getState(), rows=compile(structuredClone(plan),before);
  assert.deepEqual(chip._getState(),before);assert.equal(writes.length,0);
  for(const operation of plan.operations)chip[operation.method](...operation.args);
  assert.deepEqual(rows.map(({register,value})=>({register,value})),writes);
  assert.equal(rows.filter(r=>r.register===0x8e && r.value===26).length,2);
  assert.equal(rows[1].offsetSeconds,.1);
  assert.equal(compile(build(b=>b.atSample(480).setNote(0,'C4'),{referenceSampleRate:48000}),reset())[0].offsetSeconds,.01);
  assert.throws(()=>build(async()=>{}),/synchronous/);
  assert.throws(()=>build(b=>b.atSeconds(.2).atSample(1)),/nondecreasing/);
  assert.throws(()=>compile(build(b=>b.noteOn(0,60)),reset()),/software envelopes/);
  assert.throws(()=>compile(build(b=>b.noteOff(0)),reset()),/software envelopes/);
  assert.throws(()=>compile(build(b=>b.setVolume(0,16)),reset()),/0.*15/);
});
test('ASWAN packed control updates preserve gates, Voice mode and preceding same-time changes',()=>{
  const state=reset();state.registers[16]=0x2b;
  const plan=build(b=>{b.setNoise({enabled:true,type:5});b.setSweep({enabled:true,step:2});b.setNoise({enabled:false});});
  const rows=compile(plan,state), control=rows.filter(r=>r.register===0x90);
  assert.deepEqual(control.map(r=>r.value),[0xab,0xeb,0x6b]);
  assert.equal(state.registers[16],0x2b);
});
test('ASWAN client snapshots are reusable, identity checked and communication-free when supplied or reset',async()=>{
  const {chip}=synth();let requests=0,current=true;
  const initial=chip._getState();let frame=100;
  const client=createAswanCodeClient({metadata:{session:1,channels:4,clock:3072000,instanceId:'test:1'},invoke(){},isCurrent:()=>current,dispose(){current=false;},requestControl:async payload=>{
    requests++;assert.equal(payload.action,'capture');return createAswanTimedSnapshot(chip._getState(),{instanceId:'test:1',frame:frame++,sampleRate:48000});
  }});
  const plan=client.build(b=>b.setNoise({enabled:true}));
  const snapshot=await client.captureState();chip.setVolume(0,1,2);
  const a=await client.compile(plan,{initialState:snapshot}),b=await client.compile(plan,{initialState:snapshot});
  assert.deepEqual(a,b);assert.deepEqual(snapshot.state,initial);assert.equal(requests,1);
  await client.compile(plan,{initialState:'reset'});assert.equal(requests,1);
  await assert.rejects(client.compile(plan,{initialState:'client'}),/Incomplete ASWAN client state/);
  assert.equal(requests,1);
  await client.compile(plan);assert.equal(requests,2);
  await assert.rejects(client.compile(plan,{initialState:{...snapshot,instanceId:'other'}}),/instance/);
  await assert.rejects(client.compile(plan,{initialState:{...snapshot,format:'other'}}),/format/);
  await client.dispose();await assert.rejects(client.compile(plan),{name:'AbortError'});
});


test('ASWAN CH2 stereo operations explicitly reject Voice PCM mode',()=>{
  const state=reset();state.registers[16]=32;
  assert.throws(()=>compile(build(b=>b.setVolume(1,4,4)),state),/Voice PCM feeding/);
  assert.doesNotThrow(()=>compile(build(b=>b.setVolume(0,4,4)),state));
});
