import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameboyCodeLive,gameboyCodeLiveView} from './code_live.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const state=(marker='first',frames=128)=>({marker,clock:4194304,positionFrames:frames,
  registers:Array.from({length:48},(_,index)=>index),voice:Array(48).fill(0)});
function fixture(options={}){
  let running=false,audio=null,serial=0;
  const timers=new Map(),requests=[],updates=[];
  const engine=()=>({command(method){return new Promise((resolve,reject)=>requests.push({method,resolve,reject}));}});
  const live=createGameboyCodeLive({getAudio:()=>audio,isRunning:()=>running,onUpdate:value=>updates.push(value),
    schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),...options});
  return{live,timers,requests,updates,engine,
    setRunning(value){running=value;},setAudio(value){audio=value;},
    async tick(){assert.equal(timers.size,1);const[id,value]=timers.entries().next().value;timers.delete(id);value.fn();await flush();return value.ms;}};
}

test('unified Auto update Off retains all channels and permits a passive one-shot refresh',async()=>{
  const f=fixture({retainSnapshot:true});f.setAudio(f.engine());f.setRunning(true);f.live.sync();await f.tick();
  f.requests[0].resolve(state('frozen'));await flush();f.live.setEnabled(false);f.live.setVoice(3);
  assert.equal(f.live.read().liveState.marker,'frozen');assert(f.live.read().liveActive);assert.equal(f.timers.size,0);assert.equal(f.requests.length,1);
  const refresh=f.live.refresh();await flush();assert.equal(f.requests.length,2);f.requests[1].resolve(state('manual'));await refresh;
  assert.equal(f.live.read().liveState.marker,'manual');assert.equal(f.live.read().liveVoice,3);assert.equal(f.timers.size,0);
  f.setRunning(false);f.live.sync();assert.equal(f.live.read().liveState,null);f.live.dispose();
});

test('author observation refresh waits for an older request without overlaps or stale freeze data',async()=>{
  const f=fixture({method:'observeEditor',retainSnapshot:true});f.setAudio(f.engine());f.setRunning(true);f.live.sync();await f.tick();
  f.live.setEnabled(false);const refresh=f.live.refresh();await flush();assert.equal(f.requests.length,1);
  f.requests[0].resolve(state('stale'));await flush();assert.equal(f.requests.length,2);assert.equal(f.requests[1].method,'observeEditor');
  f.requests[1].resolve(state('author'));await refresh;assert.equal(f.live.read().liveKind,'editor');assert.equal(f.live.read().liveState.marker,'author');f.live.dispose();
});

test('manual edits patch only their fields into a frozen observation without polling or changing another CH',async()=>{
  const f=fixture({retainSnapshot:true});f.setAudio(f.engine());f.setRunning(true);f.live.sync();await f.tick();
  const original=state('frozen');original.voice[6]=0xe7;original.voice[7]=0x6b;original.registers[21]=0x55;
  f.requests[0].resolve(original);await flush();f.live.setEnabled(false);
  f.live.commitEdit({channel:1,changes:{'pulse.duty':.125,'pan.right':true}});
  const frozen=f.live.read().liveState,view=gameboyCodeLiveView(frozen,1).preset;
  assert.equal(view.pulse.duty,.125);assert.equal(view.pulse.volume,6);assert.deepEqual(view.pulse.envelope,{direction:'up',period:3});
  assert.equal(frozen.voice[6],0x27,'length bits stay frozen');assert.equal(frozen.voice[7],0x6b);
  assert.equal(frozen.registers[21],0x57,'only CH2 right pan changes');assert.equal(frozen.voice[2],original.voice[2]);
  assert.equal(original.voice[6],0xe7,'input snapshot is detached');assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
  f.live.setVoice(0);f.live.setVoice(1);assert.deepEqual(f.live.read().liveState,frozen);
  f.live.commitEdit({channel:2,changes:{'wave.samples':Array.from({length:32},(_,i)=>i%16),'wave.level':.5}});
  assert.deepEqual(gameboyCodeLiveView(f.live.read().liveState,2).preset.wave,{samples:Array.from({length:32},(_,i)=>i%16),level:.5});
  assert.equal(f.live.read().liveState.voice[7],0x6b);f.live.dispose();
});

test('Code Live stays passive, polls at most once per interval and returns detached state',async()=>{
  const f=fixture();assert.equal(f.updates.length,0);f.live.sync();assert.equal(f.timers.size,0);assert.equal(f.requests.length,0);
  f.setRunning(true);f.live.sync();assert.equal(f.timers.size,0,'audio is never created by observation');
  f.setAudio(f.engine());f.live.sync();assert.equal(f.live.read().liveWaiting,true);assert.equal(await f.tick(),0);
  assert.deepEqual(f.requests.map(value=>value.method),['observeCode']);
  for(let i=0;i<10;i++)f.live.sync();assert.equal(f.timers.size,0);assert.equal(f.requests.length,1,'no overlapping requests');
  const snapshot=state();f.requests[0].resolve(snapshot);await flush();
  assert.equal(f.live.read().liveActive,true);assert.equal(f.live.read().liveKind,'code');
  assert.equal([...f.timers.values()][0].ms,50,'20Hz bound remains after each result');
  snapshot.registers[4]=99;f.updates.at(-1).liveState.registers[5]=99;
  assert.equal(f.live.read().liveState.registers[4],4);assert.equal(f.live.read().liveState.registers[5],5);
  f.live.setVoice(2);assert.equal(f.live.read().liveVoice,2);assert.equal(f.requests.length,1,'selecting a CH uses the coherent snapshot');
  assert.equal(await f.tick(),50);assert.equal(f.requests.length,2);
  f.live.dispose();f.requests[1].resolve(state());await flush();assert.equal(f.timers.size,0);
});

test('Off invalidates a pending observation and On waits for it without overlapping or reviving Code',async()=>{
  const f=fixture();f.setAudio(f.engine());f.setRunning(true);f.live.sync();await f.tick();
  f.live.setEnabled(false);const count=f.updates.length;
  assert.equal(f.live.read().liveState,null);assert.equal(f.live.read().liveEnabled,false);assert.equal(f.timers.size,0);
  f.live.setEnabled(true);assert.equal(f.timers.size,0,'one pending RPC is still owned');
  f.requests[0].resolve(state());await flush();
  assert.equal(f.live.read().liveState,null,'an old request cannot become the new On observation');
  assert(f.updates.slice(count).every(value=>value.liveState===null));assert.equal(f.timers.size,1);
  await f.tick();assert.equal(f.requests.length,2);f.requests[1].resolve(state('second',512));await flush();
  assert.equal(f.live.read().liveState.marker,'second');f.live.dispose();
});

test('Stop, a later Run and replacement audio fence all older observations',async()=>{
  const f=fixture(),old=f.engine(),fresh=f.engine();f.setAudio(old);f.setRunning(true);f.live.sync();await f.tick();
  f.setRunning(false);f.live.sync();assert.equal(f.live.read().liveState,null);assert.equal(f.live.read().playing,false);
  f.setAudio(fresh);f.setRunning(true);f.live.sync();f.requests[0].resolve(state('first',999));await flush();
  assert.equal(f.live.read().liveState,null);await f.tick();f.requests[1].resolve(state('second',128));await flush();
  assert.equal(f.live.read().liveState.positionFrames,128);assert.equal(f.live.read().liveState.marker,'second');
  await f.tick();const next=f.engine();f.setAudio(next);f.live.sync();f.requests[2].resolve(state('second',999));await flush();
  assert.equal(f.live.read().liveState,null,'replaced engine response is discarded');
  f.live.dispose();assert.equal(f.timers.size,0);
});

test('observation failures are read-only and retry; session cancellation waits without a false error',async()=>{
  const f=fixture();f.setAudio(f.engine());f.setRunning(true);f.live.sync();await f.tick();
  f.requests[0].resolve(null);await flush();assert.equal(f.live.read().liveWaiting,true);assert.equal(f.live.read().liveError,false);
  await f.tick();f.requests[1].resolve(state());await flush();
  await f.tick();f.requests[2].reject(Error('read failed'));await flush();
  assert.equal(f.live.read().liveError,true);assert.match(f.live.read().liveMessage,/read failed/);assert.equal(f.live.read().liveState.positionFrames,128);
  await f.tick();f.requests[3].reject(new DOMException('session cancelled','AbortError'));await flush();
  assert.equal(f.live.read().liveError,false);assert.equal(f.live.read().liveWaiting,true);assert.equal(f.live.read().liveState,null);
  assert(f.requests.every(value=>value.method==='observeCode'));f.live.dispose();
});

test('Code Live validates its local controls without writing or allocating audio',()=>{
  const f=fixture();for(const value of [-1,4,.5,'1'])assert.throws(()=>f.live.setVoice(value),RangeError);
  assert.throws(()=>f.live.setEnabled(1),TypeError);assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);f.live.dispose();
  assert.throws(()=>createGameboyCodeLive({getAudio:()=>null,isRunning:()=>false,intervalMs:49}),RangeError);
});
