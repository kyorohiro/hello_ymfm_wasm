import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnesSongPlayer} from './song_player.js';
import {createSyntheticSpc} from '../../tetorica_src/runtime/spc_test_fixture.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function fixture(t,{holdEndpoint=false,holdSeek=false,holdEdit=false}={}){
  const events=[],updates=[],timers=new Map();let timer=0,routeCount=0,playing=false,position=0,mask=0,client,endpoint,snapshotGate=null,snapshotError=null;
  const engine={context:{state:'running'},songInputNode:{name:'shared pre-Master'}},endpointGate=deferred(),seekGate=deferred(),editGate=deferred();
  const player=createSnesSongPlayer({ensureAudio:async()=>{events.push('ensureAudio');return engine;},getAudio:()=>engine,
    schedule:fn=>{timers.set(++timer,fn);return timer;},cancel:id=>timers.delete(id),onChange:value=>updates.push(value),
    async createEndpoint(context,destination){assert.equal(context,engine.context);assert.equal(destination,engine.songInputNode);routeCount++;events.push('createEndpoint');if(holdEndpoint)await endpointGate.promise;return endpoint={port:{},node:Object.assign(new EventTarget(),{port:new EventTarget()}),dispose(){events.push('disposeEndpoint');}};},
    createClient(){const state=()=>({playing,positionSeconds:position,muteMask:mask});return client={
      async loadSPC(bytes){events.push('load');assert(bytes instanceof Uint8Array);position=0;playing=false;return state();},
      async play(){events.push('play');playing=true;return state();},async pause(){events.push('pause');playing=false;return state();},
      async stop(){events.push('stop');playing=false;position=0;return state();},async seek(seconds){events.push('seek');const resume=playing;playing=false;if(holdSeek)await seekGate.promise;position=seconds;playing=resume;return state();},
      async snapshot(){events.push('snapshot');if(snapshotError)throw snapshotError;if(snapshotGate)await snapshotGate.promise;const bytes=createSyntheticSpc();return {ram:bytes.slice(0x100,0x10100),dsp:bytes.slice(0x10100,0x10180),positionSeconds:position};},
      async editVoice(channel,changes){events.push('editVoice');if(holdEdit)await editGate.promise;const bytes=createSyntheticSpc();bytes[0x10100+channel*16]=changes.volumeLeft&255;return {ram:bytes.slice(0x100,0x10100),dsp:bytes.slice(0x10100,0x10180),positionSeconds:position,playing};},
      async setMuteMask(value){mask=value;events.push('mute');return state();},async getState(){if(playing)position+=.2;return state();},dispose(){playing=false;events.push('disposeClient');},
    };},
  });t.after(()=>player.dispose());
  return{player,events,updates,timers,engine,endpointGate,seekGate,editGate,get routeCount(){return routeCount;},get client(){return client;},get endpoint(){return endpoint;},failSnapshot(error){snapshotError=error;},holdSnapshot(){snapshotGate=deferred();return snapshotGate;},tick:async()=>{const fn=[...timers.values()][0];timers.clear();fn?.();await new Promise(r=>setImmediate(r));}};
}
test('SPC selection validates and detaches bytes without creating audio; invalid/cancelled inputs preserve the source',async t=>{
  const f=fixture(t),bytes=createSyntheticSpc();assert(f.player.loadSource(bytes,{name:'first.spc'}));bytes[0]=0;assert.deepEqual(f.events,[]);
  assert.throws(()=>f.player.loadSource(bytes,{name:'bad.spc'}));assert.equal(f.player.read().source.name,'first.spc');
  assert.equal(f.player.loadSource(createSyntheticSpc(),{name:'late.spc',isCurrent:()=>false}),false);assert.equal(f.player.read().source.name,'first.spc');
  await f.player.play();assert.equal(f.player.read().mode,'playing');
});
test('Play/Pause/resume/Stop/seek reuse one shared route and only playing schedules UI reads',async t=>{
  const f=fixture(t);f.player.loadSource(createSyntheticSpc());await f.player.play();await f.tick();assert(f.player.read().positionSeconds>0);
  await f.player.pause();assert.equal(f.timers.size,0);const at=f.player.read().positionSeconds;await f.player.play();assert.equal(f.player.read().positionSeconds,at);
  await f.player.seek(12);assert.equal(f.player.read().positionSeconds,12);assert.equal(f.player.read().mode,'playing');
  await f.player.stop();assert.equal(f.player.read().positionSeconds,0);assert.equal(f.player.read().mode,'stopped');assert.equal(f.routeCount,1);
});
test('Stop while lazy setup is pending never sends Play and disposes the late endpoint',async t=>{
  const f=fixture(t,{holdEndpoint:true});f.player.loadSource(createSyntheticSpc());const pending=f.player.play();await new Promise(r=>setImmediate(r));
  await f.player.stop();f.endpointGate.resolve();assert.equal(await pending,false);assert(!f.events.includes('play'));assert(f.events.includes('disposeEndpoint'));assert.equal(f.player.read().mode,'stopped');
});
test('Stop supersedes a pending seek result and cannot resume an old operation',async t=>{
  const f=fixture(t,{holdSeek:true});f.player.loadSource(createSyntheticSpc());await f.player.play();const seeking=f.player.seek(20);await new Promise(r=>setImmediate(r));
  await f.player.stop();f.seekGate.resolve();assert.equal(await seeking,false);assert.equal(f.player.read().positionSeconds,0);assert.equal(f.player.read().mode,'stopped');
});
test('loading a valid replacement retires playback, while malformed replacement leaves it running',async t=>{
  const f=fixture(t);f.player.loadSource(createSyntheticSpc(),{name:'one.spc'});await f.player.play();
  assert.throws(()=>f.player.loadSource(new Uint8Array(10)));assert.equal(f.player.read().mode,'playing');
  f.player.loadSource(createSyntheticSpc(),{name:'two.spc'});assert.equal(f.player.read().mode,'stopped');assert(f.events.includes('disposeClient'));assert(f.events.includes('disposeEndpoint'));
  await f.player.play();assert.equal(f.routeCount,2);
});
test('channel masks stay passive before Play and recover after an audio context closes',async t=>{
  const f=fixture(t);f.player.loadSource(createSyntheticSpc());await f.player.setMuteMask(0x55);assert.equal(f.events.length,0);assert.throws(()=>f.player.seek(3601),/3600/);
  await f.player.play();assert.equal(f.player.read().muteMask,0x55);f.player.audioClosed();assert.equal(f.player.read().mode,'stopped');await f.player.play();assert.equal(f.routeCount,2);
  f.player.dispose();assert.equal(f.timers.size,0);
});

test('a failed SPC processor retires only its route and old failure callbacks cannot stop a retry',async t=>{
  const f=fixture(t);f.player.loadSource(createSyntheticSpc(),{name:'kept.spc'});await f.player.play();const old=f.endpoint.node;
  old.dispatchEvent(new Event('processorerror'));assert.equal(f.player.read().mode,'stopped');assert.match(f.player.read().error,/retry/);assert.equal(f.timers.size,0);
  await f.player.play();assert.equal(f.player.read().mode,'playing');assert.equal(f.routeCount,2);old.dispatchEvent(new Event('processorerror'));assert.equal(f.player.read().mode,'playing');assert.equal(f.player.read().source.name,'kept.spc');
});

test('inspection follows playback, freezes on Pause and resets on Stop without exposing mutable RAM',async t=>{
 const f=fixture(t);f.player.loadSource(createSyntheticSpc());assert.equal(f.player.read().inspection,null);await f.player.play();assert.equal(f.player.read().inspection.voices.length,8);await f.tick();assert.equal(f.player.read().inspection.positionSeconds,.2);const copy=f.player.read();copy.inspection.voices[0].pitch=1;assert.equal(f.player.read().inspection.voices[0].pitch,4096);await f.player.pause();const count=f.events.filter(e=>e==='snapshot').length;await f.tick();assert.equal(f.events.filter(e=>e==='snapshot').length,count);await f.player.seek(3);assert.equal(f.player.read().inspection.positionSeconds,3);await f.player.stop();assert.equal(f.player.read().inspection.positionSeconds,0);
});
test('fresh capture is fenced against transport changes and source replacement',async t=>{
 const f=fixture(t);f.player.loadSource(createSyntheticSpc());await f.player.play();const captured=await f.player.capture();assert(captured.isCurrent());assert.equal(captured.snapshot.ram.length,65536);await f.player.pause();assert.equal(captured.isCurrent(),false);
 await f.player.play();const gate=f.holdSnapshot(),pending=f.player.capture();await new Promise(r=>setImmediate(r));f.player.loadSource(createSyntheticSpc(),{name:'replacement.spc'});gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.player.read().inspection,null);assert.equal(f.player.read().source.name,'replacement.spc');
});
test('late inspection responses cannot resurrect an old polling loop',async t=>{
 const f=fixture(t);f.player.loadSource(createSyntheticSpc());await f.player.play();const gate=f.holdSnapshot(),poll=f.tick();await new Promise(r=>setImmediate(r));f.player.audioClosed();gate.resolve();await poll;assert.equal(f.player.read().inspection,null);assert.equal(f.timers.size,0);assert.equal(f.player.read().mode,'stopped');
});

test('an inspection failure reports stale display data without stopping healthy playback and can recover',async t=>{
 const f=fixture(t);f.player.loadSource(createSyntheticSpc());await f.player.play();const stamp=f.player.read().inspection.positionSeconds;f.failSnapshot(new Error('Analysis temporarily unavailable'));await f.tick();assert.equal(f.player.read().playing,true);assert.equal(f.player.read().inspection.positionSeconds,stamp);assert.match(f.player.read().inspectionError,/temporarily/);f.failSnapshot(null);await f.tick();assert.equal(f.player.read().inspectionError,'');assert(f.player.read().inspection.positionSeconds>stamp);
});

test('channel edits prepare a paused machine silently and never mutate the original source',async t=>{
 const f=fixture(t);f.player.loadSource(createSyntheticSpc());await f.player.editVoice(0,{volumeLeft:-24});assert.equal(f.player.read().mode,'paused');assert(!f.events.includes('play'));assert.equal(f.player.read().inspection.voices[0].volumeLeft,-24);assert.equal(f.player.analysis().snapshot.dsp[0],232);await f.player.stop();assert.equal(f.player.analysis().snapshot.dsp[0],64);
});
test('Stop and channel-owner changes reject delayed edit replies without restoring stale analysis',async t=>{
 const f=fixture(t,{holdEdit:true});f.player.loadSource(createSyntheticSpc());await f.player.play();let current=true;const editing=f.player.editVoice(0,{volumeLeft:0},{isCurrent:()=>current});await new Promise(r=>setImmediate(r));await f.player.stop();current=false;f.editGate.resolve();await assert.rejects(editing,{name:'AbortError'});assert.equal(f.player.read().mode,'stopped');assert.equal(f.player.read().inspection.voices[0].volumeLeft,64);
});

test('pending seek publishes its target; Stop, source replacement and output close clear it',async t=>{
 const f=fixture(t,{holdSeek:true});f.player.loadSource(createSyntheticSpc());await f.player.play();const pending=f.player.seek(20);await new Promise(r=>setImmediate(r));assert.equal(f.player.read().seekTargetSeconds,20);assert.equal(f.player.read().mode,'seeking');await f.player.stop();assert.equal(f.player.read().seekTargetSeconds,null);f.seekGate.resolve();assert.equal(await pending,false);assert.equal(f.player.read().seekTargetSeconds,null);
 await f.player.seek(3);assert.equal(f.player.read().seekTargetSeconds,null);f.player.audioClosed();assert.equal(f.player.read().seekTargetSeconds,null);f.player.loadSource(createSyntheticSpc(),{name:'replacement.spc'});assert.equal(f.player.read().seekTargetSeconds,null);
});

test('a replacement seek during cold audio preparation uses one route and only the newest target',async t=>{
 const f=fixture(t,{holdEndpoint:true});f.player.loadSource(createSyntheticSpc());const first=f.player.seek(20);await new Promise(r=>setImmediate(r));const second=f.player.seek(3);assert.equal(f.player.read().seekTargetSeconds,3);f.endpointGate.resolve();assert.equal(await first,false);assert.equal(await second,true);assert.equal(f.routeCount,1);assert.equal(f.events.filter(e=>e==='seek').length,1);assert.equal(f.player.read().positionSeconds,3);assert.equal(f.player.read().playing,false);assert.equal(f.player.read().seekTargetSeconds,null);
});
