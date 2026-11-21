import {SnesSynth} from './snessynth.js';
/** Plain bounded metadata copy, available in AudioWorkletGlobalScope. */
export function cloneSnesOperationData(value,seen=new Set(),depth=0){
 if(value===null||value===undefined||typeof value==='boolean'||typeof value==='string')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw TypeError('SNES metadata must be finite');return value;}
 if(typeof value!=='object'||depth>8||seen.has(value))throw TypeError('SNES metadata must be bounded acyclic data');
 const keys=Reflect.ownKeys(value);if(keys.length>513)throw RangeError('SNES metadata is too large');seen.add(value);
 try{const out=Array.isArray(value)?[]:{};for(const key of keys){if(Array.isArray(value)&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!Object.hasOwn(descriptor,'value'))throw TypeError('SNES metadata must not contain accessors');Object.defineProperty(out,key,{value:cloneSnesOperationData(descriptor.value,seen,depth+1),enumerable:true,writable:true,configurable:true});}return out;}finally{seen.delete(value);}
}
/** @typedef {ReturnType<SnesSynth['getState']> & {clock:number,registers:number[],nativeFrames:number,pendingKon:number,konFrame:number,koff:number}} SnesOperationState */
/** Capture only operation-resolution metadata, never RAM, envelopes or decoder phase. */
export function captureSnesOperationState(synth){
 const state=synth.getState(),registers=Array.from({length:128},(_,r)=>synth.core.readDsp(r));
 if(state.timeline)throw Error('Timed operations are unavailable in exclusive timeline mode');
 const signed=v=>v&128?v-256:v;
 return validateSnesOperationState({...state,clock:32000,registers,nativeFrames:synth.core.nativeFrames??0,pendingKon:synth.pendingKon,konFrame:synth.konFrame,koff:synth.koff,channels:state.channels.map((p,ch)=>{const b=ch*16;return {...p,sample:state.samples.some(s=>s.id===registers[b+4])?registers[b+4]:null,volumeLeft:signed(registers[b]),volumeRight:signed(registers[b+1]),pitch:registers[b+2]|((registers[b+3]&63)<<8),adsr1:registers[b+5],adsr2:registers[b+6],gain:registers[b+7]};})});
}
export function createSnesOperationResetState({clock=32000}={}){if(clock!==32000)throw TypeError('SNES native clock is 32000');return captureSnesOperationState(new SnesSynth({core:{registers:Array(128).fill(0),reset(){this.registers.fill(0);},loadRam(){},writeDsp(r,v){this.registers[r]=v;},readDsp(r){return this.registers[r];}}}));}
/** Detached validated state; sample records contain tuning/addresses, not bytes. */
export function validateSnesOperationState(state){
 state=cloneSnesOperationData(state);
 if(!state||state.clock!==32000||!Array.isArray(state.registers)||state.registers.length!==128||Array.from(state.registers).some(v=>!Number.isInteger(v)||v<0||v>255))throw TypeError('SNES state requires 128 DSP bytes and a 32000 Hz native clock');
 if(!Array.isArray(state.channels)||state.channels.length!==8||!Array.isArray(state.samples)||state.samples.length>256)throw TypeError('Invalid SNES voice/sample metadata');
 for(const [index,s] of state.samples.entries())if(!s||s.id!==index||!Number.isInteger(s.id)||s.id<0||s.id>255||!Number.isFinite(s.rootFrequencyHz)||s.rootFrequencyHz<=0||!Number.isInteger(s.basePitch)||s.basePitch<1||s.basePitch>16383)throw TypeError('Invalid SNES sample tuning');
 for(const p of state.channels){if(!p||p.sample!==null&&!state.samples.some(s=>s.id===p.sample))throw TypeError('Unknown SNES sample selection');for(const [k,min,max]of [['adsr1',0,255],['adsr2',0,255],['gain',0,255],['pitch',0,16383],['volumeLeft',-128,127],['volumeRight',-128,127]])if(!Number.isInteger(p[k])||p[k]<min||p[k]>max)throw TypeError('Invalid SNES voice state');}
 for(const [k,min,max]of [['nativeFrames',0,Number.MAX_SAFE_INTEGER],['pendingKon',0,255],['konFrame',-1,Number.MAX_SAFE_INTEGER],['koff',0,255],['directoryAddress',0,65535],['nextAddress',0,65536]])if(!Number.isSafeInteger(state[k])||state[k]<min||state[k]>max)throw TypeError('Invalid SNES '+k);
 if(!state.echo||typeof state.echo.reserved!=='boolean'||!Array.isArray(state.echo.fir)||state.echo.fir.length!==8)throw TypeError('Invalid SNES Echo metadata');
 for(const [key,min,max]of [['delay',0,15],['feedback',-128,127],['volumeLeft',-128,127],['volumeRight',-128,127],['sendMask',0,255]])if(!Number.isInteger(state.echo[key])||state.echo[key]<min||state.echo[key]>max)throw TypeError('Invalid SNES Echo '+key);
 if(typeof state.echo.enabled!=='boolean'||Array.from(state.echo.fir).some(v=>!Number.isInteger(v)||v< -128||v>127))throw TypeError('Invalid SNES FIR state');
 return state;
}
