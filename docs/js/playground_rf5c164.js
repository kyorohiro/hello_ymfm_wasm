import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';
/** @file Browser / Worker: RF5C164 communication and compatibility facade. */
import { sampleBytes, encodeRf5c164 } from './rf5c164_pcm.js';
import { RF5C164Synth, RF5C164DirectTransport } from './rf5c164synth.js?v=audio-stability-2';
export { sampleBytes, encodeRf5c164 } from './rf5c164_pcm.js';
const integer=(v,max,name)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`Invalid ${name}`);return v;};
/** Port RPC shared by main and Worker; commands never require main-thread synthesis. */
/** @param {MessagePort} port Ordered Worklet command/acknowledgement port.
 * @param {(source: unknown) => Promise<import('./wav.js').ChannelPCM>} decode PCM decoder for loadSample.
 * @returns RF5C164 register, memory, voice and disposal controls. */
export function createRf5c164Client(port,decode,options={}){
 let sequence=0,disposed=false;const pending=new Map();
 const resume=(context,callback)=>options.native&&options.captureContext?new Promise((resolve,reject)=>setTimeout(()=>{try{if(disposed||options.isStopped?.(context))throw new Error('Run stopped');options.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0)):Promise.resolve().then(callback);
 const scoped=(promise,context)=>options.native?promise.then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;})):promise;
 port.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};port.start?.();
 const call=(method,args=[])=>{if(disposed)return Promise.reject(new Error('RF5C164 disposed'));const context=options.captureContext?.();return scoped(new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});try{port.postMessage({id,method,args});}catch(error){pending.delete(id);reject(error);}}),context);};
 const client = {
  loadMemory(bytes,address=0){return call('loadMemory',[sampleBytes(bytes),address]);},
  /** endGuardBytes requests consecutive end markers for large pitch steps; 0 retains the legacy trailer.
   * @param {unknown} source @param {{address?: number, loopStart?: number, endGuardBytes?: number}} [options] */
  async loadSample(source,{address=0,loopStart,endGuardBytes=0}={}){
   if(disposed)throw new Error('RF5C164 disposed');
   const context=options.captureContext?.();
   integer(address,65535,'address');integer(endGuardBytes,65536,'endGuardBytes');
   if(address%256)throw new RangeError('Start must be 256-byte aligned');
   const data=encodeRf5c164(source?.channels&&source.sampleRate?source:await scoped(Promise.resolve().then(()=>decode(source)),context));
   if(disposed||options.native&&options.isStopped?.(context))throw new Error('RF5C164 disposed or Run stopped');
   if(options.native)options.restoreContext?.(context);
   let bytes=data.bytes;
   if(endGuardBytes){
    const length=data.frames+Math.max(3,endGuardBytes);
    if(address+length>65536)throw new RangeError('Sample exceeds RAM');
    bytes=new Uint8Array(length);bytes.set(data.bytes.subarray(0,data.frames));bytes.fill(255,data.frames);
   }
   if(address+bytes.length>65536)throw new RangeError('Sample exceeds RAM');
   const loop=loopStart===undefined?address+data.frames+1:address+integer(loopStart,data.frames-1,'loopStart');
   const step=Math.max(1,Math.min(65535,Math.round(data.step*CHIP_CLOCKS.rf5c164/client.clock)));
   await call('loadMemory',[bytes,address,{frames:data.frames,step,loopStart:loop,...(endGuardBytes?{endGuardBytes}:{})}]);
   return {start:address,loopStart:loop,step};
  },
  setChannel:(ch,options)=>call('setChannel',[ch,options]),setPitch:(ch,step)=>call('setChannel',[ch,{step}]),
  keyOn:ch=>call('keyOn',[ch]),keyOff:ch=>call('keyOff',[ch]),writeRegister:(r,v)=>call('writeRegister',[r,v]),reset:()=>call('reset'),
  dispose(){if(disposed)return;port.postMessage({method:'dispose',args:[]});disposed=true;for(const p of pending.values())p.reject(new Error('RF5C164 disposed'));pending.clear();port.close();},
 };
 const controlled=attachChipClock(client, port, options.clock??CHIP_CLOCKS.rf5c164);
 Object.defineProperty(client,'_adoptState',{value:state=>{if(state?.clock!==undefined)client._adoptClock(state.clock);}});
 if(options.native){const setClock=client.setClock.bind(client);client.setClock=hz=>scoped(setClock(hz),options.captureContext?.());}
 Object.defineProperty(client,'_stopVoices',{value:()=>controlled._requestControl('stopVoices')});
 return controlled;
}
/** Compatibility facade. New offline code can construct Synth + DirectTransport. */
/** @param {import('./rf5c164.js?v=audio-stability-2').Rf5c164} chip Native chip owned by the facade.
 * @returns Bound Synth controls; dispose releases the supplied chip. */
export function createRf5c164Control(chip) {
  const synth = new RF5C164Synth({transport: new RF5C164DirectTransport(chip)});
  return {...Object.fromEntries(['loadMemory', 'writeRegister', 'setChannel', 'setPitch', 'keyOn', 'keyOff', 'reset']
    .map(name => [name, synth[name].bind(synth)])), dispose: () => chip.dispose()};
}
