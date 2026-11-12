// Read-only integration harness: execute the actual application function,
// without a DOM, AudioContext, copied implementation or audible output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDefaultPreset,readPreset} from './preset.js';
const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const start=source.indexOf('async function applyPreset('),end=source.indexOf('\nconst editor =',start);
assert(start>=0&&end>start,'Locate the real application preset function');
const implementation=source.slice(start,end);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function preset(name,source='pulse'){return {...createDefaultPreset(),name,source};}
function fixture({audio=true,blockedQueue=null,apply=async()=>{},read=async()=>{}}={}){
  let running=true,owner={current:true},backend=readPreset(createDefaultPreset()),queue=Promise.resolve();
  const calls=[],publishes=[];
  const engine={
    getGameboyClient(){const pinned=owner;return Promise.resolve({isCurrent:()=>pinned.current});},
    async applyCodePreset(value,options){calls.push({method:'apply',value:readPreset(value),isCurrent:options.isCurrent});await apply(value,options,()=>{backend=readPreset(value);});return true;},
    async read(){calls.push({method:'read'});await read();return {preset:readPreset(backend),voices:[]};},
    async command(method,args){calls.push({method,args});if(['setPreset','loadPreset'].includes(method))backend=readPreset(args[0]);return true;},
  };
  const realm={readPreset,applySequence:0,disposed:false,lastSongState:null,isSongChannelView:()=>false,isSongActive:()=>false,audition:null,
    stopAudition:async()=>{},songControls:null,codeHost:{isRunning:()=>running,markSoundDirty(){publishes.push(readPreset(realm.preset));}},audio:audio?engine:null,
    preset:createDefaultPreset(),epoch:0,notes:new Map(),revision:0,updateKeys(){},codeLive:null,setPitchUi(){},updatePresetUi(){},status(){},
    enqueue(action){const task=queue.then(async()=>{if(blockedQueue)await blockedQueue;return action();});queue=task.catch(()=>{});return task;},
    readVoices(){},visualizer:{wake(){}},
  };
  vm.createContext(realm);vm.runInContext(implementation+'\nthis.apply=applyPreset;',realm);
  return {realm,engine,calls,publishes,get backend(){return readPreset(backend);},
    stop(){running=false;owner.current=false;},restart(){owner.current=false;owner={current:true};running=true;},
    replaceEngine(value){realm.audio=value;},commit(value){backend=readPreset(value);}};
}

test('preset selected during initial Code preparation publishes a draft without dereferencing an absent audio engine',async()=>{
  const f=fixture({audio:false});const next=preset('Preparing Wave','wave');assert.equal(await f.realm.apply(next,{load:true}),true);
  assert.deepEqual(f.realm.preset,next);assert.equal(f.calls.length,0);assert.equal(f.publishes.length,1);
});

test('Stop before a queued live preset dispatch keeps the previous editor and native checkpoint aligned',async()=>{
  const gate=deferred(),f=fixture({blockedQueue:gate.promise});const pending=f.realm.apply(preset('Never dispatched'),{load:true});
  assert.equal(f.realm.preset.name,'Pulse');f.stop();gate.resolve();assert.equal(await pending,false);
  assert.equal(f.realm.preset.name,'Pulse');assert.equal(f.backend.name,'Pulse');assert(!f.calls.some(call=>call.method==='apply'));
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
