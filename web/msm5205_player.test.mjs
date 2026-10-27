import test from 'node:test';
import assert from 'node:assert/strict';
import {createMsm5205Player} from './msm5205_player.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
function fixture(){const calls=[];let gate;return {calls,hold(){gate=deferred();return gate;},async prepare(data,name,{signal}){calls.push({type:'prepare',data,name,signal});const wait=gate;gate=null;if(wait)await wait.promise;signal.throwIfAborted();},async command(action,timing){calls.push({...action,timing});return {state:'ready',sourceBytes:8};},dispose(){calls.push({type:'dispose'});}};}
test('raw VFS bytes retain nibble units, range validation, loaded default rate and mixer state',async()=>{
 const adapter=fixture(),bytes=new Uint8Array([0x12,0x34,0x56]),player=createMsm5205Player(adapter,{readFile:async()=>bytes,getMix:()=>({volume:.4,pan:-1,effectiveMuted:true})});
 assert.deepEqual(await player.loadMemory('/drum.adpcm'),{bytes:3,frames:6,rate:15});
 await player.play({offset:1,length:3,rate:12,loop:true,at:2});assert.deepEqual(adapter.calls.at(-1),{type:'play',offset:1,length:3,rate:12,loop:true,timing:{at:2}});
 const before=adapter.calls.length;for(const options of [{offset:6},{length:7},{offset:-1},{rate:16},{loop:1}])await assert.rejects(player.play(options),/range/);assert.equal(adapter.calls.length,before);
 const state=await player.getState();assert.equal(state.volume,.4);assert.equal(state.pan,-1);assert.equal(state.mute,true);
 await player.reset();await player.play();assert.equal(adapter.calls.at(-1).length,6,'reset retains the source');player.dispose();
});
test('PCM encoding preserves the requested rate and real source length, with no phantom padding note',async()=>{
 const adapter=fixture(),player=createMsm5205Player(adapter),source={sampleRate:8000,channels:[Float32Array.from([0,.1,.2,.1,0])]};
 const info=await player.loadSample(source,{rate:12});assert.equal(info.rate,12);assert.equal(info.frames,5);assert.equal(info.bytes,3);assert.equal(info.paddedFrames,6);
 await player.play();assert.equal(adapter.calls.at(-1).length,5);assert.equal(adapter.calls.at(-1).rate,12);await player.stop();await player.play();assert.equal(adapter.calls.at(-1).length,5);player.dispose();
});
test('Stop cancels a pending preparation, rejects stale Play, and allows a new source',async()=>{
 const adapter=fixture(),player=createMsm5205Player(adapter),gate=adapter.hold();
 const load=player.loadMemory(new Uint8Array(8)),rejected=assert.rejects(load,{name:'AbortError'});await new Promise(setImmediate);
 await player.stop();gate.resolve();await rejected;await assert.rejects(player.play(),/Load an/);
 await player.loadMemory(new Uint8Array(4));await player.play();assert.equal(adapter.calls.at(-1).length,8);player.dispose();await assert.rejects(player.getState(),{name:'AbortError'});
});
test('caller cancellation also covers a prepared-sample upload, and a later load recovers',async()=>{
 const adapter=fixture(),player=createMsm5205Player(adapter),gate=adapter.hold(),controller=new AbortController();
 const load=player.loadSample({sampleRate:8000,channels:[new Float32Array(16)]},{signal:controller.signal}),rejected=assert.rejects(load,{name:'AbortError'});await new Promise(setImmediate);controller.abort();gate.resolve();await rejected;
 await player.loadMemory(new Uint8Array(4));await player.writeRegister(5,0);assert.equal(adapter.calls.at(-1).register,5);await assert.rejects(player.writeRegister(8,0),/register/);player.dispose();
});

test('a rejected replacement keeps the previously accepted RAM metadata and remains playable',async()=>{
 const adapter=fixture(),player=createMsm5205Player(adapter);await player.loadMemory(new Uint8Array(4));
 adapter.prepare=async()=>{throw new Error('RAM replacement rejected');};await assert.rejects(player.loadMemory(new Uint8Array(16)),/replacement rejected/);
 await player.play();assert.equal(adapter.calls.at(-1).length,8);player.dispose();
});
