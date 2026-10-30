// SPDX-License-Identifier: BSD-3-Clause
export const SOURCE_COUNT=6;
export const OPERATOR_NAMES=['A','B','C','D','E','F'];
export const OPERATOR_KEYS=['carrier','modulator','c','d','e','f'];
export const operatorCount=mode=>mode==='pcm'?1:Number(mode.slice(2));
export function routing(config){
  const count=operatorCount(config.mode),inputs=Array.from({length:count},()=>[]);
  if(config.mode!=='pcm'){
    if(config.fm.algorithm==='chain')for(let i=0;i<count-1;i++)inputs[i]=[i+1];
    else if(config.fm.algorithm==='pairs')for(let i=0;i<count;i+=2)inputs[i]=[i+1];
    else for(let i=1;i<count;i++)inputs[Math.floor((i-1)/2)].push(i);
  }
  const modulators=new Set(inputs.flat()),outputs=inputs.map((_,i)=>i).filter(i=>!modulators.has(i));
  return {count,inputs,outputs};
}
// Every edge points from a higher operator index to a lower one. Reverse slot
// order therefore makes each source available in the zero-delay core's stack.
export function voiceCommands(synth,config,group){
  const {count,inputs,outputs}=routing(config),state=synth.getState(),frequency=440*2**((group.midi-69+config.transpose)/12),commands=[];
  for(let index=count-1;index>=0;index--){
    const voice=state.slots[index],slot=group.slots[count-1-index],sources=inputs[index];
    if(sources.length&&voice.sample?.loopStartSamples!==0)throw new RangeError(`FM operator ${OPERATOR_NAMES[index]} needs a full forward loop (loop start 0)`);
    const offsets=sources.map(source=>(group.slots[count-1-source]-slot+64)%64);
    const modulation={depth:sources.length?config.fm.depth:0,xOffset:offsets[0]??0,yOffset:offsets[1]??offsets[0]??0,writeInhibit:false};
    commands.push(['setPreset',[slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:outputs.includes(index)?voice.directLevel:0,pan:voice.pan,frequencyHz:frequency*(config.mode==='pcm'?1:config.fm.ratios[index]),modulation}]]);
  }
  for(const slot of group.slots)commands.push(['keyOn',[slot]]);
  return commands;
}
export function operatorSlot(group,index){return index<group.slots.length?group.slots[group.slots.length-1-index]:null;}
