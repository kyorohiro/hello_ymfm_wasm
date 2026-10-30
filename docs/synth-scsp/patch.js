// SPDX-License-Identifier: BSD-3-Clause
import {createScspValidation} from '../js/playground_scsp.js';
import {readPreset,writePreset} from './preset.js';
export const FM_MAX_DEPTH=12;
export function settings(value) {
  if(!value||!['pcm','fm2'].includes(value.mode))throw new TypeError('Mode must be pcm or fm2');
  const fm=value.fm;
  if(!fm||!Number.isInteger(fm.depth)||fm.depth<0||fm.depth>FM_MAX_DEPTH)throw new RangeError('FM depth must be 0..12');
  if(!Number.isFinite(fm.ratio)||fm.ratio<.125||fm.ratio>8)throw new RangeError('Modulator ratio must be 0.125..8');
  if(!Number.isInteger(value.transpose)||value.transpose< -24||value.transpose>24)throw new RangeError('Pitch must be -24..24 semitones');
  return {mode:value.mode,fm:{depth:fm.depth,ratio:fm.ratio},transpose:value.transpose};
}
export function pcmOptions(operator,kind) {
  const options={...operator.options};delete options.modulationDepth;
  if(kind==='carrier'&&options.loopStartSamples===0)options.modulationDepth=FM_MAX_DEPTH;
  return options;
}
function single(value){return readPreset({...value,format:'tetorica-scsp-voice',version:1});}
export function readPatch(value) {
  if(value?.format!=='tetorica-scsp-voice')throw new TypeError('Unsupported SCSP preset format');
  let config,carrier,modulator;
  if(value.version===1){
    carrier=readPreset(value);modulator={pcm:Int16Array.from({length:64},(_,i)=>Math.round(8192*Math.sin(i*Math.PI/32))),options:{baseFrequencyHz:44100/64,loopStartSamples:0},voice:{frequencyHz:440,totalLevel:0,directLevel:0,pan:0,envelope:{attackRate:31,decay1Rate:0,decay2Rate:0,decayLevel:0,releaseRate:31,keyRateScaling:15},lfo:{}}};
    config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});
  }else if(value.version===2){
    config=settings(value);
    if(!value.operators?.carrier||!value.operators?.modulator)throw new TypeError('Preset needs both operators');
    carrier=single(value.operators.carrier);modulator=single(value.operators.modulator);
  }else throw new TypeError('Unsupported SCSP preset version');
  modulator.voice.directLevel=0;
  const check=createScspValidation();
  try{
    const a=check.loadPCM(carrier.pcm,pcmOptions(carrier,'carrier')),b=check.loadPCM(modulator.pcm,pcmOptions(modulator,'modulator'));
    check.setPreset(0,{...carrier.voice,sample:a});check.setPreset(1,{...modulator.voice,sample:b});
    if(config.mode==='fm2'){
      if(carrier.options.loopStartSamples!==0)throw new RangeError('FM carrier needs a full forward loop (loop start 0)');
      check.setPreset(2,{...modulator.voice,sample:b,frequencyHz:440*2**(config.transpose/12)*config.fm.ratio});
      check.setPreset(3,{...carrier.voice,sample:a,frequencyHz:440*2**(config.transpose/12),modulation:{depth:config.fm.depth,xOffset:63,yOffset:63}});
    }
  }finally{check.dispose();}
  return {...config,operators:{carrier,modulator}};
}
export function writePatch(config,operators) {
  const value={format:'tetorica-scsp-voice',version:2,...settings(config),operators:Object.fromEntries(Object.entries(operators).map(([kind,operator])=>{
    const single=writePreset(operator);const {format,version,...saved}=single;return [kind,saved];
  }))};
  readPatch(value);return value;
}
