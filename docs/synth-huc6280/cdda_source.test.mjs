// SPDX-License-Identifier: BSD-3-Clause
// Actual shared CD-DA player and PCM WASM into inert nodes; no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCddaSource} from './cdda_source.js';
import {createCDDAPCM} from '../js/cdda_pcm.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {resolveCddaInputPath} from './cdda_inputs.js';

const wasmBinary=await readFile(new URL('../generated/cdda_wasm.wasm',import.meta.url));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const peak=values=>values.reduce((n,x)=>Math.max(n,Math.abs(x)),0);
const node=context=>({context,edges:new Set(),connect(input){this.edges.add(input);},disconnect(){this.edges.clear();}});
function wav(frames=8820,hz=440){const bytes=new Uint8Array(44+frames*4),v=new DataView(bytes.buffer),tag=(offset,text)=>bytes.set(new TextEncoder().encode(text),offset);
  tag(0,'RIFF');v.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,44100,true);v.setUint32(28,176400,true);v.setUint16(32,4,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,frames*4,true);
  for(let i=0;i<frames;i++){v.setInt16(44+i*4,Math.round(6000*Math.sin(i*2*Math.PI*hz/44100)),true);v.setInt16(46+i*4,Math.round(4000*Math.sin(i*2*Math.PI*(hz+110)/44100)),true);}return bytes;}
const manifest={tracks:[{number:3,file:'one.wav',title:'First',startFrame:100,endFrame:8100},{number:7,file:'two.wav',title:'Second'}]};
function fixture(options={}){
  let engine,ensures=0;const engines=[],adapters=[],events=[],errors=[],states=[],reads=[];
  const files=new Map([['/album/set.json',new TextEncoder().encode(JSON.stringify(manifest))],['/album/one.wav',wav()],['/album/two.wav',wav(4410,660)]]);
  function makeEngine(){const context={state:'running',sampleRate:48000,currentTime:0},input=node(context),value={context,input,getChipInputNode:name=>{assert.equal(name,'cdda');return input;},getChipMix:()=>({volume:.8,pan:0,muted:false,effectiveMuted:false})};engines.push(value);return value;}
  engine=makeEngine();
  const source=createCddaSource({ensureAudio:async()=>{ensures++;await options.ensureAudio?.();},getAudio:()=>engine,
    readFile:async(path,settings)=>{reads.push(path);if(options.readFile)return options.readFile(path,settings);if(!files.has(path))throw Error('Missing '+path);return files.get(path);},
    onState:state=>states.push(state),onError:reason=>errors.push(reason),createAudio:async(context,{signal})=>{
      const core=await createCDDAPCM({sampleRate:context.sampleRate,wasmBinary});
      const adapter={index:adapters.length,node:node(context),core,prepares:0,disposals:0,dead:false,
        async prepare(bytes){this.prepares++;const copy=bytes.slice();events.push(['prepare',this.index]);await options.beforePrepare?.(this);
          if(this.dead||signal.aborted)throw new DOMException('Adapter retired','AbortError');core.prepare(copy);},
        async command(action,timing={}){if(this.dead)throw Error('CD-DA endpoint closed');events.push([action.type,this.index]);await options.beforeCommand?.(this,action,timing);
          if(options.scheduleFuture&&timing.at>context.currentTime)return{...core.status(),scheduled:true};
          if(action.type==='state')return core.status();if(action.type==='play'){core.play();if(action.sourceFrame)core.seek(action.sourceFrame);}
          else if(action.type==='seek')core.seek(action.sourceFrame);else core[action.type]();return core.status();},
        dispose(){if(this.dead)return;this.dead=true;this.disposals++;this.node.disconnect();core.dispose();events.push(['dispose',this.index]);},
        render(frames=512){const left=new Float32Array(frames),right=new Float32Array(frames);core.render(left,right);return{left,right};}};
      adapters.push(adapter);signal.addEventListener('abort',()=>adapter.dispose(),{once:true});return adapter;
    }});
  return{source,files,engines,adapters,events,errors,states,reads,get ensures(){return ensures;},get engine(){return engine;},replaceEngine(){engine=makeEngine();return engine;}};
}

test('WAV and lazy-manifest loading validate/select passively, own selected bytes and never read every track',async()=>{
  const f=fixture();try{
    assert.equal((await f.source.getState()).state,'empty');const input=wav();await f.source.load(input,{name:'Owned',path:'/owned.wav'});input.fill(0);
    assert.equal(f.source.read().track.frames,8820);assert.equal(f.ensures,0);assert.equal(f.adapters.length,0);
    await f.source.load('/album/set.json');assert.deepEqual(f.reads,['/album/set.json','/album/one.wav']);
    assert.equal(f.source.read().selectedTrack,3);assert.equal(f.source.read().track.frames,8000);assert.equal(f.source.read().track.file,'/album/one.wav');
    assert.equal(f.source.read().track.bytes,32000);assert.equal(f.source.read().track.duration,8000/44100);assert.equal(f.source.list()[1].number,7);
    await f.source.selectTrack(7);assert.equal(f.source.read().selectedTrack,7);assert.equal(f.source.read().track.frames,4410);assert.deepEqual(f.reads,['/album/set.json','/album/one.wav','/album/two.wav']);
    assert.equal(f.ensures,0);assert.equal((await f.source.getState()).track,7);
    await f.source.load(wav(),{name:'Detached'});await f.source.play();assert(peak(f.adapters[0].render().left)>.01);
  }finally{await f.source.dispose();}
});

test('the selected WAV owns one detached PCM buffer rather than borrowing mutable caller bytes',async()=>{
  const f=fixture();try{const input=wav();await f.source.load(input);input.fill(0);await f.source.play();const stereo=f.adapters[0].render();assert(peak(stereo.left)>.01&&peak(stereo.right)>.01);}finally{await f.source.dispose();}
});

test('malformed replacement, unknown/malformed track and invalid cross-track offsets keep the previous selected source playing',async()=>{
  const f=fixture();try{
    await f.source.load('/album/set.json');await f.source.play();const previous=f.source.read(),prepares=f.adapters[0].prepares;
    await assert.rejects(f.source.load(new Uint8Array([1,2])),/truncated/);
    await assert.rejects(f.source.selectTrack(99),/Unknown/);f.files.set('/album/two.wav',new Uint8Array([1]));
    await assert.rejects(f.source.selectTrack(7),/truncated/);assert.equal(f.source.read().selectedTrack,3);assert.equal(f.source.read().asset.path,previous.asset.path);
    f.files.set('/album/two.wav',wav(4410));await assert.rejects(f.source.play(7,{offset:5}),/outside/);
    assert.equal(f.source.read().selectedTrack,3);assert.equal(f.source.read().revision,previous.revision);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.adapters[0].prepares,prepares);
  }finally{await f.source.dispose();}
});

test('UI-ready seek is passive; shared UI/Code pause, resume and seek preserve one physical stereo cursor',async()=>{
  const f=fixture();try{
    await f.source.load(wav());await f.source.seek(.03);assert.equal(f.source.read().position,.03);assert.equal((await f.source.getState()).positionSeconds,.03);assert.equal(f.ensures,0);
    await f.source.play(undefined,{offset:f.source.read().position});assert.equal((await f.source.getState()).positionFrames,1323);
    const client=await f.source.useCodeClient();const stereo=f.adapters[0].render();assert(peak(stereo.left)>.01&&peak(stereo.right)>.01);assert.notDeepEqual(stereo.left,stereo.right);
    await client.pause();const paused=await client.getState();assert.equal(paused.state,'paused');assert.equal(peak(f.adapters[0].render().left),0);assert.equal((await client.getState()).positionFrames,paused.positionFrames);
    await f.source.resume();assert.equal((await client.getState()).state,'playing');await client.seek(.02);assert.equal(f.source.read().position,.02);
    await f.source.stop();assert.equal(f.source.read().position,0);await f.source.seek(.04);assert.equal((await client.getState()).positionSeconds,.04);
    await client.play();assert.equal((await client.getState()).positionFrames,0,'Code play defaults to offset zero');
    assert.equal(f.adapters.length,1);assert.equal(f.adapters[0].node.context,f.engine.context);assert.deepEqual([...f.adapters[0].node.edges],[f.engine.input]);
  }finally{await f.source.dispose();}
});

test('real guarded Code can index/mutate detached list/state arrays and continues through UI edits and Apply',async()=>{
  const f=fixture(),runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,supportedSoundChips:['cdda'],guardExecution:true,createTaskChannel:()=>null,
    useSoundChip:()=>f.source.useCodeClient(),stopSoundChips:()=>f.source.stopCode()});
  try{
    await f.source.load('/album/set.json');await runtime.run(`const cd=await useSoundChip('cdda');context.cd=cd;const tracks=await cd.list();
context.first=tracks[0].number;tracks[0].title='Only this copy';tracks.push({number:99});
await cd.play();const state=await cd.getState();context.actualTitle=state.tracks[0].title;context.sourceId=state.sourceId;context.selected=state.track;state.tracks[0].number=99;
context.ticks=0;liveLoop('melody',async()=>{context.ticks++;await sleep(.005);});`);
    const context=runtime.getContext();assert.equal(context.first,3);assert.equal(context.actualTitle,'First');assert.equal(context.selected,3);assert.equal(f.source.list().length,2);assert.equal(f.source.list()[0].number,3);
    f.adapters[0].render();const cursor=(await context.cd.getState()).positionFrames;
    await runtime.apply(`const cd=await useSoundChip('cdda');context.sameSource=(await cd.getState()).sourceId===context.sourceId;context.cursor=(await cd.getState()).positionFrames;liveLoop('melody',async()=>{context.ticks++;await sleep(.005);});`);
    assert.equal(context.sameSource,true);assert.equal(context.cursor,cursor);
    await f.source.selectTrack(7);assert.equal(f.adapters[0].disposals,1,'successful selection releases the old native PCM immediately');
    assert.equal(f.adapters.length,1,'selection stays passive until Play');await f.source.play(7);await f.source.pause();await f.source.resume();await new Promise(resolve=>setTimeout(resolve,25));assert(context.ticks>=2);assert(runtime.getState().running);
    assert.equal((await context.cd.getState()).track,7);const old=context.cd;await runtime.stop();assert.equal(f.source.read().selectedTrack,7);assert.equal(f.source.read().position,0);await assert.rejects(async()=>old.play(),{name:'AbortError'});
    await f.source.play();assert.equal((await f.source.getState()).track,7);
  }finally{await runtime.stop();await f.source.dispose();}
});

test('manifest paths become absolute at Code load time and remain stable when the Code execution file changes',async()=>{
  const f=fixture();let execution='/album/index.js';const paths=[];
  try{
    const client=await f.source.useCodeClient({resolvePath:path=>resolveCddaInputPath(path,execution),readFile:async path=>{paths.push(path);return f.files.get(resolveCddaInputPath(path,execution));}});
    await client.load('set.json');execution='/elsewhere/different.js';await f.source.stopCode();await f.source.selectTrack(7);
    assert.deepEqual(paths,['/album/set.json','/album/one.wav','/album/two.wav']);assert.equal(f.source.read().track.file,'/album/two.wav');assert.equal(f.ensures,0);
  }finally{await f.source.dispose();}
});

test('JSON bytes with a manifest path resolve lazy tracks relative to that file and expose session dependencies',async()=>{
  const f=fixture();try{
    await f.source.load(new TextEncoder().encode(JSON.stringify(manifest)),{path:'/album/set.json',name:'Album'});
    assert.equal(f.source.read().asset.dependsSession,false);assert.equal(f.source.read().selectedTrack,3);assert.deepEqual(f.reads,['/album/one.wav']);
    const provider='/session-cdda/track.wav';f.files.set(provider,wav());await f.source.load({tracks:[{number:1,file:provider}]});assert.equal(f.source.read().asset.dependsSession,true);
  }finally{await f.source.dispose();}
});

test('cancelled File reads and stale Code loads cannot replace a new track; a distinct UI load may survive Code Stop',async()=>{
  const gate=deferred(),f=fixture({readFile:()=>gate.promise});try{
    await f.source.load(wav(),{name:'Previous'});const loading=f.source.load('/late.wav'),rejected=assert.rejects(loading,{name:'AbortError'});f.source.cancelLoad();assert(!f.source.read().busy);
    gate.resolve(wav());await rejected;assert.equal(f.source.read().asset.name,'Previous');
    const oldGate=deferred(),old=await f.source.useCodeClient({readFile:()=>oldGate.promise});const oldLoad=old.load('/old.wav'),oldRejected=assert.rejects(oldLoad,{name:'AbortError'});await f.source.stopCode();
    await f.source.load(wav(4410,660),{name:'New'});await f.source.play();const revision=f.source.read().revision;oldGate.resolve(wav());await oldRejected;
    assert.equal(f.source.read().asset.name,'New');assert.equal(f.source.read().revision,revision);assert.equal((await f.source.getState()).state,'playing');
    const uiGate=deferred(),ui=f.source.load('/ui.wav',{name:'UI',signal:undefined});await f.source.stopCode();await ui;assert.equal(f.source.read().asset.name,'UI');uiGate.resolve();
  }finally{await f.source.dispose();}
});

test('Stop during audio startup or transferred PCM upload prevents late Play and retains the selected track',async t=>{
  await t.test('startup',async()=>{const gate=deferred(),f=fixture({ensureAudio:()=>gate.promise});try{
    await f.source.load(wav());const playing=f.source.play(),rejected=assert.rejects(playing,{name:'AbortError'});await turn();assert(f.source.read().transportPending);await f.source.stop();
    const next=f.source.play();gate.resolve();await rejected;await next;assert.equal(f.adapters.length,1);assert.equal((await f.source.getState()).state,'playing');
  }finally{gate.resolve();await f.source.dispose();}});
  await t.test('PCM upload',async()=>{const gate=deferred(),f=fixture({beforePrepare:adapter=>adapter.index===0?gate.promise:undefined});try{
    await f.source.load(wav(),{name:'Retained'});const old=await f.source.useCodeClient();const playing=old.play(),rejected=assert.rejects(playing,{name:'AbortError'});
    while(!f.adapters[0]?.prepares)await turn();await f.source.stopCode();assert.equal(f.adapters[0].disposals,1);assert.equal(f.adapters[0].node.edges.size,0);
    await f.source.play();gate.resolve();await rejected;assert.equal(f.adapters.length,2);assert.equal(f.source.read().asset.name,'Retained');assert.equal((await f.source.getState()).state,'playing');
  }finally{gate.resolve();await f.source.dispose();}});
});

test('disposing a borrowed CDDA client keeps the track and permits a new lease; old dispose cannot stop the new client',async()=>{
  const f=fixture();try{await f.source.load(wav());let released=0;const old=await f.source.useCodeClient({onDispose:()=>released++});await old.play();await old.dispose();assert.equal(released,1);
    const next=await f.source.useCodeClient();assert.notEqual(next.id,old.id);assert.equal(next.sourceId,old.sourceId);await next.play();await assert.rejects(old.dispose(),{name:'AbortError'});assert.equal((await next.getState()).state,'playing');assert.equal(f.adapters.length,1);
  }finally{await f.source.dispose();}
});

test('current non-Abort RPC failures and a silently closed adapter recover with retained PCM on the same context',async t=>{
  for(const action of ['state','play','pause','resume','seek','stop'])await t.test(action,async()=>{
    let failed=null;const f=fixture({beforeCommand:(_adapter,command)=>{if(command.type===failed){failed=null;throw Error('RPC failed: '+command.type);}}});try{
      await f.source.load(wav(),{name:'Retained'});await f.source.play();if(action==='resume')await f.source.pause();failed=action;
      const call=()=>action==='state'?f.source.getState():action==='seek'?f.source.seek(.01):f.source[action]();await assert.rejects(call(),/RPC failed/);
      assert.equal(f.source.read().state,'ready');assert.equal(f.source.read().asset.name,'Retained');assert.equal(f.adapters[0].disposals,1);
      await f.source.play();assert.equal(f.adapters.length,2);assert.equal(f.adapters[1].node.context,f.engine.context);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.source.read().error,null);
    }finally{await f.source.dispose();}
  });
  const f=fixture();try{await f.source.load(wav());await f.source.play();f.adapters[0].dispose();await assert.rejects(f.source.getState(),/closed/);await f.source.play();assert.equal(f.adapters.length,2);}finally{await f.source.dispose();}
});

test('invalid user arguments do not retire a healthy endpoint, while old late RPC errors cannot retire a new performance',async()=>{
  const gate=deferred();let delay=false;const f=fixture({beforeCommand:(_adapter,action)=>{if(delay&&action.type==='state'){delay=false;return gate.promise;}}});try{
    await f.source.load(wav());await f.source.play();
    for(const call of [()=>f.source.play(99),()=>f.source.play(undefined,{offset:5}),()=>f.source.play(undefined,{at:1e100}),()=>f.source.seek(-1),()=>f.source.pause({at:-1}),()=>f.source.stop(null)])await assert.rejects(async()=>call());
    assert.equal(f.adapters[0].disposals,0);delay=true;const old=f.source.getState(),rejected=assert.rejects(old,/Old RPC/);await turn();await f.source.stop();await f.source.play();
    gate.reject(Error('Old RPC'));await rejected;assert.equal(f.adapters[0].disposals,1);assert.equal(f.adapters[1].disposals,0);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.source.read().error,null);
    const first=f.engine;f.replaceEngine();assert.equal((await f.source.getState()).state,'ready');await f.source.play();assert.equal(f.adapters.length,3);assert.equal(first.context.state,'running');
  }finally{gate.resolve();await f.source.dispose();}
});

test('clear is atomic against newer loads/leases, and disposal always cleans up even if Stop fails',async()=>{
  const gate=deferred();let delayStop=false,failStop=false;const f=fixture({beforeCommand:(_adapter,command)=>{if(command.type==='stop'){if(failStop)throw Error('Stop failed');if(delayStop){delayStop=false;return gate.promise;}}}});
  await f.source.load(wav(),{name:'Old'});await f.source.play();delayStop=true;const clearing=f.source.clear();await turn();const loading=f.source.load(wav(4410),{name:'New'});gate.resolve();
  assert.equal(await clearing,false);await loading;assert.equal(f.source.read().asset.name,'New');await f.source.play();failStop=true;
  await assert.rejects(f.source.dispose(),/Stop failed/);assert(f.adapters.every(adapter=>adapter.disposals===1));await assert.rejects(f.source.play(),{name:'AbortError'});await f.source.dispose();
  const clean=fixture();try{await clean.source.load(wav());assert.equal(await clean.source.clear(),true);assert.equal(clean.source.read().asset,null);assert.equal(clean.source.read().state,'empty');}finally{await clean.source.dispose();}
});

test('a Code lease acquired after an older Clear began keeps its selected source and can play after that Stop fence',async()=>{
  const gate=deferred();let delay=false;const f=fixture({beforeCommand:(_adapter,command)=>{if(delay&&command.type==='stop'){delay=false;return gate.promise;}}});
  try{await f.source.load(wav(),{name:'Retained'});await f.source.play();delay=true;const clearing=f.source.clear();await turn();
    const client=await f.source.useCodeClient(),next=client.play();gate.resolve();assert.equal(await clearing,false);await next;assert.equal(f.source.read().asset.name,'Retained');assert.equal((await client.getState()).state,'playing');
  }finally{gate.resolve();await f.source.dispose();}
});

test('an old RPC deadline that disposes its own adapter cannot close the fresh CDDA replay after immediate Stop',async()=>{
  const gate=deferred();let hold=false;
  const f=fixture({beforeCommand:(_adapter,action)=>{if(hold&&action.type==='state'){hold=false;return gate.promise;}}});
  try{await f.source.load(wav(),{name:'Retained'});await f.source.play();hold=true;
    const pending=f.source.getState(),rejected=assert.rejects(pending,/timed out/);await turn();const old=f.adapters[0];await f.source.stop();
    assert.equal(old.disposals,1);await f.source.play();const current=f.adapters[1];assert.equal(current.node.context,old.node.context);assert(peak(current.render().left)>.01);
    // Same behavior as the existing shared adapter's request timeout: it
    // closes the whole adapter before rejecting that old request.
    old.dispose();gate.reject(Error('CD-DA audio command timed out'));await rejected;
    assert.equal(current.disposals,0);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.source.read().asset.name,'Retained');assert.equal(f.source.read().error,null);
  }finally{gate.resolve();await f.source.dispose();}
});

test('CDDA publishes Stop pending synchronously, and a queued Pause after Stop does not send an invalid pause RPC',async()=>{
  const gate=deferred();let hold=false;const f=fixture({beforeCommand:(_adapter,action)=>{if(hold&&action.type==='stop'){hold=false;return gate.promise;}}});
  try{await f.source.load(wav());await f.source.play();hold=true;const count=f.events.filter(event=>event[0]==='pause').length;
    const stopping=f.source.stop();assert.equal(f.source.read().transportPending,true);const pausing=f.source.pause();await turn();gate.resolve();await stopping;await pausing;
    assert.equal(f.source.read().transportPending,false);assert.equal(f.source.read().state,'ready');assert.equal(f.events.filter(event=>event[0]==='pause').length,count);assert.equal(f.source.read().error,null);
  }finally{gate.resolve();await f.source.dispose();}
});

test('a valid future scheduled CDDA Stop keeps the current endpoint and cursor active until its scheduled time',async()=>{
  const f=fixture({scheduleFuture:true});try{await f.source.load(wav());await f.source.play();f.adapters[0].render();const before=(await f.source.getState()).positionFrames;
    await f.source.stop({at:5});assert.equal(f.adapters[0].disposals,0);assert.equal(f.adapters.length,1);assert.equal((await f.source.getState()).state,'playing');assert.equal(f.source.read().position,before/44100);
  }finally{await f.source.dispose();}
});

test('revoking Code at fade start cancels only its imports and leaves current CDDA playback running until physical Stop',async t=>{
  for(const beforePhysical of [true,false])await t.test(beforePhysical?'late read during fade':'late read after fade',async()=>{
    const gate=deferred(),f=fixture();try{
      await f.source.load(wav(),{name:'Previous'});await f.source.play();
      const old=await f.source.useCodeClient({readFile:()=>gate.promise}),loading=old.load('/old.wav'),rejected=assert.rejects(loading,{name:'AbortError'});
      f.source.revokeCode();assert(!f.source.read().busy);await assert.rejects(old.getState(),{name:'AbortError'});
      assert.equal(f.adapters[0].core.status().state,'playing');assert(peak(f.adapters[0].render().left)>.01);assert.equal(f.adapters[0].disposals,0);
      if(!beforePhysical)await f.source.stopCode();gate.resolve(wav(4410));await rejected;
      assert.equal(f.source.read().asset.name,'Previous');if(beforePhysical)await f.source.stopCode();assert.equal((await f.source.getState()).state,'ready');
    }finally{gate.resolve();await f.source.dispose();}
  });
  const uiGate=deferred(),f=fixture({readFile:()=>uiGate.promise});try{
    await f.source.load(wav(),{name:'Previous'});await f.source.play();
    const loading=f.source.load('/ui.wav',{name:'UI'});f.source.revokeCode();assert(f.source.read().busy);assert.equal(f.adapters[0].core.status().state,'playing');
    uiGate.resolve(wav(4410));await loading;await f.source.stopCode();assert.equal(f.source.read().asset.name,'UI');
  }finally{uiGate.resolve();await f.source.dispose();}
});
