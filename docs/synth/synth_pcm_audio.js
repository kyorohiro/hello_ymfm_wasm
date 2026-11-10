import {createRf5c164Audio} from '../js/playground_rf5c164_audio.js';
import {RF5C164Synth} from '../js/rf5c164synth.js?v=audio-stability-2';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';

/** A lazy RF5C164 on the host's AudioContext. This owns no context or sample bank. */
export function createSynthPcmAudio({onError=()=>{},createDevice=createRf5c164Audio,timeoutMs=15000}={}) {
  if(typeof onError!=='function'||typeof createDevice!=='function')throw new TypeError('PCM audio callbacks must be functions');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new RangeError('PCM audio timeout must be in range 1..60000 ms');
  let current=null,enabled=false,master=1,disposed=false;
  const cancelled=()=>new DOMException('PCM audio preparation cancelled','AbortError');
  const updateGain=owner=>{if(owner)owner.gain.gain.value=enabled&&owner.api?master*SYNTH_SONG_MIX_DEFAULTS.pcm:0;};
  function retire(owner,reason=cancelled()) {
    if(!owner||owner.closed)return;
    owner.closed=true;
    if(current===owner)current=null;
    owner.gain.gain.value=0;
    clearTimeout(owner.readyTimer);
    // Mask the hardware even when it is only the output route that changes.
    try {owner.port?.postMessage({method:'writeRegister',args:[8,255]});} catch {}
    owner.abort.abort(reason);
    for(const pending of owner.requests.values()) {clearTimeout(pending.timer);pending.reject(reason);}
    owner.requests.clear();
    owner.cleanupPort?.();
    try {owner.device?.dispose();} finally {owner.gain.disconnect();}
  }
  function fail(owner,error) {
    if(current!==owner||owner.closed)return;
    retire(owner,error);onError(error);
  }
  function prepare(context,output) {
    if(disposed)return Promise.reject(new Error('PCM audio is disposed'));
    if(typeof context?.createGain!=='function'||context.state==='closed'||output?.context!==context) {
      return Promise.reject(new TypeError('PCM output must belong to an open AudioContext'));
    }
    if(current?.context===context&&current.output===output)return current.promise;
    retire(current);
    let gain;
    try {gain=context.createGain();gain.gain.value=0;gain.connect(output);}
    catch(error) {gain?.disconnect();return Promise.reject(error);}
    const owner=current={context,output,gain,abort:new AbortController(),device:null,port:null,api:null,closed:false,pending:true,requests:new Map(),sequence:0};
    const creating=Promise.resolve().then(()=>{
      owner.abort.signal.throwIfAborted();
      return createDevice(context,gain,{signal:owner.abort.signal,onError:error=>fail(owner,error)});
    });
    owner.promise=new Promise((resolve,reject)=>{
      const aborted=()=>reject(owner.abort.signal.reason??cancelled());
      owner.abort.signal.addEventListener('abort',aborted,{once:true});
      owner.readyTimer=setTimeout(()=>fail(owner,new Error('RF5C164 audio initialization timed out')),timeoutMs);
      owner.readyTimer.unref?.();
      creating.then(device=>{
        clearTimeout(owner.readyTimer);
        owner.abort.signal.removeEventListener('abort',aborted);
        if(owner.closed||current!==owner||disposed) {device.dispose();reject(owner.abort.signal.reason??cancelled());return;}
        owner.device=device;
        const port=owner.port=device.port??device.node?.port;
        if(typeof port?.postMessage!=='function')throw new TypeError('PCM endpoint needs an ordered MessagePort');
        const post=(method,args=[])=>{if(!owner.closed)port.postMessage({method,args});};
        const receive=({data})=>{
          const pending=owner.requests.get(data?.id);
          if(!pending)return;
          owner.requests.delete(data.id);clearTimeout(pending.timer);
          if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.value);
        };
        if(typeof port.addEventListener==='function') {
          port.addEventListener('message',receive);
          owner.cleanupPort=()=>port.removeEventListener('message',receive);
        } else {
          const previous=port.onmessage;
          const listener=event=>{receive(event);previous?.call(port,event);};
          port.onmessage=listener;
          owner.cleanupPort=()=>{if(port.onmessage===listener)port.onmessage=previous??null;};
        }
        port.start?.();
        const loadMemory=(bytes,address)=>{
          if(owner.closed)return Promise.reject(owner.abort.signal.reason??cancelled());
          // A detached copy fixes the bytes associated with this FIFO request;
          // later editing of the author's bank cannot change an in-flight load.
          const copy=bytes.slice(),id=++owner.sequence;
          return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>fail(owner,new Error('RF5C164 memory transfer timed out')),timeoutMs);
            timer.unref?.();owner.requests.set(id,{resolve,reject,timer});
            try {port.postMessage({id,method:'loadMemory',args:[copy,address]});}
            catch(error) {clearTimeout(timer);owner.requests.delete(id);reject(error);}
          });
        };
        const api=new RF5C164Synth({transport:{write:(register,value)=>post('writeRegister',[register,value]),loadMemory,reset:()=>post('reset')}});
        api.allNotesOff=()=>api.writeRegister(8,255);
        api.allNotesOff();
        owner.api=api;owner.pending=false;updateGain(owner);resolve(api);
      }).catch(error=>{
        clearTimeout(owner.readyTimer);
        owner.abort.signal.removeEventListener('abort',aborted);
        fail(owner,error);reject(error);
      });
    });
    return owner.promise;
  }
  return {
    getPcm:()=>current?.api??null,
    isPreparing:()=>Boolean(current?.pending),
    prepare,
    setVolume(value) {
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw new RangeError('PCM Master must be 0..3.8');
      master=value;updateGain(current);
    },
    setEnabled(value) {
      if(typeof value!=='boolean')throw new TypeError('PCM enabled must be a boolean');
      if(value!==enabled||!value) {
        if(current)current.gain.gain.value=0;
        current?.api?.allNotesOff();
      }
      enabled=value;updateGain(current);
    },
    dispose() {if(disposed)return;disposed=true;enabled=false;retire(current);},
  };
}
