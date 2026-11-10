import {watchAudioEndpoint} from '../js/playground_audio_endpoint.js?v=y8950-adpcm-ui-1';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';
import {prepareSynthPcmRecording} from './synth_pcm_recording_prepare.js?v=pcm-live-end-1';

async function createDevice(context,output,{signal,onError}={}) {
  signal?.throwIfAborted();
  const [response]=await Promise.all([
    fetch(new URL('../generated/rf5c164_wasm.wasm',import.meta.url),{signal}),
    context.audioWorklet.addModule(new URL('./synth_pcm_recording_worklet.js?v=pcm-release-1',import.meta.url)),
  ]);
  if(!response.ok)throw Error(`PCM Event Rec WASM HTTP ${response.status}`);
  const wasmBinary=await response.arrayBuffer();signal?.throwIfAborted();
  const node=new AudioWorkletNode(context,'tetorica-synth-pcm-recording',{
    numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary},
  });
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    node.port.onmessage=null;node.onprocessorerror=null;
    try{node.port.postMessage({method:'dispose'});}catch{}
    node.disconnect();node.port.close();
  };
  try {
    await new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason);
      signal?.addEventListener('abort',abort,{once:true});
      node.port.onmessage=({data})=>{
        if(data.ready){signal?.removeEventListener('abort',abort);resolve();}
        else if(data.error){signal?.removeEventListener('abort',abort);reject(Error(data.error));}
      };
      node.onprocessorerror=()=>{signal?.removeEventListener('abort',abort);reject(Error('PCM Event Rec Worklet failed'));};
      if(signal?.aborted)abort();
    });
    signal?.throwIfAborted();node.connect(output);
    return watchAudioEndpoint({node,port:node.port,dispose},{context,label:'PCM Event Rec',onError});
  } catch(error) {dispose();throw error;}
}

/** A dedicated sample-clock player on the host-owned AudioContext. */
export function createSynthPcmRecordingAudio({onError=()=>{},createDevice:create=createDevice,timeoutMs=15000}={}) {
  if(typeof onError!=='function'||typeof create!=='function')throw new TypeError('PCM recording audio callbacks must be functions');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new RangeError('PCM recording audio timeout must be 1..60000 ms');
  let current=null,enabled=false,master=1,sourceVolume=SYNTH_SONG_MIX_DEFAULTS.pcm,disposed=false;
  const cancelled=()=>new DOMException('PCM event playback cancelled','AbortError');
  const gain=owner=>{if(owner)owner.gain.gain.value=enabled&&owner.api?master*sourceVolume:0;};
  function clearRequest(owner,id,reason) {
    const request=owner.requests.get(id);if(!request)return;
    owner.requests.delete(id);clearTimeout(request.timer);request.reject(reason);
  }
  function clearActive(owner) {
    const active=owner.active;owner.active=null;
    active?.signal?.removeEventListener('abort',active.abort);
    return active;
  }
  function stopPlayback(owner,reason=cancelled()) {
    if(!owner||owner.closed)return false;
    const active=clearActive(owner);
    if(active?.id)clearRequest(owner,active.id,reason);
    const session=++owner.session;
    try{owner.port.postMessage({method:'stopRecording',args:[session]});}catch{}
    return Boolean(active);
  }
  function retire(owner,reason=cancelled()) {
    if(!owner||owner.closed)return;
    owner.gain.gain.value=0;stopPlayback(owner,reason);owner.closed=true;
    if(current===owner)current=null;
    clearTimeout(owner.readyTimer);owner.abort.abort(reason);clearActive(owner);
    for(const id of [...owner.requests.keys()])clearRequest(owner,id,reason);
    owner.cleanup?.();
    try{owner.device?.dispose();}finally{owner.gain.disconnect();}
  }
  function fail(owner,error) {if(current!==owner||owner.closed)return;retire(owner,error);onError(error);}
  function prepare(context,output) {
    if(disposed)return Promise.reject(Error('PCM recording audio is disposed'));
    if(typeof context?.createGain!=='function'||context.state==='closed'||output?.context!==context) {
      return Promise.reject(new TypeError('PCM recording output must belong to an open AudioContext'));
    }
    if(current?.context===context&&current.output===output)return current.promise;
    retire(current);
    let outputGain;
    try{outputGain=context.createGain();outputGain.gain.value=0;outputGain.connect(output);}
    catch(error){outputGain?.disconnect();return Promise.reject(error);}
    const owner=current={context,output,gain:outputGain,abort:new AbortController(),device:null,port:null,api:null,
      pending:true,closed:false,session:0,sequence:0,active:null,requests:new Map()};
    const creating=Promise.resolve().then(()=>{
      owner.abort.signal.throwIfAborted();return create(context,outputGain,{signal:owner.abort.signal,onError:error=>fail(owner,error)});
    });
    owner.promise=new Promise((resolve,reject)=>{
      const aborted=()=>reject(owner.abort.signal.reason??cancelled());
      owner.abort.signal.addEventListener('abort',aborted,{once:true});
      owner.readyTimer=setTimeout(()=>fail(owner,Error('PCM Event Rec initialization timed out')),timeoutMs);owner.readyTimer.unref?.();
      creating.then(device=>{
        clearTimeout(owner.readyTimer);owner.abort.signal.removeEventListener('abort',aborted);
        if(owner.closed||current!==owner||disposed){device.dispose();reject(owner.abort.signal.reason??cancelled());return;}
        owner.device=device;owner.port=device.port??device.node?.port;
        const port=owner.port;if(typeof port?.postMessage!=='function')throw TypeError('PCM recording endpoint needs a MessagePort');
        const receive=({data})=>{
          if(owner.closed)return;
          if(data?.type==='pcm-recording-ended') {
            if(owner.active?.session!==data.session)return;
            const active=clearActive(owner);active.onEnded?.();return;
          }
          const request=owner.requests.get(data?.id);if(!request)return;
          owner.requests.delete(data.id);clearTimeout(request.timer);
          if(data.error)request.reject(Error(data.error));else request.resolve(data.value);
        };
        port.addEventListener('message',receive);port.start?.();owner.cleanup=()=>port.removeEventListener('message',receive);
        const api={
          async playRecording(recording,options={}) {
            if(owner.closed)throw owner.abort.signal.reason??cancelled();
            for(const field of ['loop','ignorePatch'])if(options[field]!==undefined&&typeof options[field]!=='boolean')throw TypeError(`PCM ${field} must be a boolean`);
            if(options.onEnded!==undefined&&typeof options.onEnded!=='function')throw TypeError('PCM completion callback must be a function');
            const signal=options.signal;
            if(signal!==undefined&&(!(signal instanceof AbortSignal)))throw TypeError('PCM playback signal must be AbortSignal');
            signal?.throwIfAborted();
            const compiled=prepareSynthPcmRecording(recording,{sampleRate:context.sampleRate??48000,
              ignorePatch:options.ignorePatch??false,preset:options.preset,pitchClock:options.pitchClock});
            signal?.throwIfAborted();if(owner.closed)throw owner.abort.signal.reason??cancelled();
            const previous=clearActive(owner);if(previous?.id)clearRequest(owner,previous.id,cancelled());
            const session=++owner.session,id=++owner.sequence;
            const active=owner.active={session,id,signal,onEnded:options.onEnded,abort:null};
            active.abort=()=>{if(owner.active===active)stopPlayback(owner);};
            signal?.addEventListener('abort',active.abort,{once:true});
            try {
              const accepted=await new Promise((yes,no)=>{
                const timer=setTimeout(()=>fail(owner,Error('PCM Event Rec playback transfer timed out')),timeoutMs);timer.unref?.();
                owner.requests.set(id,{resolve:yes,reject:no,timer});
                try{port.postMessage({id,method:'playRecording',args:[session,compiled,{loop:options.loop??false}]},compiled.banks.map(bank=>bank.buffer));}
                catch(error){clearTimeout(timer);owner.requests.delete(id);no(error);}
              });
              if(owner.closed||owner.active!==active||signal?.aborted)throw cancelled();
              if(!accepted)throw Error('PCM event playback was superseded');
              return session;
            } catch(error) {if(owner.active===active)stopPlayback(owner,error);throw error;}
          },
          stopRecordingPlayback:()=>stopPlayback(owner),
          isRecordingPlaybackActive:()=>Boolean(owner.active),
        };
        owner.api=api;owner.pending=false;gain(owner);resolve(api);
      }).catch(error=>{
        clearTimeout(owner.readyTimer);owner.abort.signal.removeEventListener('abort',aborted);fail(owner,error);reject(error);
      });
    });
    return owner.promise;
  }
  return {
    getPcm:()=>current?.api??null,isPreparing:()=>Boolean(current?.pending),prepare,
    setEnabled(value){
      if(typeof value!=='boolean')throw TypeError('PCM recording enabled must be a boolean');
      if(value!==enabled||!value){if(current)current.gain.gain.value=0;stopPlayback(current);}
      enabled=value;gain(current);
    },
    setVolume(value){
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw RangeError('PCM recording Master must be 0..3.8');
      master=value;gain(current);
    },
    setSourceVolume(value){
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw RangeError('PCM recording source volume must be 0..3.8');
      sourceVolume=value;gain(current);
    },
    dispose(){if(disposed)return;disposed=true;enabled=false;retire(current);},
  };
}
