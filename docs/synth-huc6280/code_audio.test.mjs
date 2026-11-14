// Fake routing/controllers only. No AudioContext or audio output is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeAudio,resolveHuc6280CodeNoteTarget} from './code_audio.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-12,message??`${actual} ~= ${expected}`);
test('HuC6280 note ownership resolves only physical channels on the shared chip',()=>{
  const client={};for(const channel of[0,1,2,3,4,5])for(const method of['noteOn','keyOn','noteOff','keyOff'])assert.deepEqual(resolveHuc6280CodeNoteTarget(client,client,method,[channel]),{target:client,channel});
  assert.equal(resolveHuc6280CodeNoteTarget(client,client,'noteOn',[6]),null);assert.equal(resolveHuc6280CodeNoteTarget(client,client,'setNote',[0]),null);assert.equal(resolveHuc6280CodeNoteTarget(client,{},'keyOn',[0]),null);
});
function fixture({pendingFirstRack=false,pendingFirstClient=false,pendingStop=false,pendingFade=false,msm5205Source,cddaSource,readCddaFile,resolveCddaPath}={}){
  const events=[],racks=[],clients=[],contexts=[],outputCalls=[],media=[];let engine,stops=0,active=0,serial=0,stopTask=null;
  const fadeTask=deferred();
  function node(name,context,gain=1){return{name,context,gain:{value:gain},edges:new Set(),connect(target){this.edges.add(target);events.push(['connect',name,target.name]);},
    disconnect(target){if(target){assert(this.edges.delete(target),'existing route '+name);}else this.edges.clear();events.push(['disconnect',name,target?.name]);}};}
  function makeEngine(){
    const context={state:'running',currentTime:1,sampleRate:48000,closeCalls:0,close(){this.closeCalls++;}};contexts.push(context);
    const input=node('source',context),fade=node('fade',context),master=node('master',context,.7),destination=node('destination',context);
    input.connect(fade);fade.connect(master);master.connect(destination);
    const result={context,codeInputNode:input,codeOutputNode:fade,codeFadeNode:fade,outputNode:master,destination,
      getHuc6280Client(){const token=++serial;active=token;
        const call=(method,args)=>{if(active!==token)throw new DOMException('Old session','AbortError');events.push([method,...args]);return Promise.resolve();};
        const client={sampleRate:48000,nativeSampleRate:44100,channelCount:24,noteOn:(...args)=>call('noteOn',args),noteOff:(...args)=>call('noteOff',args)};
        const task=deferred();clients.push({task,client,token});if(!pendingFirstClient||clients.length>1)task.resolve(client);return task.promise;
      },command(method){assert.equal(method,'stop');events.push(['stop']);stops++;active=0;
        if(pendingStop){stopTask=deferred();return stopTask.promise;}return Promise.resolve();}};
    return result;
  }
  engine=makeEngine();
  const host=createHuc6280CodeAudio({ensureReady:async()=>{events.push(['ensure']);},getAudio:()=>engine,
    msm5205Source,cddaSource,readCddaFile,resolveCddaPath,
    createFxRack:async context=>{
      const task=deferred(),names=new Map();let chain=[];
      const rack={node:node('fx'+racks.length,context),stops:0,disposals:0,
        controller:{liveFx(name,options){if(typeof options?.process!=='function')throw Error('Invalid liveFx');names.set(name,options.context?.gain??1);},
          removeLiveFx:name=>names.delete(name),updateContext(name,values){assert(names.has(name));names.set(name,values.gain);},
          gain:({gain})=>({gain}),setChain:items=>{chain=[...items];return items;},getChain:()=>[...chain],
          clear:()=>{chain=[];},dispose:()=>{chain=[];names.clear();}},
        stop(){this.stops++;events.push(['fx-stop']);},dispose(){this.disposals++;events.push(['fx-dispose']);this.node.disconnect();},
        get factor(){return [...names.values()].reduce((a,b)=>a*b,1)*chain.reduce((a,b)=>a*b.gain,1);}};
      rack.node.factor=()=>rack.factor;racks.push({task,rack});if(!pendingFirstRack||racks.length>1)task.resolve(rack);return task.promise;
    },createOutput:options=>({open(){outputCalls.push('open');options.getGain().gain.value=1;},
      fadeOut(){outputCalls.push('fade');events.push(['fade']);options.getGain().gain.value=0;return pendingFade?fadeTask.promise:Promise.resolve(true);},
      dispose(){outputCalls.push('dispose');options.getGain().gain.value=0;}}),
    readFile:async path=>new TextEncoder().encode(path).buffer,
    createMedia(options){const item={options,closed:false,clients:new Map(),
      async useSoundChip(name){if(!options.isCurrent()||this.closed)throw new DOMException('Old media','AbortError');
        if(!this.clients.has(name))this.clients.set(name,{chip:name,async getState(){if(!options.isCurrent()||item.closed)throw new DOMException('Old media','AbortError');return{state:'playing'};}});return this.clients.get(name);},
      dispose(){this.closed=true;events.push(['media-dispose']);}};media.push(item);return item;},
  });
  const signal=()=>{
    const value=(from,level)=>from===engine.destination?level:[...from.edges].reduce((sum,next)=>sum+value(next,level*(from.factor?.()??from.gain.value)),0);
    return value(engine.codeInputNode,.2);
  };
  return{host,events,racks,clients,contexts,outputCalls,media,signal,get engine(){return engine;},get stops(){return stops;},
    replace(){engine=makeEngine();return engine;},releaseStop(){pendingStop=false;stopTask.resolve();},releaseFade(){pendingFade=false;fadeTask.resolve(true);}};
}

test('HuC6280 Code shares one engine and routes every effect before one fade and one Master',async()=>{
  const f=fixture(),sid=await f.host.useSoundChip('huc6280');assert.equal(sid,await f.host.useSoundChip('huc6280'));
  assert.equal(f.clients.length,1);assert.equal(f.contexts.length,1);near(f.signal(),.14);
  await sid.noteOn(2,'A4');assert(f.events.some(e=>e[0]==='noteOn'&&e[1]===2));
  f.host.fx.liveFx('level',{context:{gain:.25},process(){}});near(f.signal(),.035);
  assert.equal(f.engine.codeInputNode.edges.has(f.engine.codeOutputNode),false,'no parallel dry route');
  f.host.fx.liveFx('level',{context:{gain:.5},process(){}});near(f.signal(),.07,'Apply updates one named effect');
  f.host.fx.updateContext('level',{gain:.75});assert(Math.abs(f.signal()-.105)<1e-12);
  f.host.fx.removeLiveFx('level');near(f.signal(),.14);
  const gain=f.host.fx.gain({gain:.5});f.host.fx.setChain([gain]);near(f.signal(),.07);
  f.host.fx.setChain([]);near(f.signal(),.14);
  assert.equal(f.engine.outputNode.gain.value,.7,'FX never rewrites Master');
  await assert.rejects(f.host.useSoundChip('ym2612'),/supports/);
  await f.host.beforeStop();await f.host.stop();
  near(f.signal(),0);assert(f.events.findIndex(e=>e[0]==='fade')<f.events.findIndex(e=>e[0]==='stop'));
  assert.equal(f.racks[0].rack.disposals,1);assert.equal(f.contexts[0].closeCalls,0);
  assert.throws(()=>sid.noteOn(2,'A4'),{name:'AbortError'});
  f.host.open();near(f.signal(),.14,'Keyboard can reopen only after physical cleanup');
  const fresh=await f.host.useSoundChip('huc6280');assert.notEqual(fresh,sid);await fresh.noteOn(0,60);
  await f.host.dispose();assert.equal(f.contexts[0].closeCalls,0);
});

test('a late old FX preparation is disposed without muting or resetting a newer performance',async()=>{
  const f=fixture({pendingFirstRack:true}),old=f.host.prepare(),rejected=assert.rejects(old,{name:'AbortError'});
  await turn();assert.equal(f.racks.length,1);
  await f.host.stop();const current=await f.host.useSoundChip('huc6280');f.host.open();
  await current.noteOn(1,'E4');const stops=f.stops;
  f.racks[0].task.resolve(f.racks[0].rack);await rejected;
  assert.equal(f.racks[0].rack.disposals,1);assert.equal(f.stops,stops,'late work cannot stop the new Code session');
  assert.equal(f.racks[1].rack.disposals,0);near(f.signal(),.14);
  f.host.fx.liveFx('new',{context:{gain:.25},process(){}});near(f.signal(),.035);await f.host.dispose();
});

test('late HuC6280 startup is fenced and a new prepare waits for the previous physical Stop',async()=>{
  const f=fixture({pendingFirstClient:true,pendingStop:true});
  const old=f.host.prepare(),rejected=assert.rejects(old,{name:'AbortError'});await turn();
  const stopping=f.host.stop(),next=f.host.prepare();await turn();
  assert.equal(f.clients.length,1,'new begin does not overtake physical cleanup');
  f.releaseStop();await stopping;const current=await next;
  f.clients[0].task.resolve(f.clients[0].client);await rejected;
  assert.equal(current.client,f.clients[1].client);assert.equal(f.racks[0].rack.disposals,1);
  await current.client.noteOn(0,'C4');await f.host.dispose();
});

test('changing the editor engine retires only the old owned FX route and prepares the replacement',async()=>{
  const f=fixture();await f.host.prepare();f.host.fx.liveFx('old',{context:{gain:.5},process(){}});
  const old=f.engine;f.replace();await f.host.prepare();
  assert.equal(f.racks[0].rack.disposals,1);assert(old.codeInputNode.edges.has(old.codeOutputNode));
  assert.equal(f.engine.codeInputNode.edges.has(f.engine.codeOutputNode),true);near(f.signal(),.14);
  assert(f.contexts.every(context=>context.closeCalls===0));await f.host.dispose();
});

test('Stop before a gesture-created engine is adopted cannot acquire a late Code lease',async()=>{
  const gate=deferred();let engine=null,clients=0;
  const host=createHuc6280CodeAudio({ensureReady:()=>gate.promise,getAudio:()=>engine,
    createFxRack:()=>assert.fail('Cancelled readiness must not prepare FX'),
    createOutput:()=>({open(){},fadeOut:async()=>true,dispose(){}})});
  const pending=host.prepare(),rejected=assert.rejects(pending,{name:'AbortError'});await turn();await host.stop();
  engine={context:{state:'running'},getHuc6280Client(){clients++;},command:async()=>{}};
  gate.resolve();await rejected;assert.equal(clients,0,'The late idle APU is never borrowed by the cancelled performance');await host.dispose();
});

test('Code media uses the current session and Files callback, and retires before physical Stop without changing the Synth clock',async()=>{
  const f=fixture();
  try{
    const m=await f.host.useSoundChip('msm5205'),cd=await f.host.useSoundChip('cdda');
    assert.equal(m,await f.host.useSoundChip('msm5205'));assert.equal(f.media.length,1);assert.equal(f.clients.length,1);assert.equal(f.contexts.length,1);
    const media=f.media[0];assert.equal(media.options.engine,f.engine);assert.equal(new TextDecoder().decode(await media.options.readFile('/audio/track.wav')),'/audio/track.wav');
    assert.equal((await cd.getState()).state,'playing');f.host.fx.liveFx('all',{context:{gain:.5},process(){}});near(f.signal(),.07);
    await f.host.beforeStop();await f.host.stop();assert(media.closed);assert(f.events.findIndex(e=>e[0]==='media-dispose')<f.events.findIndex(e=>e[0]==='stop'));
    await assert.rejects(m.getState(),{name:'AbortError'});assert.equal(f.contexts[0].closeCalls,0);
    const fresh=await f.host.useSoundChip('cdda');assert.notEqual(fresh,cd);assert.equal(f.media.length,2);
  }finally{await f.host.dispose();}
});

test('Code borrows the authored MSM controller, fades first and retains its sample while CD-DA stays Code-owned',async()=>{
  const borrows=[];let stops=0,sourceRevision=1;
  const source={async useCodeClient(options){let closed=false;const facade={id:'borrow'+borrows.length,sourceId:'shared-msm',async getState(){if(closed||!options.isCurrent())throw new DOMException('Old lease','AbortError');return{revision:sourceRevision};},async dispose(){closed=true;options.onDispose();}};borrows.push({options,facade});return facade;},
    async stopCode(){stops++;f.events.push(['shared-msm-stop']);}};
  const f=fixture({msm5205Source:source});try{
    const m=await f.host.useSoundChip('msm5205');assert.equal(m,await f.host.useSoundChip('msm5205'));assert.equal(borrows.length,1);assert.equal(f.media.length,0);
    assert.equal(new TextDecoder().decode(await borrows[0].options.readFile('/sample.adpcm')),'/sample.adpcm');
    sourceRevision=2;assert.equal((await m.getState()).revision,2,'UI sample edits remain visible through the borrowed Code client');
    await m.dispose();const reborrowed=await f.host.useSoundChip('msm5205');assert.notEqual(reborrowed,m);assert.equal(reborrowed.sourceId,m.sourceId);assert.equal((await reborrowed.getState()).revision,2);
    await assert.rejects(m.getState(),{name:'AbortError'});
    await f.host.useSoundChip('cdda');assert.equal(f.media.length,1);assert.deepEqual([...f.media[0].clients.keys()],['cdda']);
    await f.host.beforeStop();await f.host.stop();assert.equal(stops,1);await assert.rejects(m.getState(),{name:'AbortError'});
    assert(f.events.findIndex(event=>event[0]==='fade')<f.events.findIndex(event=>event[0]==='shared-msm-stop'));
    assert(f.events.findIndex(event=>event[0]==='shared-msm-stop')<f.events.findIndex(event=>event[0]==='stop'));
    assert(f.media[0].closed);assert.equal(sourceRevision,2);
    const next=await f.host.useSoundChip('msm5205');assert.notEqual(next,m);assert.equal((await next.getState()).revision,2);
  }finally{await f.host.dispose();}
});

test('physical Code Stop reaches shared MSM even when only the UI used it, and a source error cannot skip PSG cleanup',async()=>{
  let stopCalls=0,throwStop=false;
  const f=fixture({msm5205Source:{async stopCode(){stopCalls++;if(throwStop)throw Error('MSM failed');}}});
  try{
    await f.host.prepare();await f.host.beforeStop();await f.host.stop();assert.equal(stopCalls,1);assert.equal(f.stops,1);
    await f.host.prepare();throwStop=true;await assert.rejects(f.host.stop(),/MSM failed/);assert.equal(stopCalls,2);assert.equal(f.stops,2);
  }finally{throwStop=false;await f.host.dispose();}
});

test('Code borrows both authored CD sources with a dedicated CDDA reader and disposes/reborrows only that lease',async()=>{
  const sources={};for(const chip of ['msm5205','cdda'])sources[chip]={borrows:[],stops:0,async useCodeClient(options){
    let closed=false;const value={id:`${chip}:${this.borrows.length}`,sourceId:`shared:${chip}`,async getState(){if(closed||!options.isCurrent())throw new DOMException('Old lease','AbortError');return{track:7,revision:2};},async dispose(){closed=true;options.onDispose();}};
    this.borrows.push({options,value});return value;},async stopCode(){this.stops++;}};
  const f=fixture({msm5205Source:sources.msm5205,cddaSource:sources.cdda,readCddaFile:async path=>new TextEncoder().encode('CDDA:'+path),resolveCddaPath:path=>'/code/'+path});
  try{
    const m=await f.host.useSoundChip('msm5205'),cd=await f.host.useSoundChip('cdda');assert.equal(cd,await f.host.useSoundChip('cdda'));assert.equal(f.media.length,0);
    assert.equal(new TextDecoder().decode(await sources.msm5205.borrows[0].options.readFile('/project.adpcm')),'/project.adpcm');
    assert.equal(new TextDecoder().decode(await sources.cdda.borrows[0].options.readFile('/session-cdda/song.wav')),'CDDA:/session-cdda/song.wav');
    assert.equal(sources.cdda.borrows[0].options.resolvePath('album.json'),'/code/album.json');assert.equal(sources.msm5205.borrows[0].options.resolvePath,undefined);
    await cd.dispose();const next=await f.host.useSoundChip('cdda');assert.notEqual(next,cd);assert.equal(next.sourceId,cd.sourceId);assert.equal((await m.getState()).revision,2);
    await f.host.beforeStop();await f.host.stop();assert.equal(sources.msm5205.stops,1);assert.equal(sources.cdda.stops,1);await assert.rejects(next.getState(),{name:'AbortError'});
  }finally{await f.host.dispose();}
});

test('Code Stop attempts both UI-owned CD sources and PSG even if one source rejects synchronously or asynchronously',async()=>{
  for(const first of ['msm5205','cdda']){
    const calls=[],f=fixture({msm5205Source:{stopCode(){calls.push('msm5205');if(first==='msm5205')throw Error('MSM failed');}},
      cddaSource:{async stopCode(){calls.push('cdda');if(first==='cdda')throw Error('CDDA failed');}}});
    await assert.rejects(f.host.stop(),/failed/);assert.deepEqual(calls.sort(),['cdda','msm5205']);assert.equal(f.stops,1);
    // No dispose call here: the deliberately broken injected source keeps
    // rejecting. The assertions above already verify physical host cleanup.
  }
});

test('Code beforeStop revokes both borrowed sources before its held fade, without stopping their physical playback',async()=>{
  const calls=[],sources={};for(const chip of ['msm5205','cdda'])sources[chip]={playing:true,revokes:0,stops:0,async useCodeClient(options){return{async getState(){if(!options.isCurrent())throw new DOMException('Old lease','AbortError');return{};}};},
    revokeCode(){this.revokes++;calls.push(chip+':revoke');},async stopCode(){this.stops++;this.playing=false;calls.push(chip+':stop');}};
  const f=fixture({msm5205Source:sources.msm5205,cddaSource:sources.cdda,pendingFade:true});try{
    const m=await f.host.useSoundChip('msm5205'),cd=await f.host.useSoundChip('cdda');const fading=f.host.beforeStop();
    assert.deepEqual(calls,['msm5205:revoke','cdda:revoke']);assert(f.outputCalls.includes('fade'));assert(sources.msm5205.playing&&sources.cdda.playing);assert.equal(f.stops,0);
    await assert.rejects(m.getState(),{name:'AbortError'});await assert.rejects(cd.getState(),{name:'AbortError'});
    f.releaseFade();await fading;await f.host.stop();assert.equal(sources.msm5205.stops,1);assert.equal(sources.cdda.stops,1);assert.equal(f.stops,1);
  }finally{f.releaseFade();await f.host.dispose();}
});

test('beforeStop attempts both revocations and always fades even when a source revoke hook throws',async()=>{
  const calls=[],f=fixture({pendingFade:true,msm5205Source:{revokeCode(){calls.push('msm');throw Error('Revoke failed');},stopCode(){}},
    cddaSource:{revokeCode(){calls.push('cdda');},stopCode(){}}});try{
    const fading=f.host.beforeStop(),rejected=assert.rejects(fading,/Revoke failed/);assert.deepEqual(calls,['msm','cdda']);assert(f.outputCalls.includes('fade'));assert.equal(f.stops,0);
    f.releaseFade();await rejected;await f.host.stop();assert.equal(f.stops,1);
  }finally{f.releaseFade();await f.host.dispose();}
});
