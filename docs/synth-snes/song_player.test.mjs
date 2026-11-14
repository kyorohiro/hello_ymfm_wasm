import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnesSongPlayer} from './song_player.js';
import {createSyntheticSpc} from '../../tetorica_src/runtime/spc_test_fixture.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function fixture(t,{holdEndpoint=false,holdSeek=false}={}){
  const events=[],updates=[],timers=new Map();let timer=0,routeCount=0,playing=false,position=0,mask=0,client,endpoint;
  const engine={context:{state:'running'},songInputNode:{name:'shared pre-Master'}},endpointGate=deferred(),seekGate=deferred();
  const player=createSnesSongPlayer({ensureAudio:async()=>{events.push('ensureAudio');return engine;},getAudio:()=>engine,
    schedule:fn=>{timers.set(++timer,fn);return timer;},cancel:id=>timers.delete(id),onChange:value=>updates.push(value),
    async createEndpoint(context,destination){assert.equal(context,engine.context);assert.equal(destination,engine.songInputNode);routeCount++;events.push('createEndpoint');if(holdEndpoint)await endpointGate.promise;return endpoint={port:{},node:Object.assign(new EventTarget(),{port:new EventTarget()}),dispose(){events.push('disposeEndpoint');}};},
    createClient(){const state=()=>({playing,positionSeconds:position,muteMask:mask});return client={
      async loadSPC(bytes){events.push('load');assert(bytes instanceof Uint8Array);position=0;playing=false;return state();},
      async play(){events.push('play');playing=true;return state();},async pause(){events.push('pause');playing=false;return state();},
      async stop(){events.push('stop');playing=false;position=0;return state();},async seek(seconds){events.push('seek');const resume=playing;playing=false;if(holdSeek)await seekGate.promise;position=seconds;playing=resume;return state();},
      async setMuteMask(value){mask=value;events.push('mute');return state();},async getState(){if(playing)position+=.2;return state();},dispose(){playing=false;events.push('disposeClient');},
    };},
  });t.after(()=>player.dispose());
  return{player,events,updates,timers,engine,endpointGate,seekGate,get routeCount(){return routeCount;},get client(){return client;},get endpoint(){return endpoint;},tick:async()=>{const fn=[...timers.values()][0];timers.clear();fn?.();await new Promise(r=>setImmediate(r));}};
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
