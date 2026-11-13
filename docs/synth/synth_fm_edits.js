// SPDX-License-Identifier: BSD-3-Clause
// Sparse editor writes share the current Code-controlled YM2612. Observe the
// transport rather than author preset values: raw .write() intentionally does
// not update YM2612Synth.channels, but its packed companions must survive edits.
// Install before the initial author patch. Future scheduleWrites() entries run
// inside the worklet and are not observable here until a later immediate write.
import {createYm2612RegisterState} from './synth_song_state.js';
import {readSynthSongEdit} from './synth_song_interaction.js';

export function createSynthFmEdits(synth) {
  const transport=synth?.transport;
  if(typeof transport?.write!=='function')throw new TypeError('Expected a YM2612Synth transport');
  const originalWrite=transport.write,originalReset=transport.reset;
  const decoder=createYm2612RegisterState(synth.clock??7670454);
  let disposed=false;
  // Keep a three-argument signature: YM2612Synth uses arity to distinguish its
  // two supported transport protocols. The underlying transport keeps its own.
  function write(port,register,value) {
    if(port&&typeof port==='object')({port,register,value}=port);
    const result=originalWrite.length>=3?originalWrite.call(this,port,register,value)
      :originalWrite.call(this,{port,register,value});
    if(!disposed)decoder.write(port,register,value);
    return result;
  }
  function reset(...args) {
    const result=originalReset?.apply(this,args);decoder.reset();return result;
  }
  transport.write=write;
  if(typeof originalReset==='function')transport.reset=reset;
  function apply(channel,changes) {
    if(disposed)throw new Error('FM editor writes are disposed');
    const edit=readSynthSongEdit({channel,changes});
    if(Object.keys(edit.changes).some(path=>path==='keyMask'||path.startsWith('gates.')))throw new TypeError('FM gate selections use the performance interface');
    if(!Object.keys(edit.changes).length)return false;
    const current=decoder.snapshot().channels[channel].preset,own=path=>Object.hasOwn(edit.changes,path);
    const operators=new Map();
    for(const [path,value]of Object.entries(edit.changes))if(path.startsWith('operators.')){
      const [,number,field]=path.split('.'),index=Number(number);
      if(!operators.has(index))operators.set(index,{});
      operators.get(index)[field]=value;
    }
    for(const [operator,patch]of operators){
      const head=current.operators[operator];
      // Supply the logical companion from the actual written register, so the
      // public Synth method cannot fill it from stale high-level cached state.
      for(const pair of [['dt','multi'],['rs','ar'],['am','d1r'],['sl','rr']])if(pair.some(field=>Object.hasOwn(patch,field)))
        for(const field of pair)if(!Object.hasOwn(patch,field))patch[field]=head[field];
      synth.setOperator(channel,operator-1,patch);
    }
    if(own('algorithm')||own('feedback'))synth.setAlgo(channel,
      own('algorithm')?edit.changes.algorithm:current.algorithm,
      own('feedback')?edit.changes.feedback:current.feedback);
    if(['pan.left','pan.right','ams','pms'].some(own))synth.setPan(channel,
      own('pan.left')?edit.changes['pan.left']:current.pan.left,
      own('pan.right')?edit.changes['pan.right']:current.pan.right,
      own('ams')?edit.changes.ams:current.ams,
      own('pms')?edit.changes.pms:current.pms);
    if(own('lfo.enabled')||own('lfo.frequency'))synth.setLfo(
      own('lfo.enabled')?edit.changes['lfo.enabled']:current.lfo.enabled,
      own('lfo.frequency')?edit.changes['lfo.frequency']:current.lfo.frequency);
    return edit;
  }
  function dispose(){
    if(disposed)return;disposed=true;
    if(transport.write===write)transport.write=originalWrite;
    if(transport.reset===reset)transport.reset=originalReset;
  }
  return {apply,read:()=>decoder.snapshot(),dispose};
}
