// SPDX-License-Identifier: BSD-3-Clause
export const SOURCE_COUNT=6;
export const OPERATOR_NAMES=['A','B','C','D','E','F'];
export const OPERATOR_KEYS=['carrier','modulator','c','d','e','f'];
export const operatorCount=mode=>mode==='pcm'?1:Number(mode.slice(2));
const denseArray=(value,length)=>Array.isArray(value)&&value.length===length&&Reflect.ownKeys(value).length===length+1&&Array.from({length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
/** Initial custom editor: independent A/B inputs and outputs, without feedback.
 * This is a Synth graph constraint, not a hardware limitation. */
export function customRouting(value){
  if(arguments.length===0)value={inputs:[[1],[]],outputs:[0]};
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==2||!Object.hasOwn(value,'inputs')||!Object.hasOwn(value,'outputs'))throw new TypeError('Custom FM requires inputs and outputs');
  const {inputs:rawInputs,outputs:rawOutputs}=value;
  if(!denseArray(rawInputs,2))throw new TypeError('Custom 2-op FM requires inputs for A and B');
  const inputs=Array.from(rawInputs,(entry,target)=>{
    if(!Array.isArray(entry)||entry.length>1||!denseArray(entry,entry.length))throw new TypeError('Each custom 2-op input must be empty or one operator');
    return Array.from(entry,source=>{
      if(!Number.isInteger(source)||source<0||source>1)throw new RangeError('Custom 2-op source must be A or B');
      if(source===target)throw new RangeError('Self modulation is outside this acyclic Synth editor');
      return source;
    });
  });
  if(inputs[0].length&&inputs[1].length)throw new RangeError('Feedback loops are outside this acyclic Synth editor');
  if(!Array.isArray(rawOutputs)||rawOutputs.length>2||!denseArray(rawOutputs,rawOutputs.length))throw new TypeError('Custom outputs must be a dense A/B list');
  const outputs=Array.from(rawOutputs,output=>{if(!Number.isInteger(output)||output<0||output>1)throw new RangeError('Custom output must be A or B');return output;});
  if(new Set(outputs).size!==outputs.length)throw new TypeError('Custom outputs must not contain duplicates');
  return {inputs,outputs:outputs.sort((a,b)=>a-b)};
}
export function routing(config){
  const count=operatorCount(config.mode),inputs=Array.from({length:count},()=>[]);
  if(config.fm.algorithm==='custom'){
    if(config.mode!=='fm2')throw new TypeError('Custom connections currently require 2-op FM');
    return {count,...customRouting(config.fm.custom)};
  }
  if(config.mode!=='pcm'){
    if(config.fm.algorithm==='chain')for(let i=0;i<count-1;i++)inputs[i]=[i+1];
    else if(config.fm.algorithm==='pairs')for(let i=0;i<count;i+=2)inputs[i]=[i+1];
    else for(let i=1;i<count;i++)inputs[Math.floor((i-1)/2)].push(i);
  }
  const modulators=new Set(inputs.flat()),outputs=inputs.map((_,i)=>i).filter(i=>!modulators.has(i));
  return {count,inputs,outputs};
}
/** Map operator identities to ascending physical slots in dependency order.
 * Reverse operator order for independent nodes matches the legacy placement. */
export function customOperatorSlots(config,slots){
  const graph=routing(config),order=graph.inputs[1].includes(0)?[0,1]:[1,0];
  return [slots[order.indexOf(0)],slots[order.indexOf(1)]];
}
// Legacy graphs use reverse operator order. Custom dependency order likewise
// places each source earlier in the zero-delay core's physical sound stack.
export function voiceCommands(synth,config,group){
  const {count,inputs,outputs}=routing(config),state=synth.getState(),frequency=440*2**((group.midi-69+config.transpose)/12),commands=[],custom=config.fm.algorithm==='custom',slots=custom?customOperatorSlots(config,group.slots):null;
  for(let index=count-1;index>=0;index--){
    const voice=state.slots[index],slot=custom?slots[index]:group.slots[count-1-index],sources=inputs[index];
    if(sources.length&&voice.sample?.loopStartSamples!==0)throw new RangeError(`FM operator ${OPERATOR_NAMES[index]} needs a full forward loop (loop start 0)`);
    const offsets=sources.map(source=>((custom?slots[source]:group.slots[count-1-source])-slot+64)%64);
    const modulation={depth:sources.length?config.fm.depth:0,xOffset:offsets[0]??0,yOffset:offsets[1]??offsets[0]??0,writeInhibit:false};
    commands.push(['setPreset',[slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:outputs.includes(index)?voice.directLevel:0,pan:voice.pan,frequencyHz:frequency*(config.mode==='pcm'?1:config.fm.ratios[index]),modulation}]]);
  }
  for(const slot of group.slots)commands.push(['keyOn',[slot]]);
  return commands;
}
export function operatorSlot(group,index){return index<group.slots.length?(group.operatorSlots?.[index]??(group.config?.fm.algorithm==='custom'?customOperatorSlots(group.config,group.slots)[index]:group.slots[group.slots.length-1-index])):null;}
