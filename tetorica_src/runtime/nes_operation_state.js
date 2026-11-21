import {validateNesApuClock,NES_APU_CLOCK} from './nesapu.js';
/** @typedef {{clock:number,registers:number[],enabled:number,fdsActive:boolean,fdsGain:number,fdsMaster:number,sample:{address:number,length:number}|null}} NesOperationState */
/** Hardware reset baseline, not Synth voice defaults. @returns {NesOperationState} */
export function createNesOperationResetState({clock=NES_APU_CLOCK}={}){validateNesApuClock(clock);return {clock,registers:Array(144).fill(0),enabled:0,fdsActive:false,fdsGain:32,fdsMaster:0,sample:null};}
/** Only register/config state is used; no phases, length counters or PCM RAM. @returns {NesOperationState} */
export function validateNesOperationState(state){
 if(!state||!Array.isArray(state.registers)||state.registers.length!==144||state.registers.some(v=>!Number.isInteger(v)||v<0||v>255))throw TypeError('NES state requires 144 complete register bytes');
 validateNesApuClock(state.clock);
 if(state.fdsActive!==undefined&&typeof state.fdsActive!=='boolean'||state.fdsGain!==undefined&&(!Number.isInteger(state.fdsGain)||state.fdsGain<0||state.fdsGain>32)||state.fdsMaster!==undefined&&(!Number.isInteger(state.fdsMaster)||state.fdsMaster<0||state.fdsMaster>3))throw TypeError('Invalid NES FDS metadata');
 const enabled=state.enabled??state.registers[0x15]&31;
 if(!Number.isInteger(enabled)||enabled<0||enabled>31)throw TypeError('NES enable shadow is inconsistent');
 const sample=state.sample??null;
 if(sample!==null&&(!sample||typeof sample!=='object'||Array.isArray(sample)||Reflect.ownKeys(sample).length!==2||!['address','length'].every(k=>{const d=Object.getOwnPropertyDescriptor(sample,k);return d&&Object.hasOwn(d,'value');})||!Number.isInteger(sample.address)||sample.address<0xc000||sample.address%64||!Number.isInteger(sample.length)||sample.length<1||sample.length>4081||(sample.length-1)%16||sample.address+sample.length>65536))throw TypeError('Invalid NES prepared DMC selection');
 const registers=[...state.registers];
 return {clock:state.clock,registers,enabled,fdsActive:!!state.fdsActive,fdsGain:state.fdsGain??32,fdsMaster:state.fdsMaster??0,sample:sample&&{address:sample.address,length:sample.length}};
}
