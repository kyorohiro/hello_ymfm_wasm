// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608AudioOwnedRelease} from './adpcm_audio_release.js';

function fixture(sampleRate=48000,sender=true) {
  const state={time:0,volume:192,muted:false,gate:true,offRequests:0},messages=[],physical=[];
  const guard=createFm2608AudioOwnedRelease({sampleRate,now:() => state.time,
    getVolume:() => state.volume,getMuted:() => state.muted,getGate:() => state.gate,
    requestedOff() {state.gate=false;state.offRequests++;},
    postMessage:sender?message => messages.push(structuredClone(message)):null,
    writePhysical:writes => physical.push(...writes)});
  return {state,messages,physical,guard};
}

for(const rate of [44100,48000])test(`audio-owned release sends one arrival-relative command at ${rate}Hz`,() => {
  const f=fixture(rate);
  assert.deepEqual(f.messages,[],'construction does not start or reset a performance session');
  f.state.time=7;
  assert.equal(f.guard.noteOff(),true);
  assert.equal(f.state.gate,false);assert.equal(f.state.volume,192);assert.equal(f.state.offRequests,1);
  assert.deepEqual(f.physical,[],'main does not mute or stop before the audio owner fades');
  assert.equal(f.messages.length,1);
  const message=f.messages[0];assert.match(message.owner,/^fm2608-adpcm-release:\d+$/);
  assert.deepEqual(message,{type:'synth-adpcm-release',action:'release',owner:message.owner,durationSeconds:.012});
  assert.deepEqual(Object.keys(message).sort(),['action','durationSeconds','owner','type'],
    'neither a stale main-thread deadline nor a captured nominal volume is transmitted');
  const diagnostic=f.guard.getState();assert.equal(diagnostic.start,7);assert(Math.abs(diagnostic.end-7-.012)<1e-12);
  assert.equal(diagnostic.pending,true);assert.equal(diagnostic.needsRestore,true);
});

test('repeated noteOff cannot restart or extend a release, even after its estimated main deadline',() => {
  const f=fixture();f.guard.noteOff();const first=f.messages[0],end=f.guard.getState().end;
  f.state.time=10;
  assert.equal(f.guard.getState().pending,false,'main diagnostics do not pretend to be renderer acknowledgement');
  assert.equal(f.guard.noteOff(),false);
  assert.equal(f.messages.length,1);assert.equal(f.guard.getState().end,end);
  assert.equal(f.guard.cancel({restore:true}),true);
  assert.deepEqual(f.messages[1],{type:'synth-adpcm-release',action:'cancel',owner:first.owner,stop:false,restore:true},
    'a delayed request is still canceled by its exact old owner');
  assert.deepEqual(f.physical,[]);
});

test('volume and mute changes are handled by audio-owner raw writes without main retarget messages',() => {
  const f=fixture();f.guard.noteOff();const owner=f.messages[0].owner;
  for(const [time,volume,muted] of [[.002,99,false],[.004,37,true],[2,123,false]]) {
    Object.assign(f.state,{time,volume,muted});f.guard.volumeChanged();
    assert.equal(f.guard.filterVolume(volume),volume);
  }
  assert.equal(f.messages.length,1);assert.equal(f.guard.getState().owner,owner);
  assert.deepEqual(f.physical,[]);assert.equal(f.state.volume,123);
});

test('retrigger cancellation delegates stop/restore to the receiver and reserves a distinct next owner',() => {
  const f=fixture();f.guard.noteOff();const owner=f.messages[0].owner;
  assert(f.guard.cancel({stop:true,restore:true}));
  assert.deepEqual(f.messages[1],{type:'synth-adpcm-release',action:'cancel',owner,stop:true,restore:true});
  assert.equal(f.state.offRequests,2);assert.equal(f.guard.getState().needsRestore,false);
  assert.deepEqual(f.physical,[],'cancel cannot race a new voice with a separate main-thread physical stop');
  f.state.gate=true;f.guard.noteOff();assert.notEqual(f.messages[2].owner,owner);
  assert.equal(f.messages[2].action,'release');assert.equal(f.messages.length,3);
});

test('plain cancellation retains its recent owner for a subsequent receiver-owned restore',() => {
  const f=fixture();f.guard.noteOff();const owner=f.messages[0].owner;
  assert(f.guard.cancel());assert.deepEqual(f.guard.getState(),{pending:false,needsRestore:true});
  f.state.volume=87;assert(f.guard.cancel({restore:true}));
  assert.equal(f.messages.at(-1).owner,owner);assert.equal(f.messages.at(-1).restore,true);
  assert.deepEqual(f.physical,[]);f.guard.restore();assert.deepEqual(f.physical,[]);
  assert.equal(f.guard.cancel({stop:true,restore:true}),false);
});

test('raw Stop cleanup explicitly restores only the latest nominal physical volume',() => {
  const f=fixture();f.guard.noteOff();f.guard.cancel();
  f.state.volume=123;f.guard.restore();
  assert.deepEqual(f.physical,[{type:'write',port:1,register:11,value:123}]);
  assert.equal(f.guard.getState().needsRestore,false);
  f.guard.restore();assert.equal(f.physical.length,1,'restore is idempotent');
  const muted=fixture();muted.guard.noteOff();muted.guard.cancel();muted.state.muted=true;muted.guard.restore();
  assert.equal(muted.physical[0].value,0);assert.equal(muted.state.volume,192,'muting does not change the authored volume');
});

test('unsupported, already-off, muted and zero-level transports stop immediately',() => {
  for(const setup of [f => {f.state.gate=false;},f => {f.state.muted=true;},f => {f.state.volume=0;}]) {
    const f=fixture();setup(f);assert.equal(f.guard.noteOff(),false);
    assert.deepEqual(f.messages,[]);assert.deepEqual(f.physical,[{type:'write',port:1,register:0,value:1}]);
    assert.equal(f.state.gate,false);assert.deepEqual(f.guard.getState(),{pending:false,needsRestore:false});
  }
  const offline=fixture(48000,false);assert.equal(offline.guard.noteOff(),false);
  assert.deepEqual(offline.physical,[{type:'write',port:1,register:0,value:1}]);
});

test('client instances never reuse release owners and dispose only cancels its named request',() => {
  const first=fixture(),second=fixture();first.guard.noteOff();second.guard.noteOff();
  assert.notEqual(first.messages[0].owner,second.messages[0].owner);
  first.guard.dispose();const cancellation=first.messages[1];
  assert.equal(cancellation.owner,first.messages[0].owner);assert.equal(cancellation.action,'cancel');
  assert.equal(cancellation.stop,false);assert.equal(cancellation.restore,false);
  assert.deepEqual(first.physical,[]);assert.equal(second.messages.length,1);
  first.guard.dispose();first.guard.restore();first.guard.volumeChanged();
  assert.equal(first.guard.noteOff(),false);assert.equal(first.guard.cancel({stop:true,restore:true}),false);
  assert.equal(first.messages.length,2);assert.deepEqual(first.physical,[]);
});

test('invalid callback and sample-clock configuration is rejected',() => {
  const options={writePhysical() {},getGate:() => true,getVolume:() => 192};
  assert.throws(() => createFm2608AudioOwnedRelease(),/callbacks/);
  assert.throws(() => createFm2608AudioOwnedRelease({...options,postMessage:42}),/sender/);
  assert.throws(() => createFm2608AudioOwnedRelease({...options,sampleRate:0}),/sample rate/);
});
