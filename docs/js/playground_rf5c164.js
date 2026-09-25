/** @file Browser / Worker: RF5C164 controls. No DOM; transport and decoding are injected. */
const integer=(v,max,name)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`Invalid ${name}`);return v;};
export function sampleBytes(value){if(value instanceof ArrayBuffer)return new Uint8Array(value);if(value instanceof Uint8Array)return value;throw new TypeError('Expected Uint8Array or ArrayBuffer');}
/** Convert decoded mono/stereo PCM to sign-magnitude RAM bytes, with a loop marker. */
export function encodeRf5c164({channels,sampleRate}){
 if(!channels?.length||!channels[0].length||!Number.isFinite(sampleRate)||sampleRate<=0)throw new Error('Invalid PCM');
 const n=channels[0].length;if(n+3>65536)throw new RangeError('Sample exceeds 64 KiB; shorten or resample it first');
 if(channels.some(c=>c.length!==n))throw new Error('PCM channel lengths differ');
 const bytes=new Uint8Array(n+3);
 for(let i=0;i<n;i++){let v=0;for(const c of channels){if(!Number.isFinite(c[i]))throw new Error('Nonfinite PCM');v+=c[i]/channels.length;}const m=Math.min(126,Math.round(Math.abs(v)*126));bytes[i]=m|(v>=0?128:0);}
 bytes[n]=255;bytes[n+1]=128;bytes[n+2]=255;
 const step=Math.round(sampleRate*384/12500000*2048);integer(step,65535,'sample step');if(!step)throw new RangeError('Sample rate too low');
 return {bytes,step,frames:n};
}
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
/** Stateful register helper; reset retains RAM, keyOn always retriggers. */
export function createRf5c164Control(chip){
 let mask=255;const write=(r,v)=>{integer(r,8,'register');integer(v,255,'value');chip.writeRegister(r,v);if(r===8)mask=v;};
 const select=ch=>write(7,0xc0|integer(ch,7,'channel'));
 return {
 loadMemory:(b,a=0)=>chip.loadMemory(sampleBytes(b),a),writeRegister:write,
 setChannel(ch,o){integer(ch,7,'channel');const entries=[];
 const add=(r,v,max,name)=>{integer(v,max,name);entries.push([r,v&255]);if(max>255)entries.push([r+1,v>>8]);};
 if(o.start!==undefined){integer(o.start,65535,'start');if(o.start%256)throw new RangeError('Start must be 256-byte aligned');add(6,o.start/256,255,'start');}
 if(o.loopStart!==undefined)add(4,o.loopStart,65535,'loopStart');if(o.step!==undefined)add(2,o.step,65535,'step');if(o.volume!==undefined)add(0,o.volume,255,'volume');
 if(o.pan!==undefined){integer(o.pan.left,15,'left');integer(o.pan.right,15,'right');add(1,o.pan.left|(o.pan.right<<4),255,'pan');}
 select(ch);for(const [r,v] of entries)write(r,v);},
 keyOn(ch){select(ch);write(8,mask|(1<<ch));write(8,mask&~(1<<ch));},keyOff(ch){integer(ch,7,'channel');write(8,mask|(1<<ch));},
 reset(){chip.reset();mask=255;write(8,255);},dispose(){chip.dispose();},
 };
}
