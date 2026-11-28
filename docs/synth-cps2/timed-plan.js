// SPDX-License-Identifier: BSD-3-Clause
import * as validation from '../js/register_plan_validation.js';
import {PERFORMANCE_PATTERN_LIMITS} from '../js/playground_performance_queue.js';
import {noteWrites} from './demo.js';

const limit=PERFORMANCE_PATTERN_LIMITS.maxPatternEntries;
function number(n,min,max,label){
  if(!Number.isSafeInteger(n)||n<min||n>max)throw RangeError('Invalid '+label);
  return n;
}
export function qsoundPlanTools(sampleAt=()=>null){
  function validateOperations(plan){
    validation.validateTimedFields(plan,['version','chip','writes','referenceSampleRate'],'QSound plan');
    if(plan.version!==1 || plan.chip!=='qsound')throw Error('Expected a QSound register plan.');
    const rate=validation.referenceSampleRate(plan.referenceSampleRate);
    if(!Array.isArray(plan.writes)||plan.writes.length>limit)throw RangeError('Invalid register plan size.');
    let previous=0;
    const writes=Array.from(plan.writes,row=>{
      validation.validateTimedFields(row,['offsetSeconds','register','value','fadeMs'],'QSound write');
      const {offsetSeconds,register,value}=row;
      if(!validation.validOffset(offsetSeconds)||offsetSeconds<previous)throw RangeError('Invalid time offset.');
      previous=offsetSeconds;
      if(row.fadeMs!==undefined && (row.fadeMs!==4 || register>=128 || (register&7)!==6 || value!==0))
        throw RangeError('Invalid PCM note-off fade.');
      return {...(row.fadeMs===undefined?{}:{fadeMs:row.fadeMs}),offsetSeconds,register:number(register,0,255,'register'),value:number(value,0,65535,'word')};
    });
    return {chip:'qsound',version:1,referenceSampleRate:rate,writes};
  }
  function buildOperations(record,options={}){
    validation.validateTimedFields(options,['referenceSampleRate'],'build options');
    const referenceSampleRate=validation.referenceSampleRate(options.referenceSampleRate??48000);
    const writes=[];
    let offsetSeconds=0,open=true;
    const b={
      atSeconds(t){
        if(!open||!validation.validOffset(t)||t<offsetSeconds)throw RangeError('Invalid time offset.');
        offsetSeconds=t;return b;
      },
      atSample(n){return b.atSeconds(number(n,0,Number.MAX_SAFE_INTEGER,'sample offset')/referenceSampleRate);},
      writeRegister(register,value){
        if(!open||writes.length>=limit)throw RangeError('Recorder closed or plan full.');
        writes.push({offsetSeconds,register,value});return b;
      },
      noteOn(channel,midi,sample,pan=16,volume=8000){
        const ch=number(channel,1,16,'channel')-1;
        number(midi,0,127,'MIDI note');number(pan,0,32,'pan');number(volume,0,32767,'volume');
        let words;
        if(typeof sample==='string'){
          const v=sampleAt(sample);
          if(!v)throw Error('Missing project WAV: '+sample);
          const rate=Math.min(65535,Math.round(v.rate*2**((midi-60)/12)));
          words=noteWrites(ch,midi,0,pan,volume,rate,v.start+v.length,v.length,v.bank,v.start);
        }else words=noteWrites(ch,midi,number(sample,0,1,'factory sample or WAV path'),pan,volume);
        for(const [r,v] of words)b.writeRegister(r,v);
        return b;
      },
      noteOff(channel){b.keyOff(channel);writes[writes.length-1].fadeMs=4;return b;},
      keyOff(channel){return b.writeRegister((number(channel,1,16,'channel')-1)*8+6,0);},
      trigger(voice){return b.writeRegister(0xd5+number(voice,1,3,'ADPCM voice'),1);},
    };
    try{
      const result=record(b);
      if(result?.then){Promise.resolve(result).catch(()=>{});throw TypeError('Use a synchronous build callback.');}
      return validateOperations({chip:'qsound',version:1,referenceSampleRate,writes});
    }finally{open=false;}
  }
  return {...validation,validateOperations,buildOperations};
}
