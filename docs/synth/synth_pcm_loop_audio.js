import {watchAudioEndpoint} from '../js/playground_audio_endpoint.js?v=y8950-adpcm-ui-1';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';
import {prepareSynthPcmLoopUnit,normalizeSynthPcmLoopConfig,PCM_LOOP_MAX_UNITS,PCM_LOOP_MAX_PCM_BYTES} from './synth_pcm_loop_player.js?v=pcm-looper-1';

async function createDevice(context,output,{signal,onError}={}) {
  signal?.throwIfAborted();
  await context.audioWorklet.addModule(new URL('./synth_pcm_loop_worklet.js?v=pcm-looper-1',import.meta.url));
  signal?.throwIfAborted();
  const node=new AudioWorkletNode(context,'tetorica-synth-pcm-looper',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;node.port.onmessage=null;node.onprocessorerror=null;
    try{node.port.postMessage({method:'dispose'});}catch{}node.disconnect();node.port.close();};
  try {
    await new Promise((resolve,reject)=>{
      const cleanup=()=>signal?.removeEventListener('abort',abort),abort=()=>{cleanup();reject(signal.reason);};
      signal?.addEventListener('abort',abort,{once:true});
      node.port.onmessage=({data})=>{if(data.ready){cleanup();resolve();}else if(data.error){cleanup();reject(Error(data.error));}};
      node.onprocessorerror=()=>{cleanup();reject(Error('PCM Looper Worklet failed'));};
      if(signal?.aborted)abort();
    });
    signal?.throwIfAborted();node.connect(output);
    return watchAudioEndpoint({node,port:node.port,dispose},{context,label:'PCM Looper',onError});
  } catch(error) {dispose();throw error;}
}
const positive=(value,label)=>{if(!Number.isSafeInteger(value)||value<1)throw RangeError(`Invalid PCM loop ${label}`);return value;};
const checkSignal=signal=>{if(signal!==undefined&&!(signal instanceof AbortSignal))throw TypeError('PCM loop needs an AbortSignal');};
const cancelled=()=>new DOMException('PCM loop operation cancelled','AbortError');
function linkedSignals(signals) {
  const controller=new AbortController(),sources=signals.filter(Boolean),abort=event=>controller.abort(event.target.reason);
  for(const source of sources){if(source.aborted)controller.abort(source.reason);else source.addEventListener('abort',abort,{once:true});}
  return {signal:controller.signal,dispose(){for(const source of sources)source.removeEventListener('abort',abort);}};
}

/** Inert upload / ACK keeps large transfers outside the scheduled loop start. */
export function createSynthPcmLoopAudio({onError=()=>{},createDevice:create=createDevice,timeoutMs=15000}={}) {
  if(typeof onError!=='function'||typeof create!=='function')throw TypeError('PCM loop audio needs callbacks');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw RangeError('PCM loop timeout must be 1..60000 ms');
  let current=null,enabled=false,master=1,sourceVolume=SYNTH_SONG_MIX_DEFAULTS.pcm,disposed=false;
  const updateGain=owner=>{if(owner)owner.gain.gain.value=enabled&&owner.api?master*sourceVolume:0;};
  function clearRequest(owner,id,reason) {
    const request=owner.requests.get(id);if(!request)return;
    owner.requests.delete(id);clearTimeout(request.timer);request.cleanup();request.reject(reason);
  }
  function clearActive(owner) {const old=owner.active;owner.active=null;old?.signal?.removeEventListener('abort',old.abort);return old;}
  function post(owner,method,args) {if(!owner.closed&&owner.port)try{owner.port.postMessage({method,args});}catch{}}
  function stop(owner,reason=cancelled()) {
    if(!owner||owner.closed)return false;
    const active=clearActive(owner);owner.stageAbort.abort(reason);owner.stageAbort=new AbortController();owner.stageEpoch++;
    for(const meta of owner.staged.values())meta.signal?.removeEventListener('abort',meta.abort);
    owner.staged.clear();owner.stagedBytes=0;
    for(const id of [...owner.requests.keys()])clearRequest(owner,id,reason);
    post(owner,'stopLooper',[++owner.session]);return Boolean(active);
  }
  function retire(owner,reason=cancelled()) {
    if(!owner||owner.closed)return;
    owner.gain.gain.value=0;stop(owner,reason);owner.closed=true;
    if(current===owner)current=null;
    clearTimeout(owner.readyTimer);owner.abort.abort(reason);owner.cleanup?.();
    try{owner.device?.dispose();}finally{owner.gain.disconnect();}
  }
  function fail(owner,error){if(owner.closed||current!==owner)return;retire(owner,error);onError(error);}
  function request(owner,method,args,{signal,transfers=[],onAbort=()=>{}}={}) {
    signal?.throwIfAborted();if(owner.closed)return Promise.reject(owner.abort.signal.reason??cancelled());
    const id=++owner.sequence;
    return new Promise((resolve,reject)=>{
      const abort=()=>{if(!owner.requests.has(id))return;clearRequest(owner,id,signal.reason??cancelled());onAbort();};
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const timer=setTimeout(()=>fail(owner,Error(`PCM Looper ${method} transfer timed out`)),timeoutMs);timer.unref?.();
      owner.requests.set(id,{resolve,reject,timer,cleanup,session:['startLooper','addPreparedLooperUnit','removeLooperUnit'].includes(method)?args[0]:null});signal?.addEventListener('abort',abort,{once:true});
      try{owner.port.postMessage({id,method,args},transfers);}catch(error){clearRequest(owner,id,error);}
    });
  }
  function prepare(context,output) {
    if(disposed)return Promise.reject(Error('PCM loop audio is disposed'));
    if(typeof context?.createGain!=='function'||context.state==='closed'||output?.context!==context)return Promise.reject(TypeError('PCM loop output must belong to an open AudioContext'));
    if(current?.context===context&&current.output===output)return current.promise;
    retire(current);
    let gain;
    try{gain=context.createGain();gain.gain.value=0;gain.connect(output);}catch(error){gain?.disconnect();return Promise.reject(error);}
    const owner=current={context,output,gain,closed:false,pending:true,device:null,port:null,api:null,abort:new AbortController(),
      stageAbort:new AbortController(),stageEpoch:0,active:null,session:0,sequence:0,nextToken:0,requests:new Map(),tokens:new WeakMap(),staged:new Map(),stagedBytes:0};
    const creating=Promise.resolve().then(()=>{owner.abort.signal.throwIfAborted();return create(context,gain,{signal:owner.abort.signal,onError:error=>fail(owner,error)});});
    owner.promise=new Promise((resolve,reject)=>{
      const aborted=()=>reject(owner.abort.signal.reason??cancelled());owner.abort.signal.addEventListener('abort',aborted,{once:true});
      owner.readyTimer=setTimeout(()=>fail(owner,Error('PCM Looper initialization timed out')),timeoutMs);owner.readyTimer.unref?.();
      creating.then(device=>{
        clearTimeout(owner.readyTimer);owner.abort.signal.removeEventListener('abort',aborted);
        if(owner.closed||current!==owner||disposed){device.dispose();reject(owner.abort.signal.reason??cancelled());return;}
        owner.device=device;const port=owner.port=device.port??device.node?.port;
        if(typeof port?.postMessage!=='function')throw TypeError('PCM loop endpoint needs a MessagePort');
        const receive=({data})=>{const pending=owner.requests.get(data?.id);if(!pending)return;
          owner.requests.delete(data.id);clearTimeout(pending.timer);pending.cleanup();
          if(data.error)pending.reject(Error(data.error));else pending.resolve(data.value);};
        port.addEventListener('message',receive);port.start?.();owner.cleanup=()=>port.removeEventListener('message',receive);
        const ensureOpen=()=>{if(owner.closed)throw owner.abort.signal.reason??cancelled();};
        const lookup=(token,length)=>{
          const meta=token&&owner.tokens.get(token);
          if(!meta||meta.epoch!==owner.stageEpoch||meta.loopLength!==length||meta.reserved||!owner.staged.has(meta.cacheId))throw TypeError('PCM loop unit must be prepared for this endpoint and loop length');
          return meta;
        };
        const discard=meta=>{if(owner.staged.delete(meta.cacheId)){owner.stagedBytes-=meta.bytes;meta.signal?.removeEventListener('abort',meta.abort);post(owner,'discardLooperUnit',[meta.cacheId]);}};
        const api={
          async prepareLooperUnit(value,{loopLength,signal}={}) {
            ensureOpen();checkSignal(signal);const epoch=owner.stageEpoch,linked=linkedSignals([owner.abort.signal,owner.stageAbort.signal,signal]);
            let meta;
            try {
              const packet=await prepareSynthPcmLoopUnit(value,{sampleRate:context.sampleRate??48000,loopLength,signal:linked.signal});
              linked.signal.throwIfAborted();ensureOpen();if(epoch!==owner.stageEpoch)throw cancelled();
              const bytes=packet.left.byteLength+packet.right.byteLength;
              if(owner.active?.units.has(packet.id)||[...owner.staged.values()].some(entry=>entry.id===packet.id))throw Error('PCM loop unit already exists');
              if((owner.active?.units.size??0)+owner.staged.size>=PCM_LOOP_MAX_UNITS||
                (owner.active?.bytes??0)+owner.stagedBytes+bytes>PCM_LOOP_MAX_PCM_BYTES)throw RangeError('PCM loop PCM storage limit reached');
              meta={cacheId:++owner.nextToken,id:packet.id,loopLength,bytes,epoch,reserved:false};owner.staged.set(meta.cacheId,meta);owner.stagedBytes+=bytes;
              const accepted=await request(owner,'prepareLooperUnit',[meta.cacheId,{loopLength,unit:packet}],{
                signal:linked.signal,transfers:[packet.left.buffer,packet.right.buffer],onAbort:()=>discard(meta)});
              linked.signal.throwIfAborted();ensureOpen();if(epoch!==owner.stageEpoch||!accepted)throw cancelled();
              const token=Object.freeze({id:packet.id,frameCount:packet.frameCount,prefixCount:packet.prefixCount,byteLength:bytes,offsetSeconds:packet.offsetSeconds});
              owner.tokens.set(token,meta);
              // A finished inert upload still belongs to the capture/start
              // transaction until consumed, so Undo must be able to drop it.
              if(signal){meta.signal=signal;meta.abort=()=>discard(meta);signal.addEventListener('abort',meta.abort,{once:true});if(signal.aborted){discard(meta);throw signal.reason??cancelled();}}
              return token;
            } catch(error){if(meta)discard(meta);throw error;}
            finally{linked.dispose();}
          },
          async startLooper(value,{units=[],signal}={}) {
            ensureOpen();checkSignal(signal);signal?.throwIfAborted();
            const configuration=normalizeSynthPcmLoopConfig(value,{sampleRate:context.sampleRate??48000});
            if(!Array.isArray(units)||units.length>PCM_LOOP_MAX_UNITS||new Set(units).size!==units.length)throw TypeError('Invalid PCM initial loop tokens');
            const metas=units.map(token=>lookup(token,configuration.loopLength));
            if(new Set(metas.map(meta=>meta.id)).size!==metas.length)throw Error('PCM loop unit already exists');
            const bytes=metas.reduce((total,meta)=>total+meta.bytes,0);if(bytes>PCM_LOOP_MAX_PCM_BYTES)throw RangeError('PCM loop PCM storage limit reached');
            const previous=clearActive(owner);if(previous)for(const [id,pending]of owner.requests)if(pending.session===previous.session)clearRequest(owner,id,cancelled());
            const session=++owner.session,active=owner.active={session,configuration,units:new Map(metas.map(meta=>[meta.id,meta.bytes])),bytes,signal,abort:null};
            active.abort=()=>{if(owner.active===active)stop(owner);};signal?.addEventListener('abort',active.abort,{once:true});
            for(const meta of metas)meta.reserved=true;
            try {
              const accepted=await request(owner,'startLooper',[session,configuration,metas.map(meta=>meta.cacheId)],{signal,onAbort:active.abort});
              if(owner.active!==active||!accepted)throw cancelled();
              for(let index=0;index<metas.length;index++){const meta=metas[index];owner.staged.delete(meta.cacheId);owner.stagedBytes-=meta.bytes;meta.signal?.removeEventListener('abort',meta.abort);owner.tokens.delete(units[index]);}
              return session;
            }catch(error){if(owner.active===active)stop(owner,error);throw error;}
          },
          async addPreparedLooperUnit(session,token,{signal}={}) {
            positive(session,'session');ensureOpen();checkSignal(signal);signal?.throwIfAborted();
            const active=owner.active;if(active?.session!==session)return false;
            const meta=lookup(token,active.configuration.loopLength);
            if(active.units.has(meta.id))throw Error('PCM loop unit already exists');
            if(active.units.size>=PCM_LOOP_MAX_UNITS||active.bytes+meta.bytes>PCM_LOOP_MAX_PCM_BYTES)throw RangeError('PCM loop PCM storage limit reached');
            meta.reserved=true;
            try {
              const accepted=await request(owner,'addPreparedLooperUnit',[session,meta.cacheId],{signal,onAbort:()=>{
                if(owner.active===active)post(owner,'removeLooperUnit',[session,meta.id]);discard(meta);
              }});
              if(owner.active!==active||!accepted)throw cancelled();
              owner.staged.delete(meta.cacheId);owner.stagedBytes-=meta.bytes;meta.signal?.removeEventListener('abort',meta.abort);owner.tokens.delete(token);active.units.set(meta.id,meta.bytes);active.bytes+=meta.bytes;return true;
            }catch(error){if(owner.active===active)post(owner,'removeLooperUnit',[session,meta.id]);discard(meta);throw error;}
          },
          async removeLooperUnit(session,id,{signal}={}) {
            positive(session,'session');ensureOpen();checkSignal(signal);signal?.throwIfAborted();
            if(typeof id!=='string')throw TypeError('PCM loop unit id must be a string');
            const active=owner.active;if(active?.session!==session||!active.units.has(id))return false;
            const accepted=await request(owner,'removeLooperUnit',[session,id]);
            if(owner.active!==active)return false;
            if(accepted){active.bytes-=active.units.get(id);active.units.delete(id);}return Boolean(accepted);
          },
          stopLooperPlayback:()=>stop(owner),isLooperPlaybackActive:()=>Boolean(owner.active),
        };
        owner.api=api;owner.pending=false;updateGain(owner);resolve(api);
      }).catch(error=>{clearTimeout(owner.readyTimer);owner.abort.signal.removeEventListener('abort',aborted);fail(owner,error);reject(error);});
    });
    return owner.promise;
  }
  return {getPcm:()=>current?.api??null,isPreparing:()=>Boolean(current?.pending),prepare,
    setEnabled(value){if(typeof value!=='boolean')throw TypeError('PCM loop enabled must be a boolean');if(!value){if(current)current.gain.gain.value=0;stop(current);}enabled=value;updateGain(current);},
    setVolume(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw RangeError('PCM loop Master must be 0..3.8');master=value;updateGain(current);},
    setSourceVolume(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw RangeError('PCM loop source volume must be 0..3.8');sourceVolume=value;updateGain(current);},
    dispose(){if(disposed)return;disposed=true;enabled=false;retire(current);},
  };
}
