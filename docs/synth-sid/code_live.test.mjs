import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidCodeLive} from './code_live.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const state=(model='6581',frames=128)=>({model,clockHz:985248,sampleRate:48000,positionFrames:frames,
  registers:Array.from({length:32},(_,index)=>index),voices:[{envelope:model==='8580'?null:123},{envelope:0},{envelope:0}]});
function fixture(){
  let running=false,audio=null,serial=0;
  const timers=new Map(),requests=[],updates=[];
  const engine=()=>({command(method){return new Promise((resolve,reject)=>requests.push({method,resolve,reject}));}});
  const live=createSidCodeLive({getAudio:()=>audio,isRunning:()=>running,onUpdate:value=>updates.push(value),
    schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
  return{live,timers,requests,updates,engine,
    setRunning(value){running=value;},setAudio(value){audio=value;},
    async tick(){assert.equal(timers.size,1);const[id,value]=timers.entries().next().value;timers.delete(id);value.fn();await flush();return value.ms;}};
}

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
  await f.tick();assert.equal(f.requests.length,2);f.requests[1].resolve(state('8580',512));await flush();
  assert.equal(f.live.read().liveState.model,'8580');f.live.dispose();
});

test('Stop, a later Run and replacement audio fence all older observations',async()=>{
  const f=fixture(),old=f.engine(),fresh=f.engine();f.setAudio(old);f.setRunning(true);f.live.sync();await f.tick();
  f.setRunning(false);f.live.sync();assert.equal(f.live.read().liveState,null);assert.equal(f.live.read().playing,false);
  f.setAudio(fresh);f.setRunning(true);f.live.sync();f.requests[0].resolve(state('6581',999));await flush();
  assert.equal(f.live.read().liveState,null);await f.tick();f.requests[1].resolve(state('8580',128));await flush();
  assert.equal(f.live.read().liveState.positionFrames,128);assert.equal(f.live.read().liveState.model,'8580');
  await f.tick();const next=f.engine();f.setAudio(next);f.live.sync();f.requests[2].resolve(state('8580',999));await flush();
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
  const f=fixture();for(const value of [-1,3,.5,'1'])assert.throws(()=>f.live.setVoice(value),RangeError);
  assert.throws(()=>f.live.setEnabled(1),TypeError);assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);f.live.dispose();
  assert.throws(()=>createSidCodeLive({getAudio:()=>null,isRunning:()=>false,intervalMs:49}),RangeError);
});
