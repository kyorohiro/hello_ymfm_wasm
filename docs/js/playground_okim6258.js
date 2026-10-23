import {attachChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Oki6258Synth, OKIM6258_CLOCK,oki6258Rate,encodeOki6258,summarizeOki6258} from './okim6258synth.js?v=native-extra-dx7-1';
import {readSamplePCM} from './adpcm_b_sample.js';

/** Main/Worker API; samples and playback commands share one ordered port. */
export function createOki6258Client(port, options = {},lifecycle={}) {
  const {clock = OKIM6258_CLOCK}=options;
  let disposed = false, sequence = 0;
  const pending = new Map();
  const check=context=>{if(disposed||options.native&&lifecycle.isStopped?.(context))throw new Error('OKIM6258 disposed or Run stopped');};
  const resume=(context,callback)=>options.native?new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0)):Promise.resolve().then(callback);
  const scoped=(promise,context)=>options.native?promise.then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;})):promise;
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    data.error ? request.reject(new Error(data.error)) : request.resolve();
  };
  port.start?.();
  const send = (method, args = []) => {
    if (disposed) throw new Error('OKIM6258 disposed');
    if(options.native&&method!=='dispose')check(lifecycle.captureContext?.());
    port.postMessage({method, args});
  };
  const synth = new Oki6258Synth({clock, transport:{
    writeRegister:(...args) => send('writeRegister', args),
    loadMemory:(bytes,metadata) => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('OKIM6258 disposed')); return; }
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      try { port.postMessage({method:'loadMemory', args:[bytes,metadata], id}); }
      catch (error) { pending.delete(id); reject(error); }
    }),
    play:options => send('play', [options]), stop:() => send('stop'), reset:() => send('reset'),
    dispose() {
      if (disposed) return;
      send('dispose'); disposed = true;
      for (const request of pending.values()) request.reject(new Error('OKIM6258 disposed'));
      pending.clear(); port.close();
    },
  }});
  const controlled=attachChipClock(synth,port,clock,{onApplied:hz=>synth._adoptHardwareClock(hz)});
  Object.defineProperty(synth,'_stopVoices',{value:()=>controlled._requestControl('stopVoices')});
  if(options.native){
    Object.defineProperty(synth,'_applyAuthorEdit',{value:patch=>{if(!patch||typeof patch!=='object'||Object.keys(patch).some(key=>!['clock','divider','pan','sample'].includes(key)))throw new TypeError('Invalid OKIM6258 author edit');synth._adoptState({...synth._getState(),...patch});}});
    const rawLoad=synth.transport.loadMemory,setClock=synth.setClock.bind(synth);
    const upload=async(bytes,metadata,context,signal)=>{
      check(context);signal?.throwIfAborted();
      await scoped(rawLoad(bytes.slice(),metadata),context);check(context);signal?.throwIfAborted();
      synth.sample={...metadata,bytes:bytes.length,frames:bytes.length*2,durationSeconds:bytes.length*2/metadata.sampleRate};
    };
    synth.loadMemory=async(input,{sampleRate}={})=>{
      const context=lifecycle.captureContext?.();check(context);
      const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
      if(!(bytes instanceof Uint8Array))throw new TypeError('OKIM6258 memory requires Uint8Array or ArrayBuffer');
      if(!bytes.length||bytes.length>0x1000000)throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
      if(sampleRate!==undefined)synth.setPlaybackRate(sampleRate);
      const copy=bytes.slice(),rate=synth.playbackRate;
      await upload(copy,{...summarizeOki6258(copy),sampleRate:rate,source:'raw'},context);
    };
    synth.loadSample=async(source,{sampleRate=synth.playbackRate,signal,decodeAudio}={})=>{
      const context=lifecycle.captureContext?.();check(context);signal?.throwIfAborted();
      const decoding=lifecycle.decodeAudio&&!source?.channels&&!source?.getChannelData&&!decodeAudio?lifecycle.decodeAudio(source):readSamplePCM(source,{signal,decodeAudio});
      const pcm=await scoped(Promise.resolve(decoding),context);check(context);signal?.throwIfAborted();
      const rate=oki6258Rate(synth.clock,sampleRate),encoded=encodeOki6258(pcm,rate.sampleRate);
      synth.setDivider(rate.divider);
      await upload(encoded.bytes,{...summarizeOki6258(encoded.bytes),sampleRate:rate.sampleRate,source:'sample'},context,signal);
      return {...encoded,bytes:encoded.bytes.length};
    };
    synth.setClock=hz=>scoped(setClock(hz),lifecycle.captureContext?.());
  }
  return controlled;
}
