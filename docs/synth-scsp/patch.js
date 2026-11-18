// SPDX-License-Identifier: BSD-3-Clause
import {createScspValidation} from '../js/playground_scsp.js';
import {readPreset,writePreset} from './preset.js';
import {effectSettings,reserveDspRam} from './dsp.js?v=scsp-dsp-coef-1';
import {SOURCE_COUNT,OPERATOR_KEYS,voiceCommands,operatorCount,customRouting,cycle2Routing,operatorDepths,selfFeedbackCount} from './routing.js?v=scsp-cycle2-code-1';
export const FM_MAX_DEPTH=12;
export function settings(value) {
  if(!value||!['pcm','fm2','fm4','fm6'].includes(value.mode))throw new TypeError('Mode must be pcm, fm2, fm4 or fm6');
  const fm=value.fm;
  if(!fm||!Number.isInteger(fm.depth)||fm.depth<0||fm.depth>FM_MAX_DEPTH)throw new RangeError('FM depth must be 0..12');
  const depths=Object.hasOwn(fm,'depths')?operatorDepths(fm.depths):undefined,uniform=depths?.every(depth=>depth===depths[0]);
  if(!Number.isFinite(fm.ratio)||fm.ratio<.125||fm.ratio>8)throw new RangeError('Modulator ratio must be 0.125..8');
  const algorithm=fm.algorithm??'chain',ratios=fm.ratios??[1,...Array(5).fill(fm.ratio)];
  if(!['chain','pairs','branch','custom','cycle2'].includes(algorithm))throw new TypeError('Unknown FM connection');
  if(algorithm==='custom'&&value.mode==='pcm')throw new TypeError('Custom connections require an FM mode');
  if(algorithm==='cycle2'&&value.mode!=='fm2')throw new TypeError('Cycle 2OP requires FM2 mode');
  const cycle2=Object.hasOwn(fm,'cycle2')?cycle2Routing(fm.cycle2):algorithm==='cycle2'?cycle2Routing():undefined;
  const count=operatorCount(value.mode),custom=Object.hasOwn(fm,'custom')?customRouting(fm.custom,algorithm==='custom'?count:undefined):algorithm==='custom'?customRouting({inputs:Array.from({length:count},(_,index)=>index+1<count?[index+1]:[]),outputs:[0]}):undefined;
  if(!Array.isArray(ratios)||ratios.length!==SOURCE_COUNT||ratios.some(v=>!Number.isFinite(v)||v<.125||v>8))throw new RangeError('Each operator ratio must be 0.125..8');
  if(!Number.isInteger(value.transpose)||value.transpose< -24||value.transpose>24)throw new RangeError('Pitch must be -24..24 semitones');
  return {mode:value.mode,fm:{depth:uniform?depths[0]:fm.depth,ratio:fm.ratio,algorithm,ratios:[...ratios],...(custom?{custom}:{}),...(cycle2?{cycle2}:{}),...(depths&&!uniform?{depths}:{})},transpose:value.transpose,effect:effectSettings(value.effect)};
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
  const version=value.version;
  if(value.fm?.algorithm==='cycle2'||Object.hasOwn(value.fm??{},'cycle2'))throw new TypeError('Cycle 2OP portable presets require version 11 support, which is not available yet');
  if(version>=1&&version<7&&Object.hasOwn(value.fm??{},'depths'))throw new TypeError('Per-operator FM depths require preset version 7');
  if(version>=1&&version<5&&(value.fm?.algorithm==='custom'||Object.hasOwn(value.fm??{},'custom')))throw new TypeError('Custom FM routing requires preset version 5');
  let config,operators={};
  if(version===1){
    operators.carrier=readPreset(value);config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});
  }else if(version===2||version===3||version===4||version===5||version===6||version===7||version===8||version===9||version===10){
    if(version===2&&!['pcm','fm2'].includes(value.mode))throw new TypeError('Version 2 supports PCM or 2-op');
    if(version===5&&(value.mode!=='fm2'||value.fm?.algorithm!=='custom'||!Object.hasOwn(value.fm??{},'custom')))throw new TypeError('Preset version 5 requires complete custom 2-op FM routing');
    if(version===6&&(!['fm4','fm6'].includes(value.mode)||value.fm?.algorithm!=='custom'||!Object.hasOwn(value.fm??{},'custom')))throw new TypeError('Preset version 6 requires complete custom 4-op or 6-op FM routing');
    if(version===7&&(!Object.hasOwn(value.fm??{},'depths')||value.fm?.algorithm==='custom'&&!Object.hasOwn(value.fm,'custom')))throw new TypeError('Preset version 7 requires complete operator depths and explicit Custom routing');
    if(version===8&&(value.mode!=='fm2'||value.fm?.algorithm!=='custom'||!Object.hasOwn(value.fm??{},'custom')))throw new TypeError('Preset version 8 requires complete Custom 2-op self feedback');
    if(version===9&&(!['fm4','fm6'].includes(value.mode)||value.fm?.algorithm!=='custom'||!Object.hasOwn(value.fm??{},'custom')))throw new TypeError('Preset version 9 requires complete Custom 4-op or 6-op self feedback');
    if(version===10&&(!['fm4','fm6'].includes(value.mode)||value.fm?.algorithm!=='custom'||!Object.hasOwn(value.fm??{},'custom')))throw new TypeError('Preset version 10 requires complete Custom 4-op or 6-op multiple self feedback');
    // Capture the declared version once; unrelated property getters must not
    // switch the format after its normalized graph has been validated.
    config=settings({mode:value.mode,fm:value.fm,transpose:value.transpose,effect:version>=4?value.effect:undefined});
    // A getter can change fm between the early format gates and normalized
    // validation. Phase 1 never lets a legacy preset carry active/dormant Cycle.
    if(config.fm.algorithm==='cycle2'||Object.hasOwn(config.fm,'cycle2'))throw new TypeError('Cycle 2OP portable presets require version 11 support, which is not available yet');
    const self=config.fm.custom?selfFeedbackCount(config.fm.custom):0;
    if(version<8&&self)throw new TypeError('Self feedback needs preset version 8 for 2-op, 9 for one Self in 4/6-op, or 10 for multiple Self operators');
    if(version===8&&(config.mode!=='fm2'||config.fm.algorithm!=='custom'||self!==1))throw new TypeError('Preset version 8 requires Custom 2-op with an actual self-feedback connection');
    if(version===9&&(!['fm4','fm6'].includes(config.mode)||config.fm.algorithm!=='custom'||self!==1))throw new TypeError('Preset version 9 requires Custom 4-op or 6-op with exactly one self-feedback connection');
    if(version===10&&(!['fm4','fm6'].includes(config.mode)||config.fm.algorithm!=='custom'||self<2))throw new TypeError('Preset version 10 requires Custom 4-op or 6-op with multiple self-feedback connections');
    for(const key of OPERATOR_KEYS.slice(0,version===2?2:SOURCE_COUNT)){
      if(!value.operators?.[key])throw new TypeError('Preset needs all operators');operators[key]=single(value.operators[key]);
    }
    // In v2 the modulator's direct level was forcibly zero. In v3 output is
    // determined by the connection, and its source mix is available for Pairs.
    if(version===2)operators.modulator.voice.directLevel=7;
  }else throw new TypeError('Unsupported SCSP preset version');
  for(const key of OPERATOR_KEYS)operators[key]??=defaultOperator();
  const check=createScspValidation();
  try{
    reserveDspRam(check);
    OPERATOR_KEYS.forEach((key,index)=>{const op=operators[key],sample=check.loadPCM(op.pcm,pcmOptions(op));check.setPreset(index,{...op.voice,sample});});
    const count=operatorCount(config.mode);
    for(const [method,args]of voiceCommands(check,config,{midi:69,slots:Array.from({length:count},(_,i)=>SOURCE_COUNT+i)}))check[method](...args);
  }finally{check.dispose();}
  return {...config,operators};
}
export function writePatch(config,operators) {
  const validated=settings(config),custom=validated.fm.algorithm==='custom';
  if(validated.fm.algorithm==='cycle2')throw new TypeError('Cycle 2OP portable presets require version 11 support, which is not available yet');
  delete validated.fm.cycle2;
  if(!custom)delete validated.fm.custom;
  const self=custom?selfFeedbackCount(validated.fm.custom):0;
  const value={format:'tetorica-scsp-voice',version:self?(validated.mode==='fm2'?8:self===1?9:10):validated.fm.depths?7:custom?(validated.mode==='fm2'?5:6):4,...validated,operators:Object.fromEntries(Object.entries(operators).map(([kind,operator])=>{
    const {format,version,...saved}=writePreset(operator);return [kind,saved];
  }))};
  readPatch(value);return value;
}
