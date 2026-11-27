// SPDX-License-Identifier: BSD-3-Clause
import * as validation from '../js/register_plan_validation.js';
import {PERFORMANCE_PATTERN_LIMITS} from '../js/playground_performance_queue.js';
import {createYm2151RegisterClient} from '../js/playground_ym2151.js';

function integer(value,max,label){
  if(!Number.isInteger(value)||value<0||value>max)throw RangeError(label+' is out of range');
  return value;
}
export function planTools(chip){
  const fm=chip==='ym2151', limit=PERFORMANCE_PATTERN_LIMITS.maxPatternEntries;
  function validateOperations(plan){
    validation.validateTimedFields(plan,['chip','version','writes','referenceSampleRate'],'CPS1 plan');
    if(plan.chip!==chip||plan.version!==1)throw TypeError('Incorrect chip or plan version');
    const rate=validation.referenceSampleRate(plan.referenceSampleRate);
    if(!Array.isArray(plan.writes)||plan.writes.length>limit)throw RangeError('Invalid plan length');
    let last=0;
    const writes=Array.from(plan.writes,row=>{
      validation.validateTimedFields(row,['offsetSeconds','register','value'],'chip write');
      const {offsetSeconds,register,value}=row;
      if(!validation.validOffset(offsetSeconds)||offsetSeconds<last)throw RangeError('Offsets must increase');
      last=offsetSeconds;
      return {offsetSeconds,register:integer(register,fm?255:0,'Register'),value:integer(value,255,'Byte')};
    });
    return {chip,version:1,referenceSampleRate:rate,writes};
  }
  function buildOperations(record,options={}){
    validation.validateTimedFields(options,['referenceSampleRate'],'build options');
    const rate=validation.referenceSampleRate(options.referenceSampleRate??48000);
    const writes=[];
    let offsetSeconds=0,active=true;
    function write(register,value){
      if(!active||writes.length>=limit)throw RangeError('Recorder closed or plan full');
      writes.push({offsetSeconds,register,value});
    }
    const opm=createYm2151RegisterClient((_method,args)=>write(...args));
    const builder={
      atSeconds(t){
        if(!active||!validation.validOffset(t)||t<offsetSeconds)throw RangeError('Invalid time offset');
        offsetSeconds=t;return builder;
      },
      atSample(n){return builder.atSeconds(integer(n,Number.MAX_SAFE_INTEGER,'Sample offset')/rate);},
    };
    if(fm){
      for(const method of ['writeRegister','setPitch','setFrequency','setNote','noteOn','keyOn','keyOff','setNoise'])
        builder[method]=(...args)=>{opm[method](...args);return builder;};
    }else{
      builder.write=byte=>{write(0,integer(byte,255,'Command'));return builder;};
      builder.play=(voice,sample,level=2)=>{
        integer(voice,3,'Voice');integer(sample,127,'Sample');integer(level,15,'Attenuation');
        return builder.write(128|sample).write((16<<voice)|level);
      };
      builder.stop=voice=>builder.write(8<<integer(voice,3,'Voice'));
    }
    try{
      const result=record(builder);
      if(result?.then){Promise.resolve(result).catch(()=>{});throw TypeError('Use a synchronous build callback');}
      return validateOperations({chip,version:1,referenceSampleRate:rate,writes});
    }finally{active=false;}
  }
  return {...validation,validateOperations,buildOperations};
}
