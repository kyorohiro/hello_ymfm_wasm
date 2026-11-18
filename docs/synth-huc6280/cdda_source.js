// SPDX-License-Identifier: BSD-3-Clause
// One selected authored CD-DA track and cursor, shared by UI and Code leases.
// Parsing/selection never opens audio; long albums retain only selected PCM.
import {createCddaAudio} from '../js/cdda_audio.js';
import {createCddaPlayer} from '../js/cdda_player.js';
import {createPceMediaOutput,readMediaReleaseSeconds} from './media_output.js?v=huc-media-live-1';
import {createCddaTrackSource,createCddaWavTrackSource,parseCddaTrackManifest,CDDA_MAX_TRACK_BYTES} from '../js/cdda_source.js';

let sourceSerial=0;
const abort=()=>new DOMException('CD-DA source operation cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
const copyTracks=tracks=>tracks.map(track=>({...track}));
function frame(seconds){if(!Number.isFinite(seconds)||seconds<0||!Number.isSafeInteger(Math.round(seconds*44100)))throw RangeError('CD-DA position must be finite nonnegative seconds');return Math.round(seconds*44100);}
function relativeFile(file,path){
  if(file.startsWith('/')||!path)return file;
  const base=path.replaceAll('\\','/').split('/').slice(0,-1),parts=(base.join('/')+'/'+file).split('/'),out=[];
  const absolute=path.startsWith('/');
  for(const part of parts){if(!part||part==='.')continue;if(part==='..'&&out.length&&out.at(-1)!=='..')out.pop();else out.push(part);}
  return(absolute?'/':'')+out.join('/');
}
// Keep exactly one owned PCM buffer. A 44-byte WAV header lets the existing
// shared player use its original validated WAV path without a second PCM copy.
function ownTrack(track){
  if(!(track.pcm instanceof Uint8Array)||!track.pcm.length||track.pcm.length>CDDA_MAX_TRACK_BYTES)throw RangeError('CD-DA selected PCM exceeds 256 MiB');
  const wav=new Uint8Array(44+track.pcm.length),v=new DataView(wav.buffer),tag=(offset,text)=>wav.set(new TextEncoder().encode(text),offset);
  tag(0,'RIFF');v.setUint32(4,wav.length-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,44100,true);v.setUint32(28,176400,true);v.setUint16(32,4,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,track.pcm.length,true);wav.set(track.pcm,44);
  const {pcm,...metadata}=track;
  return{wav,info:{...metadata,frames:track.pcm.length/4,duration:track.pcm.length/176400,bytes:track.pcm.length,sampleRate:44100,channels:2}};
}

export function createCddaSource({ensureAudio,getAudio,readFile,onState=()=>{},onError=()=>{},createAudio=createCddaAudio,createPlayer=createCddaPlayer}={}){
  if([ensureAudio,getAudio,onState,onError,createAudio,createPlayer].some(fn=>typeof fn!=='function')||readFile!==undefined&&typeof readFile!=='function')throw TypeError('CD-DA source requires Synth audio owner callbacks');
  const sourceId=`huc6280-synth:cdda-source:${++sourceSerial}`,listeners=new Set(),leases=new Set(),transport=new Set();
  let dead=false,closing=false,authority=0,revision=0,asset=null,selected=null,positionFrame=0,actual=null,error=null,pending=null,operation=0,codeEpoch=0,leaseSerial=0;
  let endpoint=null,starting=null,tail=Promise.resolve(),stopping=null;
  let playbackGeneration=0,lastPlayback=null;
  let previewing=null,releasing=null;
  const checkLease=lease=>{if(dead||closing||lease&&(lease.closed||lease.epoch!==codeEpoch||!lease.isCurrent()))throw abort();};
  const check=(token,lease)=>{checkLease(lease);if(token!==operation)throw abort();};
  function list(){checkLease();return copyTracks(asset?.tracks??[]);}
  function read(){return{sourceId,revision,playbackGeneration,asset:asset?{name:asset.name,path:asset.path,format:asset.format,dependsSession:asset.path?.startsWith('/session-cdda/')||asset.tracks.some(track=>track.file?.startsWith('/session-cdda/')),tracks:copyTracks(asset.tracks)}:null,
    selectedTrack:selected?.info.number??null,track:selected?{...selected.info}:null,position:positionFrame/44100,
    actual:actual?{...actual,tracks:copyTracks(asset?.tracks??[])}:null,state:actual?.state??(asset?'ready':'empty'),busy:!!pending,transportPending:transport.size>0||!!starting||!!stopping,error};}
  function emit(){const state=read();onState(state);for(const listener of listeners)listener(state);return state;}
  function fail(reason){if(!isAbort(reason)){error=reason?.message??String(reason);emit();onError(reason);}}
  function timing(options={}){
    if(!options||typeof options!=='object'||Array.isArray(options))throw TypeError('CD-DA timing requires an options object');
    const at=options.at,rate=getAudio()?.context?.sampleRate??384000;
    if(at!==undefined&&(!Number.isFinite(at)||at<0||!Number.isSafeInteger(Math.round(at*rate))))throw RangeError('CD-DA at must be nonnegative audio-clock seconds');
    return at===undefined?{}:{at};
  }
  function retire(item){if(!item||item.closed)return;item.closed=true;item.controller.abort(abort());if(endpoint===item){endpoint=null;actual=null;}if(starting===item)starting=null;
    try{item.adapter?.node?.disconnect();}catch{}item.output?.dispose();if(item.player)item.player.dispose();else item.adapter?.dispose();}
  function existing(){if(endpoint&&(endpoint.engine!==getAudio()||endpoint.context.state==='closed'))retire(endpoint);return endpoint;}
  function cancelRelease(){const old=releasing;releasing=null;old?.controller.abort(abort());}
  function cancelPreview(){const old=previewing;previewing=null;old?.controller.abort(abort());}
  async function rpc(item,token,run,stateRead=false){item.pendingRpcs=(item.pendingRpcs??0)+1;if(stateRead)item.stateReads=(item.stateReads??0)+1;
    try{return await run();}catch(reason){if(!isAbort(reason)&&token===operation&&endpoint===item&&!item.closed){retire(item);fail(reason);}throw reason;}
    finally{item.pendingRpcs--;if(stateRead)item.stateReads--;}}
  function serial(run,lease,token=operation){const task=tail.then(async()=>{check(token,lease);if(stopping)await stopping;check(token,lease);return run(token);});tail=task.catch(()=>{});return task;}
  function cancelLoad({retireUpload=true}={}){if(!pending)return;const old=pending;pending=null;old.controller.abort(abort());if(endpoint?.loadOwner===old){if(retireUpload)retire(endpoint);else endpoint.retireAfterCodeFade=true;}emit();}
  function beginLoad(lease,signal){checkLease(lease);authority++;cancelPreview();cancelLoad();const controller=new AbortController(),item={lease,controller,signal:signal?AbortSignal.any([controller.signal,signal]):controller.signal};pending=item;error=null;emit();return item;}
  const checkLoad=item=>{checkLease(item.lease);item.signal.throwIfAborted();if(pending!==item)throw abort();};
  function endLoad(item,reason){if(pending===item){pending=null;if(reason)fail(reason);emit();}}
  async function install(item,value,token,lease,owner=null){
    item.installing=true;item.loadOwner=owner;
    try{await rpc(item,token,()=>item.player.load(value.wav));check(token,lease);if(owner)checkLoad(owner);if(endpoint!==item||item.closed)throw abort();item.installed=value;}
    catch(reason){retire(item);throw reason;}finally{item.loadOwner=null;item.installing=false;}
  }
  async function ensureEndpoint(token,lease){
    check(token,lease);const ready=existing();if(ready){if(selected&&ready.installed!==selected)await install(ready,selected,token,lease);return ready;}
    const item={engine:null,context:null,controller:new AbortController(),adapter:null,player:null,closed:false,preparing:false,loadOwner:null};starting=item;emit();
    try{
      await ensureAudio();check(token,lease);item.controller.signal.throwIfAborted();const engine=getAudio(),context=engine?.context;
      if(!context||context.state==='closed'||typeof engine.getChipInputNode!=='function')throw Error('CD-DA needs the Synth AudioContext and chip input');
      item.engine=engine;item.context=context;
      const adapter=await createAudio(context,{signal:item.controller.signal,onError(reason){if(endpoint===item||starting===item){retire(item);fail(reason);}}});item.adapter=adapter;
      check(token,lease);item.controller.signal.throwIfAborted();if(getAudio()!==engine)throw abort();
      const input=engine.getChipInputNode('cdda');if(!input||input.context!==context||adapter.node?.context!==context)throw Error('CD-DA must use the Synth clock and chip input');item.output=createPceMediaOutput(context,adapter.node,input);
      item.player=createPlayer({prepare:async(...args)=>{item.preparing=true;try{return await adapter.prepare(...args);}finally{item.preparing=false;}},
        command:(...args)=>adapter.command(...args),dispose:()=>adapter.dispose()},{signal:item.controller.signal,getMix:()=>engine.getChipMix?.('cdda')});
      endpoint=item;if(starting===item)starting=null;if(selected)await install(item,selected,token,lease);check(token,lease);return item;
    }catch(reason){const current=token===operation&&(endpoint===item||starting===item)&&!item.closed;retire(item);if(current)fail(reason);throw reason;}
  }
  function snapshot(){const mix=getAudio()?.getChipMix?.('cdda');return{state:asset?'ready':'empty',positionFrames:positionFrame,positionSeconds:positionFrame/44100,frame:positionFrame,durationFrames:selected?.info.frames??0,durationSeconds:(selected?.info.frames??0)/44100,outputFrame:0,
    sampleRate:getAudio()?.context?.sampleRate??0,sourceRate:44100,volume:mix?.volume??1,pan:0,mute:mix?.effectiveMuted??mix?.muted??false,...actual,
    sourceId,revision,playbackGeneration,track:selected?.info.number??null,title:selected?.info.title??'',tracks:copyTracks(asset?.tracks??[])};}
  async function observe(item,token,lease){const state=await rpc(item,token,()=>item.player.getState(),true);check(token,lease);if(endpoint!==item||item.closed||item.engine!==getAudio())throw abort();
    positionFrame=state.positionFrames??state.frame??0;actual={...state,track:selected?.info.number??null,title:selected?.info.title??'',tracks:copyTracks(asset?.tracks??[])};emit();return snapshot();}
  async function commit(item,nextAsset,nextSelected){
    const run=async token=>{checkLoad(item);cancelRelease();playbackGeneration++;const physical=existing();if(physical){
      physical.loadOwner=item;
      try{await rpc(physical,token,()=>physical.player.stop());check(token,item.lease);checkLoad(item);retire(physical);}
      finally{physical.loadOwner=null;}
    }checkLoad(item);
      asset=nextAsset;selected=nextSelected;positionFrame=0;actual=null;revision++;error=null;pending=null;emit();return list();};
    for(;;){try{return await serial(run,item.lease);}catch(reason){if(!isAbort(reason)||item.lease||pending!==item||item.signal.aborted||dead)throw reason;}}
  }
  async function load(input,options={},lease){
    const item=beginLoad(lease,options.signal),reader=lease?.readFile??readFile;
    try{
      const origin=options.path??(typeof input==='string'&&!input.trimStart().startsWith('{')?input:null),path=origin&&lease?.resolvePath?lease.resolvePath(origin):origin,
        name=options.name??(path?.split('/').pop()||'CD-DA tracks');
      if(typeof name!=='string')throw TypeError('CD-DA source name must be a string');
      let bytes=null,manifest=input;
      if(input instanceof ArrayBuffer||input instanceof Uint8Array)bytes=input;
      else if(typeof input==='string'&&!input.trimStart().startsWith('{')){if(!reader)throw Error('CD-DA file loading requires readFile');const data=await reader(path??input,{signal:item.signal});checkLoad(item);
        if(/\.json$/i.test(input))manifest=new TextDecoder().decode(data);else bytes=data;}
      if(bytes&&/\.json$/i.test(path??'')){manifest=new TextDecoder().decode(bytes);bytes=null;}
      let next,track;
      if(bytes){const source=createCddaWavTrackSource(bytes,{title:name});track=ownTrack(await source.getTrack(1,{signal:item.signal}));next={name,path,format:'wav',tracks:copyTracks(source.tracks),source:null};}
      else{
        const tracks=parseCddaTrackManifest(manifest),normalized={tracks:tracks.map(spec=>{
          const file=relativeFile(spec.file,path);return{...spec,file:lease?.resolvePath?lease.resolvePath(file):file};
        })};
        if(!reader)throw Error('CD-DA file loading requires readFile');
        const source=createCddaTrackSource(normalized,{readFile:reader});checkLoad(item);track=ownTrack(await source.getTrack(source.tracks[0].number,{signal:item.signal}));
        next={name,path,format:'manifest',tracks:copyTracks(source.tracks),source};
      }
      checkLoad(item);if(path&&!track.info.file)track.info.file=path;
      return await commit(item,next,track);
    }catch(reason){endLoad(item,reason);throw reason;}
  }
  async function selectTrack(number,options={},lease,requiredOffset=0){
    checkLease(lease);if(!asset)throw Error('Load CD-DA tracks before selection');
    if(!Number.isInteger(number)||!asset.tracks.some(track=>track.number===number))throw RangeError('Unknown CD-DA track number');
    if(selected?.info.number===number&&!pending)return{...selected.info};
    const item=beginLoad(lease,options.signal),candidate=asset;
    try{if(!candidate.source)throw RangeError('Unknown CD-DA track number');const track=ownTrack(await candidate.source.getTrack(number,{signal:item.signal}));checkLoad(item);
      if(requiredOffset>track.info.frames)throw RangeError('CD-DA position is outside the track');
      await commit(item,candidate,track);return{...track.info};}catch(reason){endLoad(item,reason);throw reason;}
  }
  function transportTask(run,lease,token=operation){const ticket={};transport.add(ticket);emit();return serial(run,lease,token).finally(()=>{transport.delete(ticket);emit();});}
  async function play(number,options={},lease){
    checkLease(lease);const token=operation;const schedule=timing(options),offset=frame(options.offset??0);if(!asset)throw Error('Load CD-DA tracks before playback');
    const chosen=number??selected?.info.number??asset.tracks[0].number;
    if(!Number.isInteger(chosen)||!asset.tracks.some(track=>track.number===chosen))throw RangeError('Unknown CD-DA track number');
    // Select/validate a different track before touching the current transport.
    if(chosen!==selected?.info.number)await selectTrack(chosen,{},lease,offset);check(token,lease);
    if(offset>selected.info.frames)throw RangeError('CD-DA position is outside the track');
    const priorRelease=releasing;authority++;cancelPreview();cancelRelease();const playback=lastPlayback={generation:++playbackGeneration,cancelled:false};
    const checkPlayback=()=>{if(playback.cancelled)throw abort();};
    return transportTask(async token=>{checkPlayback();const item=await ensureEndpoint(token,lease);check(token,lease);checkPlayback();
      if(priorRelease?.physical===item&&schedule.at>item.context.currentTime){
        await item.output.fadeOut(.004);check(token,lease);checkPlayback();await rpc(item,token,()=>item.player.stop());check(token,lease);checkPlayback();
      }
      timing(schedule);
      await rpc(item,token,()=>item.player.play(1,{...schedule,offset:offset/44100}));check(token,lease);checkPlayback();item.output.open();error=null;return observe(item,token,lease);},lease,token);
  }
  function stopPhysical(options={},preserveOperation=false){
    options=timing(options);cancelPreview();cancelRelease();playbackGeneration++;if(!preserveOperation)operation++;const token=operation;tail=Promise.resolve();transport.clear();retire(starting);const old=existing();
    const immediate=options.at===undefined||options.at<=(getAudio()?.context?.currentTime??0);
    // An old adapter timeout disposes its whole node. Disconnect it now when
    // cancelling an immediate in-flight RPC, so that timer cannot later close
    // a newer Play that would otherwise reuse the same adapter.
    if(old&&(old.preparing||old.installing||old.loadOwner||old.retireAfterCodeFade||immediate&&old.pendingRpcs))retire(old);
    const physical=existing(),task=Promise.resolve().then(async()=>{if(physical&&!physical.closed){try{await rpc(physical,token,()=>physical.player.stop(options));}catch(reason){if(token===operation&&options.at===undefined)positionFrame=0;throw reason;}
      const state=await rpc(physical,token,()=>physical.player.getState());if(token===operation&&endpoint===physical&&!physical.closed){positionFrame=state.positionFrames??state.frame??0;actual={...state};emit();}}
      else if(token===operation){positionFrame=0;actual=null;emit();}});
    const settled=task.finally(()=>{if(stopping===settled){stopping=null;emit();}});stopping=settled;emit();return settled;
  }
  function stop(options={}){checkLease();timing(options);cancelLoad();return stopPhysical(options);}
  function stopIfPlaybackGeneration(expected,options){
    checkLease();const seconds=readMediaReleaseSeconds(options);if(!Number.isSafeInteger(expected)||expected<0)throw RangeError('Expected a playback generation');
    if(expected!==playbackGeneration)return Promise.resolve(false);
    if(lastPlayback?.generation===expected)lastPlayback.cancelled=true;
    const physical=existing();
    if(seconds&&physical&&!physical.preparing&&!physical.installing&&!((physical.pendingRpcs??0)-(physical.stateReads??0))&&actual?.state==='playing'){
      cancelPreview();cancelRelease();const controller=new AbortController(),ticket=releasing={physical,generation:++playbackGeneration,controller};
      const current=()=>!dead&&!closing&&releasing===ticket&&endpoint===physical&&!physical.closed&&playbackGeneration===ticket.generation;
      emit();
      const promise=(async()=>{
        try{await physical.output.fadeOut(seconds,{signal:controller.signal});if(!current())return false;
          physical.pendingRpcs=(physical.pendingRpcs??0)+1;
          try{await physical.player.stop();if(!current())return false;const state=await physical.player.getState();if(!current())return false;positionFrame=state.positionFrames??state.frame??0;actual={...state};emit();return true;}
          finally{physical.pendingRpcs--;}
        }catch(reason){if(isAbort(reason)||!current())return false;retire(physical);fail(reason);throw reason;}
        finally{if(releasing===ticket)releasing=null;}
      })();ticket.promise=promise;return promise;
    }
    return stopPhysical({},true).then(()=>true);
  }
  function revokeCode(){if(dead)return;codeEpoch++;for(const lease of leases)lease.closed=true;leases.clear();if(pending?.lease)cancelLoad({retireUpload:false});}
  function stopCode(){if(dead)return Promise.resolve();revokeCode();return stopPhysical();}
  async function pause(options={},lease){checkLease(lease);const schedule=timing(options),physical=existing();if(!physical||!['playing','paused'].includes(actual?.state))return snapshot();cancelPreview();cancelRelease();playbackGeneration++;return transportTask(async token=>{
    if(endpoint!==physical||!['playing','paused'].includes(actual?.state))return snapshot();
    await rpc(physical,token,()=>physical.player.pause(schedule));return observe(physical,token,lease);},lease);}
  async function resume(options={},lease){checkLease(lease);const schedule=timing(options),physical=existing();if(!physical||actual?.state!=='paused')return play(selected?.info.number,{...schedule,offset:positionFrame/44100},lease);
    cancelPreview();cancelRelease();playbackGeneration++;
    return transportTask(async token=>{await rpc(physical,token,()=>physical.player.resume(schedule));check(token,lease);physical.output.open();return observe(physical,token,lease);},lease);}
  function readySeek(seconds){checkLease();const next=frame(seconds);if(!selected)throw Error('Select a CD-DA track before seeking');if(next>selected.info.frames)throw RangeError('CD-DA position is outside the track');cancelPreview();
    positionFrame=next;if(actual&&actual.state!=='playing'&&actual.state!=='paused')actual={...actual,positionFrames:next,positionSeconds:next/44100,frame:next};emit();return snapshot();}
  async function seek(seconds,options={},lease){checkLease(lease);const next=frame(seconds),schedule=timing(options);if(!selected)throw Error('Select a CD-DA track before seeking');if(next>selected.info.frames)throw RangeError('CD-DA position is outside the track');
    const physical=existing();if(!physical||!['playing','paused','ended'].includes(actual?.state))return readySeek(next/44100);
    cancelPreview();cancelRelease();playbackGeneration++;
    return transportTask(async token=>{if(endpoint!==physical||!['playing','paused','ended'].includes(actual?.state))return readySeek(next/44100);
      await rpc(physical,token,()=>physical.player.seek(next/44100,schedule));check(token,lease);if(actual?.state==='playing')physical.output.open();return observe(physical,token,lease);},lease);}
  async function getState(lease){checkLease(lease);const physical=existing();return physical&&['playing','paused','ended'].includes(actual?.state)?serial(token=>observe(physical,token,lease),lease):snapshot();}
  // UI-only test WAV replacement; preparation never starts an AudioContext.
  // A successful live edit keeps the accepted Play generation/keyboard owner.
  async function preview(input,options={}){
    if(releasing){const old=releasing,generation=playbackGeneration,token=operation;await old.promise;options.signal?.throwIfAborted();check(token);if(playbackGeneration!==generation)throw abort();}
    checkLease();if(pending)throw abort();cancelPreview();
    const previous=asset,previousTrack=selected,generation=playbackGeneration,token=operation,controller=new AbortController();
    const item=previewing={controller},signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    const valid=()=>{checkLease();signal.throwIfAborted();if(previewing!==item||asset!==previous||selected!==previousTrack||playbackGeneration!==generation||operation!==token||pending||releasing)throw abort();};
    let physical=null,touched=false;
    try{
      const name=options.name??previous?.name??'CD-DA test wave',path=options.path??previous?.path??null;
      if(typeof name!=='string'||path!==null&&typeof path!=='string')throw TypeError('Invalid CD-DA test WAV metadata');
      const source=createCddaWavTrackSource(input,{title:name}),track=ownTrack(await source.getTrack(1,{signal}));valid();
      if(path)track.info.file=path;
      const next={name,path,format:'wav',tracks:copyTracks(source.tracks),source:null};
      return await serial(async()=>{
        valid();physical=existing();let before=null,state=null;
        if(physical){before=await rpc(physical,token,()=>physical.player.getState());valid();
          if(before.state==='playing'){await physical.output.fadeOut(.004,{signal});valid();}
          touched=true;valid();await install(physical,track,token);valid();
          if(before.state==='playing'){await rpc(physical,token,()=>physical.player.play(1,{offset:0}));valid();}
          state=await rpc(physical,token,()=>physical.player.getState());valid();
        }
        valid();asset=next;selected=track;positionFrame=state?.positionFrames??state?.frame??0;revision++;error=null;
        actual=state?{...state,track:track.info.number,title:track.info.title??'',tracks:copyTracks(next.tracks)}:null;
        if(physical&&before?.state==='playing')physical.output.open();
        previewing=null;emit();return list();
      });
    }catch(reason){
      if(touched&&physical&&endpoint===physical&&!physical.closed&&playbackGeneration===generation&&operation===token)retire(physical);
      else if(physical&&endpoint===physical&&!physical.closed&&!releasing&&playbackGeneration===generation&&operation===token&&asset===previous)physical.output.open();
      if(!isAbort(reason)&&previewing===item)fail(reason);throw reason;
    }finally{if(previewing===item)previewing=null;}
  }
  async function useCodeClient({isCurrent=()=>true,readFile:codeReader,resolvePath,onDispose=()=>{}}={}){
    if(typeof isCurrent!=='function'||typeof onDispose!=='function'||codeReader!==undefined&&typeof codeReader!=='function'||resolvePath!==undefined&&typeof resolvePath!=='function')throw TypeError('CD-DA lease requires host callbacks');
    const lease={epoch:codeEpoch,closed:false,isCurrent,readFile:codeReader,resolvePath};checkLease(lease);authority++;leases.add(lease);
    const client={id:`${sourceId}:code:${++leaseSerial}`,sourceId,chip:'cdda',load:input=>load(input,{},lease),play:(number,options)=>play(number,options,lease),
      pause:options=>pause(options,lease),resume:options=>resume(options,lease),stop:options=>{checkLease(lease);timing(options);if(pending?.lease===lease)cancelLoad();return stopPhysical(options);},
      seek:(seconds,options)=>seek(seconds,options,lease),getState:()=>getState(lease),list:()=>{checkLease(lease);return list();},
      async dispose(){checkLease(lease);lease.closed=true;leases.delete(lease);if(pending?.lease===lease)cancelLoad();await stopPhysical();onDispose();}};
    for(const key of ['id','sourceId','chip'])Object.defineProperty(client,key,{writable:false});return Object.seal(client);
  }
  return{read,list,load,preview,selectTrack,readySeek,play,pause,resume,stop,stopIfPlaybackGeneration,seek,getState,useCodeClient,revokeCode,stopCode,cancelLoad,
    subscribe(listener){if(typeof listener!=='function')throw TypeError('Expected a CD-DA source listener');listeners.add(listener);return()=>listeners.delete(listener);},
    async clear(){checkLease();const ticket=++authority;cancelLoad();try{await stopCode();}finally{if(authority===ticket){retire(starting);retire(endpoint);asset=null;selected=null;positionFrame=0;actual=null;revision++;error=null;emit();}}return authority===ticket;},
    async dispose(){if(dead||closing)return;closing=true;cancelLoad();try{await stopCode();}finally{dead=true;closing=false;retire(starting);retire(endpoint);transport.clear();listeners.clear();}},
  };
}
