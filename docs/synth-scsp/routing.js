// SPDX-License-Identifier: BSD-3-Clause
export const SOURCE_COUNT=6;
export const OPERATOR_NAMES=['A','B','C','D','E','F'];
export const OPERATOR_KEYS=['carrier','modulator','c','d','e','f'];
export const operatorCount=mode=>mode==='pcm'?1:Number(mode.slice(2));
const denseArray=(value,length)=>Array.isArray(value)&&value.length===length&&Reflect.ownKeys(value).length===length+1&&Array.from({length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
/** Materialize an authored A–F depth request before merging live settings. */
export function operatorDepths(value){
  if(!denseArray(value,SOURCE_COUNT))throw new TypeError('FM depths must be a dense list of six operator values');
  return Array.from(value,depth=>{if(!Number.isInteger(depth)||depth<0||depth>12)throw new RangeError('Each operator FM depth must be 0..12');return depth;});
}
/** X and Y share the receiving operator's one hardware MDL value. */
export const operatorDepth=(config,index)=>config.fm.depths?.[index]??config.fm.depth;
export const hasSelfFeedback=graph=>graph.inputs.some((sources,target)=>sources.includes(target));
export const selfFeedbackCount=graph=>graph.inputs.reduce((count,sources,target)=>count+Number(sources.includes(target)),0);
/** Fixed two-OP cycle metadata. Timing/order are defined by the algorithm. */
export function cycle2Routing(value){
  if(arguments.length===0)value={outputs:[1]};
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==1||!Object.hasOwn(value,'outputs'))throw new TypeError('Cycle 2OP requires outputs only');
  const raw=value.outputs;
  if(!Array.isArray(raw)||raw.length>2||!denseArray(raw,raw.length))throw new TypeError('Cycle 2OP outputs must be a dense operator list');
  const outputs=Array.from(raw,output=>{if(output!==0&&output!==1)throw new RangeError('Cycle 2OP output must name A or B');return output;});
  if(new Set(outputs).size!==outputs.length)throw new TypeError('Cycle 2OP outputs must not contain duplicates');
  return {outputs:outputs.sort((a,b)=>a-b)};
}
const customCounts=[2,4,6];
function customOrder(inputs){
  const remaining=inputs.map((sources,target)=>sources.filter(source=>source!==target).length),dependents=inputs.map(()=>[]),ready=[],order=[];
  inputs.forEach((sources,target)=>sources.forEach(source=>{if(source!==target)dependents[source].push(target);}));
  remaining.forEach((count,index)=>{if(!count)ready.push(index);});
  while(ready.length){
    // Legacy templates use descending operator IDs. Prefer that same placement
    // whenever more than one dependency-ready operator is available.
    ready.sort((a,b)=>b-a);const source=ready.shift();order.push(source);
    for(const target of dependents[source])if(--remaining[target]===0)ready.push(target);
  }
  if(order.length!==inputs.length)throw new RangeError('Feedback loops are outside this acyclic Synth editor');
  return order;
}
/** Custom Synth routing: acyclic external routes and exclusive self inputs.
 * This editor constraint does not describe every SCSP hardware connection. */
export function customRouting(value,count){
  if(arguments.length===0)value={inputs:[[1],[]],outputs:[0]};
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==2||!Object.hasOwn(value,'inputs')||!Object.hasOwn(value,'outputs'))throw new TypeError('Custom FM requires inputs and outputs');
  const {inputs:rawInputs,outputs:rawOutputs}=value;
  const length=rawInputs?.length;
  if(!customCounts.includes(length)||!denseArray(rawInputs,length))throw new TypeError('Custom FM requires a dense input list for 2, 4 or 6 operators');
  if(count!==undefined&&length!==count)throw new RangeError('Custom FM input count must match the active FM mode');
  const inputs=Array.from(rawInputs,(entry,target)=>{
    if(!Array.isArray(entry)||entry.length>2||!denseArray(entry,entry.length))throw new TypeError('Each custom input needs zero, one or two distinct operators');
    const sources=Array.from(entry,source=>{
      if(!Number.isInteger(source)||source<0||source>=length)throw new RangeError('Custom source must name an operator in this graph');
      return source;
    });
    if(new Set(sources).size!==sources.length)throw new TypeError('Custom inputs must not contain duplicates');
    return sources;
  });
  const self=inputs.flatMap((sources,target)=>sources.includes(target)?[target]:[]);
  if((length===2&&self.length>1)||self.some(target=>inputs[target].length!==1))
    throw new RangeError('Self feedback needs an exclusive self input; Custom 2-op supports only one self operator');
  customOrder(inputs);
  if(!Array.isArray(rawOutputs)||rawOutputs.length>length||!denseArray(rawOutputs,rawOutputs.length))throw new TypeError('Custom outputs must be a dense operator list');
  const outputs=Array.from(rawOutputs,output=>{if(!Number.isInteger(output)||output<0||output>=length)throw new RangeError('Custom output must name an operator in this graph');return output;});
  if(new Set(outputs).size!==outputs.length)throw new TypeError('Custom outputs must not contain duplicates');
  return {inputs,outputs:outputs.sort((a,b)=>a-b)};
}
/** Resize a stored graph without inventing routes or direct outputs. */
export function resizeCustomRouting(value,count){
  if(!customCounts.includes(count))throw new RangeError('Custom FM needs 2, 4 or 6 operators');
  const graph=customRouting(value);
  return customRouting({inputs:Array.from({length:count},(_,index)=>(graph.inputs[index]??[]).filter(source=>source<count)),outputs:graph.outputs.filter(output=>output<count)},count);
}
export function routing(config){
  const count=operatorCount(config.mode),inputs=Array.from({length:count},()=>[]);
  if(config.fm.algorithm==='cycle2'){
    if(config.mode!=='fm2')throw new TypeError('Cycle 2OP requires FM2 mode');
    return {count,inputs:[[1],[0]],...cycle2Routing(config.fm.cycle2)};
  }
  if(config.fm.algorithm==='custom'){
    if(config.mode==='pcm')throw new TypeError('Custom connections require an FM mode');
    return {count,...customRouting(config.fm.custom,count)};
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
  const graph=routing(config),order=customOrder(graph.inputs);
  return graph.inputs.map((_,index)=>slots[order.indexOf(index)]);
}
// Legacy graphs use reverse operator order. Custom dependency order likewise
// places each source earlier in the zero-delay core's physical sound stack.
export function voiceCommands(synth,config,group){
  const {count,inputs,outputs}=routing(config),state=synth.getState(),frequency=440*2**((group.midi-69+config.transpose)/12),commands=[],custom=config.fm.algorithm==='custom',cycle=config.fm.algorithm==='cycle2',slots=custom?customOperatorSlots(config,group.slots):cycle?group.slots:null;
  for(let index=count-1;index>=0;index--){
    const voice=state.slots[index],slot=slots?slots[index]:group.slots[count-1-index],sources=inputs[index];
    if(sources.length&&voice.sample?.loopStartSamples!==0)throw new RangeError(`FM operator ${OPERATOR_NAMES[index]} needs a full forward loop (loop start 0)`);
    const offsets=sources.map(source=>((slots?slots[source]:group.slots[count-1-source])-slot+64)%64);
    // Self uses the latest/past pair recommended by the SCSP manual. In this
    // zero slot-delay core these are the preceding one/two native samples.
    const self=sources.includes(index);
    const modulation={depth:sources.length?operatorDepth(config,index):0,xOffset:cycle?(index===0?33:63):self?32:offsets[0]??0,yOffset:cycle?(index===0?1:63):self?0:offsets[1]??offsets[0]??0,writeInhibit:false};
    commands.push(['setPreset',[slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:outputs.includes(index)?voice.directLevel:0,pan:voice.pan,frequencyHz:frequency*(config.mode==='pcm'?1:config.fm.ratios[index]),modulation}]]);
  }
  for(const slot of group.slots)commands.push(['keyOn',[slot]]);
  return commands;
}
export function operatorSlot(group,index){return index<group.slots.length?(group.operatorSlots?.[index]??(group.config?.fm.algorithm==='custom'?customOperatorSlots(group.config,group.slots)[index]:group.config?.fm.algorithm==='cycle2'?group.slots[index]:group.slots[group.slots.length-1-index])):null;}
