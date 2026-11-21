/** @typedef {import('./ym2612_operation_state.js').YM2612OperationState & {ssgLevels:number[],rhythmLevels:number[],adpcmRegisters:number[],prescaler:number}} YM2608OperationState */
import {createYm2612OperationResetState,validateYm2612OperationState,observeYm2612OperationWrite,adoptYm2612OperationState} from './ym2612_operation_state.js';
export function createYm2608OperationResetState(){
 const state={...createYm2612OperationResetState(),ssgLevels:[0,0,0],rhythmLevels:Array(6).fill(0xdf),adpcmRegisters:Array(16).fill(0),prescaler:6};
 // ymfm ADPCM-A reset enables both pans and maximum instrument level.
 state.adpcmRegisters[12]=state.adpcmRegisters[13]=255;
 state.registers[1][12]=state.registers[1][13]=255;
 state.registers[0].fill(0xdf,0x18,0x1e);return state;
}
export function validateYm2608OperationState(state){
 const base=validateYm2612OperationState(state);
 if(!Array.isArray(state.ssgLevels)||state.ssgLevels.length!==3||state.ssgLevels.some(v=>!Number.isInteger(v)||v<0||v>31))throw new TypeError('YM2608 state requires three retained SSG levels');
 if(state.prescaler!==6)throw new Error('YM2608 timed operations require the standard prescaler');
 const rhythmLevels=state.rhythmLevels===undefined?base.registers[0].slice(0x18,0x1e):state.rhythmLevels;
 if(!Array.isArray(rhythmLevels)||rhythmLevels.length!==6||rhythmLevels.some(v=>!Number.isInteger(v)||v<0||v>255))throw new TypeError('YM2608 state requires six Rhythm pan/level bytes');
 const adpcmRegisters=state.adpcmRegisters===undefined?base.registers[1].slice(0,16):state.adpcmRegisters;
 if(!Array.isArray(adpcmRegisters)||adpcmRegisters.length!==16||adpcmRegisters.some(v=>!Number.isInteger(v)||v<0||v>255))throw new TypeError('YM2608 state requires sixteen ADPCM-B register bytes');
 return {...base,adpcmRegisters:[...adpcmRegisters],ssgLevels:[...state.ssgLevels],rhythmLevels:[...rhythmLevels],prescaler:6};
}
export function observeYm2608OperationWrite(state,port,register,value){
 observeYm2612OperationWrite(state,port,register,value);
 if(port===1&&register<16)state.adpcmRegisters[register]=value;
 if(port===0&&register>=0x18&&register<=0x1d)state.rhythmLevels[register-0x18]=value;
 if(port===0&&register>=8&&register<=10&&value&31)state.ssgLevels[register-8]=value&31;
}
export function adoptYm2608OperationState(synth,state){
 adoptYm2612OperationState(synth,state);
 synth.adpcm.registers.set(state.adpcmRegisters);
 synth.rhythm.levels.set(state.rhythmLevels);
 synth.ssg._adoptState({registers:state.registers[0].slice(0,16),levels:state.ssgLevels});
}
