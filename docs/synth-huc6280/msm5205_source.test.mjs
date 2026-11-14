// SPDX-License-Identifier: BSD-3-Clause
// Real passive encoding/decoding and player/core into inert graph nodes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMsm5205Source} from './msm5205_source.js';
import {prepareMsm5205Asset} from './msm5205_asset.js';
import {createMSM5205PCM} from '../js/msm5205_pcm.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';

const wasmBinary=await readFile(new URL('../generated/msm5205_wasm.wasm',import.meta.url));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const peak=values=>values.reduce((n,x)=>Math.max(n,Math.abs(x)),0);
const pcm=(frames=801)=>({sampleRate:8000,channels:[Float32Array.from({length:frames},(_,i)=>.3*Math.sin(i*2*Math.PI*220/8000))]});
const node=context=>({context,edges:new Set(),connect(input){this.edges.add(input);},disconnect(){this.edges.clear();}});
function fixture(options={}){
  let engine,ensures=0;const engines=[],adapters=[],events=[],errors=[],states=[];
  function makeEngine(){const context={state:'running',sampleRate:48000,currentTime:0},input=node(context);
    const value={context,input,getChipInputNode:name=>{assert.equal(name,'msm5205');return input;},
      getChipMix:()=>({volume:.75,pan:0,muted:false,effectiveMuted:false})};engines.push(value);return value;}
  engine=makeEngine();
  const source=createMsm5205Source({ensureAudio:async()=>{ensures++;await options.ensureAudio?.();},getAudio:()=>engine,
    prepareAsset:(value,settings)=>prepareMsm5205Asset(value,{...settings,wasmBinary}),
    readFile:options.readFile??(async()=>new Uint8Array([0x77,0x11,0xff,0x22])),
    onState:state=>states.push(state),onError:error=>errors.push(error),
    createAudio:async(context,{signal})=>{
      const core=await createMSM5205PCM({sampleRate:context.sampleRate,wasmBinary});
      const adapter={index:adapters.length,node:node(context),core,prepares:0,disposals:0,dead:false,
        async prepare(bytes){this.prepares++;const copy=bytes.slice();events.push(['prepare',this.index]);await options.beforePrepare?.(this);
          if(this.dead||signal.aborted)throw new DOMException('Adapter retired','AbortError');core.prepare(copy);},
        async command(action,timing={}){if(this.dead)throw Error('MSM5205 endpoint closed');events.push([action.type,this.index]);await options.beforeCommand?.(this,action,timing);
          if(options.scheduleFuture&&timing.at>context.currentTime)return{...core.readState(),scheduled:true};
          if(action.type==='state')return core.readState();if(action.type==='play')core.play(action);
          else if(action.type==='write-register')core.writeRegister(action.register,action.value);else core[action.type]();return core.readState();},
        dispose(){if(this.dead)return;this.dead=true;this.disposals++;this.node.disconnect();core.dispose();events.push(['dispose',this.index]);},
        render(frames=512){const left=new Float32Array(frames),right=new Float32Array(frames);core.render(left,right);return left;}};
      adapters.push(adapter);signal.addEventListener('abort',()=>adapter.dispose(),{once:true});return adapter;
    }});
  return{source,adapters,events,errors,states,engines,get ensures(){return ensures;},get engine(){return engine;},replaceEngine(){engine=makeEngine();return engine;}};
}

test('UI sample loading and state observation stay passive, detach bytes and preserve the previous asset on invalid input',async()=>{
  const f=fixture();try{
    const updates=[],off=f.source.subscribe(state=>updates.push(state));
    assert.equal(f.source.read().state,'empty');assert.equal((await f.source.getState()).state,'empty');
    const input=new Uint8Array([0x77,0x11,0xff,0x22]);await f.source.loadMemory(input,{name:'Lead',path:'/lead.adpcm',rate:9});input.fill(0);
    const previous=f.source.read();assert.equal(previous.asset.name,'Lead');assert.equal(previous.asset.path,'/lead.adpcm');assert.equal(previous.asset.info.bytes,4);
    assert(previous.asset.wave.peak>.01);assert.equal(previous.defaults.rate,9);assert.equal(previous.revision,1);assert.equal(f.ensures,0);assert.equal(f.adapters.length,0);
    await assert.rejects(f.source.loadMemory(new Uint8Array(65537)),/65536/);
    assert.equal(f.source.read().revision,1);assert.equal(f.source.read().asset.info,previous.asset.info);assert(f.source.read().error);
    await f.source.loadSample(pcm(),{name:'Wave',rate:12});assert.equal(f.source.read().asset.info.frames,801);assert.equal(f.source.read().asset.info.paddedFrames,802);
    assert.equal(f.ensures,0);assert.equal((await f.source.getState()).sourceId,previous.sourceId);
    assert(updates.some(state=>state.busy));off();
  }finally{await f.source.dispose();}
});

test('UI and Code share one RAM and source identity; rate and loop are next-Play defaults while explicit Code parameters win',async()=>{
  const f=fixture();try{
    await f.source.loadSample(pcm(),{rate:12});f.source.setDefaults({loop:true});
    const played=await f.source.play();assert.equal(played.rate,12);assert.equal(played.loop,true);assert.equal(played.length,801,'the final encoder padding nibble is not played by default');
    assert(peak(f.adapters[0].render())>.01);assert.deepEqual([...f.adapters[0].node.edges],[f.engine.input]);
    const client=await f.source.useCodeClient();assert.equal((await client.getState()).sourceId,f.source.read().sourceId);assert.equal(f.adapters.length,1);
    f.source.setDefaults({rate:6,loop:false});assert.equal((await client.getState()).rate,12);assert.equal(f.source.read().defaults.rate,6);
    await client.play({rate:15,loop:true,length:200});const explicit=await f.source.getState();assert.equal(explicit.rate,15);assert.equal(explicit.loop,true);assert.equal(explicit.length,200);
    await f.source.play();const defaults=await client.getState();assert.equal(defaults.rate,6);assert.equal(defaults.loop,false);assert.equal(defaults.length,801);
    assert.equal(defaults.volume,.75);assert.equal(f.ensures,1);assert.equal(f.adapters.length,1);
  }finally{await f.source.dispose();}
});

test('Code Stop invalidates only old leases and stops MSM without destroying authored RAM or the Synth clock',async()=>{
  const f=fixture();try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]));const old=await f.source.useCodeClient();await old.play({loop:true});
    const before=f.source.read();await f.source.stopCode();
    assert.equal(f.source.read().asset.info,before.asset.info);assert.equal(f.source.read().revision,before.revision);assert.equal(f.adapters[0].disposals,0);
    await assert.rejects(old.play(),{name:'AbortError'});await assert.rejects(old.loadMemory(new Uint8Array([1])),{name:'AbortError'});
    await f.source.play();const fresh=await f.source.useCodeClient();assert.notEqual(fresh.id,old.id);assert.equal(fresh.sourceId,old.sourceId);assert.equal((await fresh.getState()).state,'playing');
    assert.equal(f.adapters.length,1);assert.equal(f.engine.context.state,'running');
    await f.source.reset();assert(f.source.read().asset);await fresh.play();assert.equal((await fresh.getState()).state,'playing');
  }finally{await f.source.dispose();}
});

test('disposing a borrowed client permits a fresh lease over retained RAM and cannot later stop that new lease',async()=>{
  const f=fixture();try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Authored'});let releases=0;
    const old=await f.source.useCodeClient({onDispose:()=>releases++});await old.play({loop:true});await old.dispose();assert.equal(releases,1);
    const fresh=await f.source.useCodeClient();assert.notEqual(fresh.id,old.id);assert.equal(fresh.sourceId,old.sourceId);assert.equal((await fresh.getState()).sample.name,'Authored');
    await fresh.play({loop:true});await assert.rejects(old.dispose(),{name:'AbortError'});assert.equal((await fresh.getState()).state,'playing');assert.equal(f.adapters.length,1);
  }finally{await f.source.dispose();}
});

test('real guarded Code keeps its live loop while UI edits and transport operate on the same sample',async()=>{
  const f=fixture(),runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,
    supportedSoundChips:['msm5205'],guardExecution:true,createTaskChannel:()=>null,
    useSoundChip:()=>f.source.useCodeClient(),stopSoundChips:()=>f.source.stopCode()});
  try{
    await f.source.loadSample(pcm(),{name:'First'});
    await runtime.run(`const m=await useSoundChip('msm5205');context.m=m;await m.play({loop:true});
context.ticks=0;liveLoop('melody',async()=>{context.ticks++;await sleep(.005);});`);
    const context=runtime.getContext(),id=(await context.m.getState()).sourceId;
    await f.source.loadSample(pcm(400),{name:'Second'});assert(runtime.getState().running);assert.equal((await context.m.getState()).sample.name,'Second');
    f.source.setDefaults({rate:10,loop:true});await f.source.play();await f.source.stop();
    assert(runtime.getState().running);await context.m.play();assert.equal((await context.m.getState()).sourceId,id);
    await new Promise(resolve=>setTimeout(resolve,25));assert(context.ticks>=2);
    await runtime.apply(`const m=await useSoundChip('msm5205');context.sameSource=(await m.getState()).sourceId===context.m.sourceId;`);
    assert.equal(context.sameSource,true);const old=context.m;await runtime.stop();
    await assert.rejects(async()=>old.play(),{name:'AbortError'});assert.equal(f.source.read().asset.name,'Second');
    await f.source.play();assert.equal((await f.source.getState()).state,'playing');
  }finally{await runtime.stop();await f.source.dispose();}
});

test('cancelled UI loads and delayed old-Code Files reads cannot replace a newer authored sample',async()=>{
  const readGate=deferred(),f=fixture({readFile:()=>readGate.promise});try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Previous'});
    const loading=f.source.loadMemory('/late.adpcm'),rejected=assert.rejects(loading,{name:'AbortError'});
    assert(f.source.read().busy);f.source.cancelLoad();assert(!f.source.read().busy);readGate.resolve(new Uint8Array([0x11]));await rejected;
    assert.equal(f.source.read().asset.name,'Previous');assert.equal(f.ensures,0);
    const late=deferred(),old=await f.source.useCodeClient({readFile:()=>late.promise});
    const oldLoading=old.loadMemory('/old.adpcm'),oldRejected=assert.rejects(oldLoading,{name:'AbortError'});await f.source.stopCode();
    await f.source.loadMemory(new Uint8Array([0x33,0x44]),{name:'New'});await f.source.play({loop:true});
    const revision=f.source.read().revision;late.resolve(new Uint8Array([0xee]));await oldRejected;
    assert.equal(f.source.read().asset.name,'New');assert.equal(f.source.read().revision,revision);assert.equal((await f.source.getState()).state,'playing');
  }finally{await f.source.dispose();}
});

test('a cancelled transferred upload is disconnected before a new UI Play can reuse the retained asset',async()=>{
  const gate=deferred();let block=false;
  const f=fixture({beforePrepare:adapter=>block&&adapter.index===0?gate.promise:undefined});try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Previous'});await f.source.play({loop:true});
    const old=await f.source.useCodeClient();block=true;
    const replacing=old.loadMemory(new Uint8Array([0x11,0x22])),rejected=assert.rejects(replacing,{name:'AbortError'});
    while(f.adapters[0].prepares<2)await turn();await f.source.stopCode();
    assert.equal(f.adapters[0].disposals,1);assert.equal(f.adapters[0].node.edges.size,0);
    await f.source.play({loop:true});assert.equal(f.adapters.length,2);assert.equal(f.source.read().asset.name,'Previous');assert(peak(f.adapters[1].render())>.01);
    gate.resolve();await rejected;assert.equal((await f.source.getState()).state,'playing');assert.equal(f.adapters[1].disposals,0);
  }finally{gate.resolve();await f.source.dispose();}
});

test('Stop while audio acquisition is pending fences the old Play before any endpoint can connect',async()=>{
  const gate=deferred(),f=fixture({ensureAudio:()=>gate.promise});try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]));const old=await f.source.useCodeClient();
    const playing=old.play(),rejected=assert.rejects(playing,{name:'AbortError'});await turn();await f.source.stopCode();
    const next=f.source.play({loop:true});gate.resolve();await rejected;await next;
    assert.equal(f.adapters.length,1);assert.equal((await f.source.getState()).state,'playing');
  }finally{gate.resolve();await f.source.dispose();}
});

test('changing the Synth engine reuses authored bytes on the new clock and disposes only the old endpoint',async()=>{
  const f=fixture();try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Shared'});await f.source.play({loop:true});const old=f.engine;
    f.replaceEngine();assert.equal((await f.source.getState()).state,'ready');assert.equal(f.adapters[0].disposals,1);
    await f.source.play({loop:true});assert.equal(f.adapters.length,2);assert.equal(f.adapters[1].node.context,f.engine.context);assert.equal(f.adapters[0].node.edges.size,0);
    assert.equal(old.context.state,'running');assert.equal(f.source.read().asset.name,'Shared');assert.equal(f.source.read().revision,1);
  }finally{await f.source.dispose();}
});

test('workspace clear cancels in-flight work, revokes Code clients and removes only the authored source',async()=>{
  const gate=deferred(),f=fixture({readFile:()=>gate.promise});try{
    await f.source.loadMemory(new Uint8Array([0x77]));const old=await f.source.useCodeClient();await old.play();
    const load=f.source.loadMemory('/late'),rejected=assert.rejects(load,{name:'AbortError'});
    await f.source.clear();assert.equal(f.source.read().asset,null);assert.equal(f.source.read().state,'empty');assert(!f.source.read().busy);
    gate.resolve(new Uint8Array([0xff]));await rejected;await assert.rejects(old.getState(),{name:'AbortError'});
    await assert.rejects(f.source.play(),/Load an MSM5205/);assert.equal(f.engine.context.state,'running');
  }finally{gate.resolve();await f.source.dispose();}
});

test('a pending explicit UI load survives Code Stop, while invalid settings never create audio',async()=>{
  const gate=deferred(),f=fixture({readFile:()=>gate.promise});try{
    const loading=f.source.loadMemory('/ui',{name:'UI'});await f.source.stopCode();assert(f.source.read().busy);
    gate.resolve(new Uint8Array([0x77]));await loading;assert.equal(f.source.read().asset.name,'UI');
    await assert.rejects(f.source.play({rate:16}),/range\/rate/);await assert.rejects(f.source.writeRegister(8,0),/register/);
    assert.throws(()=>f.source.setDefaults({rate:16}),/0\.\.15/);assert.equal(f.ensures,0);
  }finally{gate.resolve();await f.source.dispose();}
});

test('a later UI rate edit wins over a load that was already preparing, without changing the live hardware rate',async()=>{
  const gate=deferred(),f=fixture({readFile:()=>gate.promise});try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]),{rate:12});await f.source.play({loop:true});
    const loading=f.source.loadMemory('/next',{rate:4});f.source.setDefaults({rate:9,loop:true});
    assert.equal((await f.source.getState()).rate,12);gate.resolve(new Uint8Array([0x11,0x22]));await loading;
    assert.equal(f.source.read().asset.info.rate,4,'the encoding/import rate remains metadata');assert.equal(f.source.read().defaults.rate,9,'the later UI rate remains the next-Play default');
    await f.source.play();assert.equal((await f.source.getState()).rate,9);
    await f.source.loadMemory(new Uint8Array([0x33]),{rate:6});assert.equal(f.source.read().defaults.rate,6,'a later explicit load wins when no newer rate edit intervenes');
  }finally{gate.resolve();await f.source.dispose();}
});

test('Code Stop disconnects a pending UI upload, lets it publish passively and never revives its retired node',async()=>{
  const gate=deferred();let block=false;
  const f=fixture({beforePrepare:adapter=>block&&adapter.index===0?gate.promise:undefined});try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Previous'});await f.source.play({loop:true});block=true;
    const loading=f.source.loadMemory(new Uint8Array([0x11,0x22]),{name:'UI pending'});while(f.adapters[0].prepares<2)await turn();
    await f.source.stopCode();assert(f.source.read().busy);assert.equal(f.adapters[0].node.edges.size,0);
    await f.source.play({loop:true});assert.equal(f.adapters.length,2);
    gate.resolve();await loading;assert.equal(f.source.read().asset.name,'UI pending');assert.equal(f.adapters[0].disposals,1);assert.equal(f.adapters[1].disposals,0);
    assert.equal((await f.source.getState()).state,'ready','the authorized replacement is loaded, never auto-played');
    await f.source.play();assert.equal((await f.source.getState()).state,'playing');
  }finally{gate.resolve();await f.source.dispose();}
});

test('current RPC failures retire only MSM, retain the asset and recover with one fresh endpoint on the same clock',async t=>{
  for(const action of ['state','play','stop','reset','write-register'])await t.test(action,async()=>{
    let failAction=null;
    const f=fixture({beforeCommand:(_adapter,command)=>{if(command.type===failAction){failAction=null;throw Error('RPC failed: '+command.type);}}});
    try{
      await f.source.loadSample(pcm(),{name:'Retained'});await f.source.play({loop:true});const previous=f.source.read(),context=f.engine.context;
      failAction=action;
      const invoke=()=>action==='state'?f.source.getState():action==='write-register'?f.source.writeRegister(1,7):f.source[action]();
      await assert.rejects(invoke(),new RegExp('RPC failed: '+action));
      assert.equal(f.source.read().state,'ready');assert.equal(f.source.read().asset.info,previous.asset.info);assert.equal(f.source.read().revision,previous.revision);
      assert.match(f.source.read().error,/RPC failed/);assert.equal(f.adapters[0].disposals,1);assert.equal(f.adapters[0].node.edges.size,0);
      await f.source.play({loop:true});assert.equal(f.adapters.length,2);assert.equal(f.adapters[1].node.context,context);assert.equal((await f.source.getState()).state,'playing');assert(peak(f.adapters[1].render())>.01);
      assert.equal(f.adapters[1].disposals,0);assert.equal(context.state,'running');assert.equal(f.source.read().error,null);
    }finally{await f.source.dispose();}
  });
});

test('an endpoint closed without an error callback recovers, while invalid user parameters keep a healthy endpoint',async()=>{
  const f=fixture();try{
    await f.source.loadMemory(new Uint8Array([0x77,0xff]));await f.source.play({loop:true});
    for(const invoke of [()=>f.source.play({rate:16}),()=>f.source.play({at:1e100}),()=>f.source.stop({at:-1}),()=>f.source.stop(null),
      ()=>f.source.writeRegister(8,0),()=>f.source.writeRegister(1,0,{at:Infinity}),()=>f.source.reset({at:1e100})])
      await assert.rejects(async()=>invoke());
    assert.equal(f.adapters[0].disposals,0);assert.equal((await f.source.getState()).state,'playing');
    f.adapters[0].dispose();await assert.rejects(f.source.getState(),/endpoint closed/);
    assert.equal(f.source.read().state,'ready');assert.equal(f.adapters[0].disposals,1);await f.source.play();assert.equal(f.adapters.length,2);assert.equal((await f.source.getState()).state,'playing');
  }finally{await f.source.dispose();}
});

test('a late failed RPC from a stopped operation cannot retire a newer use of the same endpoint or a replacement endpoint',async t=>{
  for(const replace of [false,true])await t.test(replace?'replacement clock':'same clock',async()=>{
    const gate=deferred();let delay=false;
    const f=fixture({beforeCommand:(_adapter,command)=>{if(delay&&command.type==='state'){delay=false;return gate.promise;}}});
    try{
      await f.source.loadMemory(new Uint8Array([0x77,0xff]));await f.source.play({loop:true});delay=true;
      const old=f.source.getState(),rejected=assert.rejects(old,/old RPC failure/);await turn();await f.source.stop();
      if(replace)f.replaceEngine();await f.source.play({loop:true});const current=f.adapters.at(-1);
      gate.reject(Error('old RPC failure'));await rejected;
      assert.equal(current.disposals,0);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.source.read().error,null);
    }finally{gate.resolve();await f.source.dispose();}
  });
});

test('dispose always disconnects its endpoint and revokes leases even when its Stop RPC fails',async()=>{
  let failStop=false;const f=fixture({beforeCommand:(_adapter,command)=>{if(failStop&&command.type==='stop')throw Error('Stop RPC failed');}});
  await f.source.loadSample(pcm(),{name:'Retained'});const client=await f.source.useCodeClient();await client.play({loop:true});failStop=true;
  await assert.rejects(f.source.dispose(),/Stop RPC failed/);
  assert.equal(f.adapters[0].disposals,1);assert.equal(f.adapters[0].node.edges.size,0);assert.equal(f.source.read().asset.name,'Retained');
  await assert.rejects(f.source.play(),{name:'AbortError'});await assert.rejects(client.getState(),{name:'AbortError'});assert.equal(f.engine.context.state,'running');
  await f.source.dispose();assert.equal(f.adapters[0].disposals,1);
});

test('an old workspace clear cannot erase a newer load or newly borrowed Code performance',async t=>{
  for(const nextAction of ['load','code'])await t.test(nextAction,async()=>{
    const gate=deferred();let delayStop=false;
    const f=fixture({beforeCommand:(_adapter,command)=>{if(delayStop&&command.type==='stop'){delayStop=false;return gate.promise;}}});
    try{
      await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Previous'});await f.source.play({loop:true});delayStop=true;
      const clearing=f.source.clear();await turn();
      const next=nextAction==='load'?f.source.loadMemory(new Uint8Array([0x11,0x22]),{name:'New'}):f.source.useCodeClient().then(client=>client.play({loop:true}));
      gate.resolve();assert.equal(await clearing,false);await next;
      assert.equal(f.source.read().asset.name,nextAction==='load'?'New':'Previous');if(nextAction==='code')assert.equal((await f.source.getState()).state,'playing');
    }finally{gate.resolve();await f.source.dispose();}
  });
});

test('an old RPC deadline that disposes its own adapter cannot close the fresh MSM replay after immediate Stop',async()=>{
  const gate=deferred();let hold=false;
  const f=fixture({beforeCommand:(_adapter,action)=>{if(hold&&action.type==='state'){hold=false;return gate.promise;}}});
  try{await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Retained'});await f.source.play({loop:true});hold=true;
    const pending=f.source.getState(),rejected=assert.rejects(pending,/timed out/);await turn();const old=f.adapters[0];await f.source.stop();
    assert.equal(old.disposals,1);await f.source.play({loop:true});const current=f.adapters[1];assert.equal(current.node.context,old.node.context);assert(peak(current.render())>.01);
    old.dispose();gate.reject(Error('MSM5205 audio command timed out'));await rejected;
    assert.equal(current.disposals,0);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.source.read().asset.name,'Retained');assert.equal(f.source.read().error,null);
  }finally{gate.resolve();await f.source.dispose();}
});

test('a valid future scheduled MSM Stop preserves the healthy active endpoint',async()=>{
  const f=fixture({scheduleFuture:true});try{await f.source.loadMemory(new Uint8Array([0x77,0xff]));await f.source.play({loop:true});
    await f.source.stop({at:5});assert.equal(f.adapters[0].disposals,0);assert.equal(f.adapters.length,1);assert.equal((await f.source.getState()).state,'playing');
  }finally{await f.source.dispose();}
});

test('revoking Code at fade start cancels only its imports and leaves current MSM playback running until physical Stop',async t=>{
  for(const beforePhysical of [true,false])await t.test(beforePhysical?'late read during fade':'late read after fade',async()=>{
    const gate=deferred(),f=fixture();try{
      await f.source.loadMemory(new Uint8Array([0x77,0xff]),{name:'Previous'});await f.source.play({loop:true});
      const old=await f.source.useCodeClient({readFile:()=>gate.promise}),loading=old.loadMemory('/old.adpcm'),rejected=assert.rejects(loading,{name:'AbortError'});
      f.source.revokeCode();assert(!f.source.read().busy);await assert.rejects(old.getState(),{name:'AbortError'});
      assert.equal(f.adapters[0].core.readState().state,'playing');assert(peak(f.adapters[0].render())>.01);assert.equal(f.adapters[0].disposals,0);
      if(!beforePhysical)await f.source.stopCode();gate.resolve(new Uint8Array([0x11,0x22]));await rejected;
      assert.equal(f.source.read().asset.name,'Previous');if(beforePhysical)await f.source.stopCode();assert.equal((await f.source.getState()).state,'ready');
    }finally{gate.resolve();await f.source.dispose();}
  });
  const uiGate=deferred(),f=fixture({readFile:()=>uiGate.promise});try{
    await f.source.loadMemory(new Uint8Array([0x77]),{name:'Previous'});await f.source.play({loop:true});
    const loading=f.source.loadMemory('/ui.adpcm',{name:'UI'});f.source.revokeCode();assert(f.source.read().busy);assert.equal(f.adapters[0].core.readState().state,'playing');
    uiGate.resolve(new Uint8Array([0x11,0x22]));await loading;await f.source.stopCode();assert.equal(f.source.read().asset.name,'UI');
  }finally{uiGate.resolve();await f.source.dispose();}
});
