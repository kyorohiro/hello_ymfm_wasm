// SPDX-License-Identifier: BSD-3-Clause
import {PERFORMANCE_PATTERN_LIMITS} from '../js/playground_performance_queue.js';
import * as validation from '../js/register_plan_validation.js';
import {validRegister,integer} from './chip.js';
import {createInstrument} from './instrument.js';

const limit=PERFORMANCE_PATTERN_LIMITS.maxPatternEntries;
function validateWrite(register,value){
  validRegister(register);integer(value,0,255,'register byte');
}
function validateOperations(plan){
  validation.validateTimedFields(plan,['chip','version','referenceSampleRate','writes'],'FM21290 plan');
  if(plan.chip!=='fm21290'||plan.version!==1||!Array.isArray(plan.writes)||plan.writes.length>limit)
    throw Error('Invalid FM21290 register plan');
  const rate=validation.referenceSampleRate(plan.referenceSampleRate);
  let last=0;
  const writes=Array.from(plan.writes,row=>{
    validation.validateTimedFields(row,['offsetSeconds','register','value'],'FM21290 write');
    const {offsetSeconds,register,value}=row;
    if(!validation.validOffset(offsetSeconds)||offsetSeconds<last)throw RangeError('Invalid FM21290 write offset');
    validateWrite(register,value);last=offsetSeconds;
    return {offsetSeconds,register,value};
  });
  return {chip:'fm21290',version:1,referenceSampleRate:rate,writes};
}
export const timedFormat={...validation,validateOperations};
export function buildOperations(preset,callback,options={}){
  validation.validateTimedFields(options,['referenceSampleRate'],'FM21290 build options');
  const rate=validation.referenceSampleRate(options.referenceSampleRate??48000);
  const writes=[];
  let offsetSeconds=0,active=true;
  function check(){if(!active)throw Error('FM21290 recorder has closed');}
  function write(register,value){
    check();validateWrite(register,value);
    if(writes.length>=limit)throw RangeError('FM21290 plan is full');
    writes.push({offsetSeconds,register,value});
  }
  const instrument=createInstrument(write);
  instrument.setPatch(preset);writes.length=0;
  const builder={
    atSeconds(seconds){
      check();if(!validation.validOffset(seconds)||seconds<offsetSeconds)throw RangeError('Expected nondecreasing seconds');
      offsetSeconds=seconds;return builder;
    },
    atSample(frame){if(!Number.isSafeInteger(frame)||frame<0)throw RangeError('Invalid sample offset');return builder.atSeconds(frame/rate);},
    writeRegister(register,value){write(register,value);return builder;},
    keyOn(ch,note,velocity=100){check();instrument.keyOn(ch,note,velocity);return builder;},
    keyOff(ch){check();instrument.keyOff(ch);return builder;},
  };
  try{
    const result=callback(builder);
    if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw TypeError('build callback must be synchronous');}
    return {chip:'fm21290',version:1,referenceSampleRate:rate,writes};
  }finally{active=false;}
}
