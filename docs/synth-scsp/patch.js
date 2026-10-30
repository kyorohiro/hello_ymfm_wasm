// SPDX-License-Identifier: BSD-3-Clause
import {createScspValidation} from '../js/playground_scsp.js';
import {readPreset,writePreset} from './preset.js';
import {SOURCE_COUNT,OPERATOR_KEYS,voiceCommands,operatorCount} from './routing.js';
export const FM_MAX_DEPTH=12;
export function settings(value) {
  if(!value||!['pcm','fm2','fm4','fm6'].includes(value.mode))throw new TypeError('Mode must be pcm, fm2, fm4 or fm6');
  const fm=value.fm;
  if(!fm||!Number.isInteger(fm.depth)||fm.depth<0||fm.depth>FM_MAX_DEPTH)throw new RangeError('FM depth must be 0..12');
  if(!Number.isFinite(fm.ratio)||fm.ratio<.125||fm.ratio>8)throw new RangeError('Modulator ratio must be 0.125..8');
  const algorithm=fm.algorithm??'chain',ratios=fm.ratios??[1,...Array(5).fill(fm.ratio)];
  if(!['chain','pairs','branch'].includes(algorithm))throw new TypeError('Unknown FM connection');
  if(!Array.isArray(ratios)||ratios.length!==SOURCE_COUNT||ratios.some(v=>!Number.isFinite(v)||v<.125||v>8))throw new RangeError('Each operator ratio must be 0.125..8');
  if(!Number.isInteger(value.transpose)||value.transpose< -24||value.transpose>24)throw new RangeError('Pitch must be -24..24 semitones');
  return {mode:value.mode,fm:{depth:fm.depth,ratio:fm.ratio,algorithm,ratios:[...ratios]},transpose:value.transpose};
}
export function pcmOptions(operator) {
  const options={...operator.options};delete options.modulationDepth;
  if(options.loopStartSamples===0)options.modulationDepth=FM_MAX_DEPTH;
  return options;
}
function single(value){return readPreset({...value,format:'tetorica-scsp-voice',version:1});}
function defaultOperator(){return {pcm:Int16Array.from({length:64},(_,i)=>Math.round(8192*Math.sin(i*Math.PI/32))),options:{baseFrequencyHz:44100/64,loopStartSamples:0},voice:{frequencyHz:440,totalLevel:0,directLevel:7,pan:0,envelope:{attackRate:31,decay1Rate:0,decay2Rate:0,decayLevel:0,releaseRate:31,keyRateScaling:15},lfo:{}}};}
export function readPatch(value) {
  if(value?.format!=='tetorica-scsp-voice')throw new TypeError('Unsupported SCSP preset format');
  let config,operators={};
  if(value.version===1){
    operators.carrier=readPreset(value);config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});
  }else if(value.version===2||value.version===3){
    if(value.version===2&&!['pcm','fm2'].includes(value.mode))throw new TypeError('Version 2 supports PCM or 2-op');
    config=settings(value);
    for(const key of OPERATOR_KEYS.slice(0,value.version===2?2:SOURCE_COUNT)){
      if(!value.operators?.[key])throw new TypeError('Preset needs all operators');operators[key]=single(value.operators[key]);
    }
    // In v2 the modulator's direct level was forcibly zero. In v3 output is
    // determined by the connection, and its source mix is available for Pairs.
    if(value.version===2)operators.modulator.voice.directLevel=7;
  }else throw new TypeError('Unsupported SCSP preset version');
  for(const key of OPERATOR_KEYS)operators[key]??=defaultOperator();
  const check=createScspValidation();
  try{
    OPERATOR_KEYS.forEach((key,index)=>{const op=operators[key],sample=check.loadPCM(op.pcm,pcmOptions(op));check.setPreset(index,{...op.voice,sample});});
    const count=operatorCount(config.mode);
    for(const [method,args]of voiceCommands(check,config,{midi:69,slots:Array.from({length:count},(_,i)=>SOURCE_COUNT+i)}))check[method](...args);
  }finally{check.dispose();}
  return {...config,operators};
}
export function writePatch(config,operators) {
  const value={format:'tetorica-scsp-voice',version:3,...settings(config),operators:Object.fromEntries(Object.entries(operators).map(([kind,operator])=>{
    const {format,version,...saved}=writePreset(operator);return [kind,saved];
  }))};
  readPatch(value);return value;
}
