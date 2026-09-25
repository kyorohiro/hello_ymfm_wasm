/** @file Browser / Worker: RF5C164 communication and compatibility facade. */
import { sampleBytes, encodeRf5c164 } from './rf5c164_pcm.js';
import { RF5C164Synth, RF5C164DirectTransport } from './rf5c164synth.js';
export { sampleBytes, encodeRf5c164 } from './rf5c164_pcm.js';
const integer=(v,max,name)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`Invalid ${name}`);return v;};
/** Port RPC shared by main and Worker; commands never require main-thread synthesis. */
export function createRf5c164Client(port,decode){
 let sequence=0,disposed=false;const pending=new Map();
 port.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};port.start?.();
 const call=(method,args=[])=>{if(disposed)return Promise.reject(new Error('RF5C164 disposed'));return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});port.postMessage({id,method,args});});};
 return {
  loadMemory(bytes,address=0){return call('loadMemory',[sampleBytes(bytes),address]);},
  async loadSample(source,{address=0,loopStart}={}){const data=encodeRf5c164(await decode(source));integer(address,65535,'address');if(address%256)throw new RangeError('Start must be 256-byte aligned');if(address+data.bytes.length>65536)throw new RangeError('Sample exceeds RAM');const loop=loopStart===undefined?address+data.frames+1:address+integer(loopStart,data.frames-1,'loopStart');await call('loadMemory',[data.bytes,address]);return {start:address,loopStart:loop,step:data.step};},
  setChannel:(ch,options)=>call('setChannel',[ch,options]),setPitch:(ch,step)=>call('setChannel',[ch,{step}]),
  keyOn:ch=>call('keyOn',[ch]),keyOff:ch=>call('keyOff',[ch]),writeRegister:(r,v)=>call('writeRegister',[r,v]),reset:()=>call('reset'),
  dispose(){if(disposed)return;port.postMessage({method:'dispose',args:[]});disposed=true;for(const p of pending.values())p.reject(new Error('RF5C164 disposed'));pending.clear();port.close();},
 };
}
/** Compatibility facade. New offline code can construct Synth + DirectTransport. */
export function createRf5c164Control(chip) {
  const synth = new RF5C164Synth({transport: new RF5C164DirectTransport(chip)});
  return {...Object.fromEntries(['loadMemory', 'writeRegister', 'setChannel', 'setPitch', 'keyOn', 'keyOff', 'reset']
    .map(name => [name, synth[name].bind(synth)])), dispose: () => chip.dispose()};
}
