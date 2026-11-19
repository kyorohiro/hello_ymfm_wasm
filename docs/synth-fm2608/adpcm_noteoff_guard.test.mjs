import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceQueue} from '../js/playground_performance_queue.js';
import {createFm2608AdpcmNoteOffGuard,FM2608_ADPCM_RELEASE_SECONDS,FM2608_ADPCM_RELEASE_STEPS} from './adpcm_noteoff_guard.js';

function fixture(rate = 48000) {
  let frame = 0;
  const state = {volume:192,muted:false,gate:true},physical = [],messages = [];
  const apply = command => physical.push({...command,frame});
  const queue = createPerformanceQueue({sampleRate:rate,nowFrame:() => frame,apply});
  const send = message => { messages.push(message); assert(queue.receive(message)); };
  const guard = createFm2608AdpcmNoteOffGuard({postMessage:send,writePhysical:writes => writes.forEach(apply),
    now:() => frame / rate,sampleRate:rate,getVolume:() => state.volume,getMuted:() => state.muted,
    getGate:() => state.gate,requestedOff:() => { state.gate = false; }});
  const advance = next => { for (;frame <= next;frame++) queue.advance(frame); frame = next; };
  return {state,physical,messages,queue,guard,advance,get frame() { return frame; }};
}
for (const rate of [44100,48000]) test(`ADPCM release uses bounded smooth audio-frame level changes at ${rate} Hz and preserves authored level`,() => {
  const f = fixture(rate); assert(f.guard.noteOff()); assert.equal(f.state.gate,false); assert.equal(f.state.volume,192);
  const state = f.guard.getState(); assert(Math.abs(state.end-state.start-FM2608_ADPCM_RELEASE_SECONDS)<1e-12);
  const events = f.messages.filter(value => value.performance);
  assert.equal(events.length,193,'192 single-level changes plus the final Stop/restore');
  assert(events.length<=FM2608_ADPCM_RELEASE_STEPS);
  const levels=[192,...events.map(event=>event.commands[0].value)];
  for(let i=1;i<levels.length;i++)assert(levels[i]<=levels[i-1]&&levels[i-1]-levels[i]<=1,'single-LSB downward changes');
  const firstZero=events.find(event=>event.commands[0].value===0);
  assert(Math.round(firstZero.performance.time*rate)<Math.round(state.end*rate)-4,'rounded cosine reaches zero before decoder Stop');
  assert.equal(Math.round(state.start*rate),128);
  assert.equal(Math.round(state.end*rate),128+Math.round(.012*rate));
  f.advance(Math.round(state.end*rate));
  assert.equal(f.physical.filter(value => value.register === 0 && value.value === 1).length,1);
  assert.deepEqual(f.physical.slice(-3).map(({register,value}) => [register,value]),[[11,0],[0,1],[11,192]]);
  assert.equal(f.state.volume,192); assert.equal(f.queue.nextFrame(),Infinity);
});
test('smooth release bounds queued work for every authored byte-level volume',() => {
  for(const volume of [1,2,24,99,192,255]){
    const f=fixture();f.state.volume=volume;f.guard.noteOff();
    const events=f.messages.filter(value=>value.performance);
    assert(events.length<=Math.min(256,volume+1));
    assert.equal(events.at(-1).commands.at(-1).value,volume);
    f.advance(1200);assert.equal(f.physical.at(-1).value,volume);
  }
});
test('a repeated high-level release never restarts or extends its pending tail',() => {
  const f = fixture(); f.guard.noteOff(); const before = f.messages.length, end = f.guard.getState().end;
  f.advance(160); assert.equal(f.guard.noteOff(),false); assert.equal(f.messages.length,before); assert.equal(f.guard.getState().end,end);
});
test('retrigger cancels only its release owner and preserves unrelated same-session FM/SSG events',() => {
  const f = fixture();
  f.queue.receive({performance:{session:1,owner:'unrelated-code',time:.006},commands:[{type:'write',port:0,register:8,value:10}]});
  f.guard.noteOff(); f.advance(180); f.guard.cancel({restore:true}); f.state.gate = true;
  f.advance(2000);
  assert(f.physical.some(value => value.port === 0 && value.register === 8 && value.value === 10));
  assert(!f.physical.some(value => value.register === 0 && value.value === 1),'old release cannot stop the new note');
  assert.equal(f.physical.filter(value => value.register === 11).at(-1).value,192);
  assert.equal(f.messages.filter(value => value.type === 'performance-start').length,1);
  assert(!f.messages.some(value => value.type === 'performance-stop'));
});
test('concurrent volume edits scale the remaining tail without changing canonical volume or its deadline',() => {
  const f = fixture(); f.guard.noteOff(); const end = f.guard.getState().end;
  f.advance(300); const remaining = f.guard.getState().fraction; f.state.volume = 99; f.guard.volumeChanged();
  assert.equal(f.guard.getState().end,end); assert.equal(f.guard.filterVolume(99),Math.round(99*remaining));
  const before=f.physical.length;
  f.advance(1000); assert.equal(f.physical.at(-1).value,99); assert.equal(f.state.volume,99);
  assert(f.physical.slice(before,-1).every(write=>write.register!==11||write.value<=Math.round(99*remaining)),
    'the old owner cannot leak its larger levels or restore after retargeting');
  assert.equal(f.physical.filter(value => value.register === 0 && value.value === 1).length,1);
});
test('cancel after repeated volume retargets retires every old smooth release owner',() => {
  const f=fixture();f.guard.noteOff();const end=f.guard.getState().end;
  for(const [at,volume] of [[200,99],[300,87],[400,123]]){
    f.advance(at);f.state.volume=volume;f.guard.volumeChanged();assert.equal(f.guard.getState().end,end);
  }
  f.guard.cancel({restore:true});f.state.gate=true;
  const before=f.physical.length;f.advance(2000);
  assert.equal(f.physical.length,before,'no old ramp, Stop or restore reaches the new voice');
  assert.equal(f.physical.at(-1).value,123);assert.equal(f.state.volume,123);
});
test('mute/unmute during release keeps physical writes muted and retains the requested level',() => {
  const f = fixture(); f.guard.noteOff(); f.advance(200); f.state.muted = true; f.guard.volumeChanged();
  const before = f.physical.length; f.advance(320); assert(f.physical.slice(before).every(value => value.register !== 11 || value.value === 0));
  f.state.muted = false; f.guard.volumeChanged(); f.advance(1000);
  assert.equal(f.physical.at(-1).value,192); assert.equal(f.state.volume,192);
});
test('raw stop cleanup restores the nominal level after decoder stop and fences every queued callback',() => {
  const f = fixture(); f.guard.noteOff(); f.advance(240); f.guard.cancel();
  f.physical.push({port:1,register:0,value:1,frame:f.frame}); f.guard.restore();
  const count = f.physical.length; f.advance(2000); assert.equal(f.physical.length,count);
  assert.deepEqual(f.physical.slice(-2).map(({register,value}) => [register,value]),[[0,1],[11,192]]);
});
test('zero-level and unsupported offline transports stop immediately without inventing timers',() => {
  const f = fixture(); f.state.volume = 0; assert.equal(f.guard.noteOff(),false);
  assert.equal(f.messages.filter(value => value.performance).length,0); assert.equal(f.physical.at(-1).register,0);
  const writes = [],guard = createFm2608AdpcmNoteOffGuard({writePhysical:values => writes.push(...values),getVolume:() => 192,getGate:() => true});
  assert.equal(guard.noteOff(),false); assert.deepEqual(writes.map(({register,value}) => [register,value]),[[0,1]]);
});
test('dispose retires release writes while leaving the shared queue and unrelated event intact',() => {
  const f = fixture(); f.guard.noteOff();
  f.queue.receive({performance:{session:1,owner:'other',time:.02},commands:[{type:'write',port:0,register:9,value:8}]});
  f.guard.dispose(); f.advance(2000); assert.deepEqual(f.physical.map(({port,register,value}) => [port,register,value]),[[0,9,8]]);
  assert.equal(f.guard.noteOff(),false); assert.equal(f.queue.getStats().activeSession,1);
});


test('ordinary raw volume writes after a completed tail do not trigger another stop or restore',() => {
  const f=fixture();f.guard.noteOff();f.advance(1200);
  const writes=f.physical.length,messages=f.messages.length;f.state.volume=87;f.guard.volumeChanged();
  assert.equal(f.guard.filterVolume(87),87);assert.equal(f.physical.length,writes);assert.equal(f.messages.length,messages);
});
