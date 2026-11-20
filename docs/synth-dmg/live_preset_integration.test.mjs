// Read-only integration harness: execute the actual application function,
// without a DOM, AudioContext, copied implementation or audible output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDefaultPreset,readPreset} from './preset.js';
import {createGameboyChannelBank,readGameboyChannelBank,updateGameboyChannelBank,applyGameboyChannelEdit} from './channel_bank.js';
import {applyGameboyCodeEdit} from './code_parameter_edit.js';
import {applyGameboyDocumentChanges} from './instrument_document_edit.js';
const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const start=source.indexOf('async function applyPreset('),end=source.indexOf('\nconst editor =',start);
assert(start>=0&&end>start,'Locate the real application preset function');
const implementation=source.slice(start,end);
const prepareAudio=source.slice(source.indexOf('async function ensureAudio('),start);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function preset(name,source='pulse'){return {...createDefaultPreset(),name,source};}
function fixture({audio=true,autoApply=true,blockedQueue=null,apply=async(_value,_options,commit)=>commit(),read=async()=>{},vgm=null}={}){
  let running=!vgm,owner={current:true},backend=createDefaultPreset(),bank=createGameboyChannelBank(backend),queue=Promise.resolve();
  const calls=[],publishes=[],songCalls=[],elements=new Map();
  const commit=value=>{bank=updateGameboyChannelBank(bank,backend,value);backend=readPreset(value);};
  const engine={context:{},outputNode:{},setVolume(){},resume:async()=>{},dispose:async()=>{},
    getGameboyClient(){const pinned=owner;return Promise.resolve({isCurrent:()=>pinned.current});},
    async applyCodePreset(value,options){calls.push({method:'apply',value:readPreset(value),replace:options.replace,isCurrent:options.isCurrent});
      await apply(value,options,()=>{bank=updateGameboyChannelBank(bank,backend,value,{replace:options.replace});backend=readPreset(value);});return true;},
    async read(){calls.push({method:'read'});await read();return {preset:readPreset(backend),channelPresets:readGameboyChannelBank(bank),voices:[]};},
    async command(method,args){calls.push({method,args});
      if(['setPreset','loadPreset'].includes(method)){bank=updateGameboyChannelBank(bank,backend,args[0],{replace:method==='loadPreset'});backend=readPreset(args[0]);}
      if(method==='loadChannelBank')bank=readGameboyChannelBank(args[0]);return true;},
  };
  const realm={readPreset,readGameboyChannelBank,updateGameboyChannelBank,applyGameboyDocumentChanges,
    channelBank:createGameboyChannelBank(createDefaultPreset()),channelTarget:'synth',applySequence:0,disposed:false,lastSongState:vgm,
    isSongChannelView:()=>false,isSongActive:()=>Boolean(vgm),audition:null,stopAudition:async()=>{},
    songControls:vgm?{stop(){songCalls.push({method:'stop'});},setView(){},applyPreset(value,options){songCalls.push({method:'applyPreset',value:readPreset(value),options});}}:null,
    codeHost:{isRunning:()=>running,markSoundDirty(){assert.fail('Document edits must use Files recording');},
      files:{isAutoApply:()=>autoApply,canEditSound(){},recordSoundEdit(value){publishes.push(readPreset(value));}}},audio:audio?engine:null,
    preset:createDefaultPreset(),playbackPreset:createDefaultPreset(),playbackRevision:0,epoch:0,notes:new Map(),revision:0,
    opening:null,pitch:0,liveSignature:null,createAudio:async()=>engine,audioFailed(){},
    $(id){if(!elements.has(id))elements.set(id,{value:'.7',disabled:false,textContent:''});return elements.get(id);},
    updateKeys(){},codeLive:null,setPitchUi(){},updatePresetUi(){},status(){},syncChannelObservers(){},renderChannelView(){},
    enqueue(action){const task=queue.then(async()=>{if(blockedQueue)await blockedQueue;return action();});queue=task.catch(()=>{});return task;},
    readVoices(state){if(state.channelPresets)realm.channelBank=readGameboyChannelBank(state.channelPresets);},visualizer:{wake(){},connect(){}},
  };
  vm.createContext(realm);vm.runInContext(prepareAudio+implementation+'\nthis.apply=applyPreset;',realm);
  return {realm,engine,calls,publishes,songCalls,get backend(){return readPreset(backend);},get bank(){return readGameboyChannelBank(bank);},
    stop(){running=false;owner.current=false;},restart(){owner.current=false;owner={current:true};running=true;},
    replaceEngine(value){realm.audio=value;},commit,
    editChannel(edit){backend=applyGameboyCodeEdit(backend,edit);bank=applyGameboyChannelEdit(bank,edit);realm.channelBank=readGameboyChannelBank(bank);}};
}

test('preset selected during initial Code preparation publishes a draft without dereferencing an absent audio engine',async()=>{
  const f=fixture({audio:false});const next=preset('Preparing Wave','wave');assert.equal(await f.realm.apply(next,{load:true}),true);
  assert.deepEqual(f.realm.preset,next);assert.equal(f.calls.length,0);assert.equal(f.publishes.length,1);
});

test('a full preset and a sparse common edit keep VGM running and target its pinned reference session after the author ACK',async()=>{
  const f=fixture({vgm:{playback:'playing',playing:true,interaction:{runId:77}}}),next=preset('Live Wave','wave');
  assert.equal(await f.realm.apply(next,{load:true}),true);
  assert.equal(f.songCalls.length,1);assert.equal(f.songCalls[0].method,'applyPreset');assert.equal(f.songCalls[0].options.runId,77);assert.equal(f.songCalls[0].options.replace,true);
  assert.deepEqual(f.backend,next);assert.deepEqual(f.realm.preset,next);
  const changed=readPreset(next);changed.wave.level=.25;
  assert.equal(await f.realm.apply(changed),true);assert.equal(f.songCalls[1].options.replace,false);assert.deepEqual(f.songCalls[1].options.previous,next);
  assert(!f.songCalls.some(call=>call.method==='stop'));
});

test('a delayed preset carries its original VGM run identity even if another song replaces it before the author ACK',async()=>{
  const gate=deferred(),f=fixture({blockedQueue:gate.promise,vgm:{playback:'playing',playing:true,interaction:{runId:11}}});
  const pending=f.realm.apply(preset('Delayed'),{load:true});f.realm.lastSongState={playback:'playing',playing:true,interaction:{runId:22}};
  gate.resolve();assert.equal(await pending,true);assert.equal(f.songCalls[0].options.runId,11,'preview rejects this stale run rather than touching 22');
});

test('Stop before a queued live preset dispatch keeps the previous editor and native checkpoint aligned',async()=>{
  const gate=deferred(),f=fixture({blockedQueue:gate.promise});const pending=f.realm.apply(preset('Never dispatched'),{load:true});
  assert.equal(f.realm.preset.name,'Pulse');f.stop();gate.resolve();assert.equal(await pending,false);
  assert.equal(f.realm.preset.name,'Pulse');assert.equal(f.backend.name,'Pulse');assert(!f.calls.some(call=>call.method==='apply'));
});

test('a rejected preset keeps the key-up identity of a keyboard note sharing the Code APU',async()=>{
  const f=fixture({apply:async()=>{throw new RangeError('Not enough memory');}}),note={id:'held-key',started:true};
  f.realm.notes.set('key:KeyZ',note);const epoch=f.realm.epoch;
  await assert.rejects(f.realm.apply(preset('Rejected Wave','wave'),{load:true}),/Not enough memory/);
  assert.equal(f.realm.notes.get('key:KeyZ'),note);assert.equal(f.realm.epoch,epoch);assert.equal(f.realm.preset.name,'Pulse');
});

test('Stop after native preset commit reconciles the latest checkpoint instead of rolling the editor back',async()=>{
  const gate=deferred(),entered=deferred(),f=fixture({apply:async(_value,_options,commit)=>{commit();entered.resolve();await gate.promise;}});
  const next=preset('Committed Wave','wave'),pending=f.realm.apply(next,{load:true});await entered.promise;
  assert.equal(f.realm.preset.name,'Pulse');f.stop();gate.reject(new DOMException('Stopped','AbortError'));assert.equal(await pending,false);
  assert.deepEqual(f.realm.preset,next);assert.deepEqual(f.backend,next);assert(f.calls.some(call=>call.method==='read'));
});

test('a restarted Run or a replacement engine cannot receive a queued preset pinned to the previous Code lease',async()=>{
  for(const replaceEngine of [false,true]){
    const gate=deferred(),f=fixture({blockedQueue:gate.promise}),pending=f.realm.apply(preset('Old owner intent'),{load:true});
    f.restart();if(replaceEngine)f.replaceEngine({read:()=>assert.fail('Old edit must not inspect the new engine'),applyCodePreset:()=>assert.fail('Old edit must not touch the new engine')});
    gate.resolve();assert.equal(await pending,false);assert.equal(f.realm.preset.name,'Pulse');assert.equal(f.backend.name,'Pulse');assert(!f.calls.some(call=>call.method==='apply'));
  }
});

test('an older preset result cannot overwrite a newer selection while its native result is delayed',async()=>{
  const first=deferred(),entered=deferred();let applications=0;
  const f=fixture({apply:async(_value,_options,commit)=>{commit();if(++applications===1){entered.resolve();await first.promise;}}});
  const old=f.realm.apply(preset('Old selected Wave','wave'),{load:true});await entered.promise;
  const latest=preset('Latest Noise','noise'),next=f.realm.apply(latest,{load:true});
  first.resolve();assert.equal(await old,false);assert.equal(await next,true);
  assert.deepEqual(f.realm.preset,latest);assert.deepEqual(f.backend,latest);assert.equal(f.publishes.length,1);assert.equal(f.publishes[0].name,latest.name);
  await tick();
});

test('manual sound edits stay visible through cold audio preparation while accepted sound and session channels reach the engine',async()=>{
  const f=fixture({audio:false,autoApply:false}),accepted=readPreset(f.realm.playbackPreset),draft=preset('Unsaved Wave','wave');
  draft.wave.samples[2]=3;f.realm.channelBank[1].pulse.duty=.75;
  assert.equal(await f.realm.apply(draft),true);assert.deepEqual(f.realm.preset,draft);assert.deepEqual(f.realm.playbackPreset,accepted);
  assert.equal(f.realm.playbackRevision,0);assert.equal(f.calls.length,0);assert.deepEqual(f.publishes,[draft]);
  await f.realm.ensureAudio();
  assert.deepEqual(f.calls.find(call=>call.method==='loadPreset').args[0],accepted);
  assert.equal(f.calls.find(call=>call.method==='loadChannelBank').args[0][1].pulse.duty,.75);
  assert.deepEqual(f.backend,accepted);assert.deepEqual(f.realm.preset,draft);assert.deepEqual(f.realm.playbackPreset,accepted);
});

test('saving one author field merges the latest queued physical channel edits without copying them into JSON',async()=>{
  const gate=deferred(),f=fixture({blockedQueue:gate.promise}),saved=readPreset(f.realm.playbackPreset);saved.wave.level=1;
  const pending=f.realm.apply(saved,{record:false,source:'save',load:false,applyAudio:true});
  f.editChannel({channel:0,changes:{'pulse.volume':5}});f.editChannel({channel:1,changes:{'pulse.duty':.75}});
  f.editChannel({channel:3,changes:{'noise.shift':7}});gate.resolve();assert.equal(await pending,true);
  assert.equal(f.backend.pulse.volume,5);assert.equal(f.backend.pulse.duty,.75);assert.equal(f.backend.noise.shift,7);assert.equal(f.backend.wave.level,1);
  assert.equal(f.bank[0].pulse.volume,5);assert.equal(f.bank[1].pulse.duty,.75);assert.equal(f.bank[3].noise.shift,7);assert.equal(f.bank[2].wave.level,1);
  assert.deepEqual(f.realm.preset,saved);assert.deepEqual(f.realm.playbackPreset,saved);assert.equal(f.publishes.length,0);
  assert.equal(f.calls.find(call=>call.method==='apply').replace,false);
});

test('Stop after accepted JSON commits preserves a newer pending manual drawing and updates only accepted playback',async()=>{
  const gate=deferred(),entered=deferred(),f=fixture({apply:async(_value,_options,commit)=>{commit();entered.resolve();await gate.promise;}});
  const saved=preset('Accepted Wave','wave'),pending=f.realm.apply(saved,{record:false,source:'save',load:false,applyAudio:true});await entered.promise;
  const draft=readPreset(saved);draft.name='Working drawing';draft.wave.samples[5]=1;
  await f.realm.apply(draft,{record:false,source:'json',load:false,applyAudio:false});f.stop();gate.reject(new DOMException('Stopped','AbortError'));
  assert.equal(await pending,false);assert.deepEqual(f.realm.preset,draft);assert.deepEqual(f.realm.playbackPreset,saved);assert.deepEqual(f.backend,saved);assert.equal(f.publishes.length,0);
});

test('an audible direct edit ACK never records over a newer manual JSON or drawing',async()=>{
  const gate=deferred(),entered=deferred(),f=fixture({apply:async(_value,_options,commit)=>{commit();entered.resolve();await gate.promise;}});
  const accepted=preset('Accepted knob edit','wave'),pending=f.realm.apply(accepted);await entered.promise;
  const draft=readPreset(accepted);draft.name='Newer working drawing';draft.wave.samples[5]=1;
  await f.realm.apply(draft,{record:false,source:'json',load:false,applyAudio:false});gate.resolve();assert.equal(await pending,true);
  assert.deepEqual(f.realm.preset,draft);assert.deepEqual(f.realm.playbackPreset,accepted);assert.deepEqual(f.backend,accepted);
  assert.equal(f.publishes.length,0,'The delayed direct edit must not record its older sound over the newer author document');
});
