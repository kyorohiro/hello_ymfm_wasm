/** @typedef {import('./ym2612_operation_state.js?v=audio-stability-2').YM2612OperationState & {ssgLevels:number[],prescaler:number}} YM2608OperationState */
import {createYm2612OperationResetState,validateYm2612OperationState,observeYm2612OperationWrite,adoptYm2612OperationState} from './ym2612_operation_state.js?v=audio-stability-2';
export function createYm2608OperationResetState(){return {...createYm2612OperationResetState(),ssgLevels:[0,0,0],prescaler:6};}
export function validateYm2608OperationState(state){
 const base=validateYm2612OperationState(state);
 if(!Array.isArray(state.ssgLevels)||state.ssgLevels.length!==3||state.ssgLevels.some(v=>!Number.isInteger(v)||v<0||v>31))throw new TypeError('YM2608 state requires three retained SSG levels');
 if(state.prescaler!==6)throw new Error('YM2608 timed operations require the standard prescaler');
 return {...base,ssgLevels:[...state.ssgLevels],prescaler:6};
}
export function observeYm2608OperationWrite(state,port,register,value){
 observeYm2612OperationWrite(state,port,register,value);
 if(port===0&&register>=8&&register<=10&&value&31)state.ssgLevels[register-8]=value&31;
}
export function adoptYm2608OperationState(synth,state){
 adoptYm2612OperationState(synth,state);
 synth.ssg._adoptState({registers:state.registers[0].slice(0,16),levels:state.ssgLevels});
}
