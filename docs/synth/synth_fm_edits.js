// SPDX-License-Identifier: BSD-3-Clause
// Sparse editor writes share the current Code-controlled YM2612. Observe the
// transport rather than author preset values: raw .write() intentionally does
// not update YM2612Synth.channels, but its packed companions must survive edits.
// Install before the initial author patch. Future scheduleWrites() entries run
// inside the worklet and are not observable here until a later immediate write.
import {createSynthSongInteraction,readSynthSongEdit} from './synth_song_interaction.js?v=channel-view-1';
import {createSynthLocalChannelVoice} from './synth_local_channel_voice.js?v=channel-view-1';

export function createSynthFmEdits(synth) {
  const transport=synth?.transport;
  if(typeof transport?.write!=='function')throw new TypeError('Expected a YM2612Synth transport');
  const originalWrite=transport.write,originalWriteBatch=transport.writeBatch,originalReset=transport.reset;
  let forwardingBatch=0,observingBatch=false;
  const forwardWrite=(port,register,value)=>originalWrite.length>=3?originalWrite.call(transport,port,register,value)
    :originalWrite.call(transport,{port,register,value});
  const engine={
    writeYm2612(port,register,value){if(!observingBatch)return forwardWrite(port,register,value);},
    processFrames(){},reset(...args){return originalReset?.apply(transport,args);},
  };
  const interaction=createSynthSongInteraction(engine,{clockHz:synth.clock??7670454});
  let disposed=false;
  // Keep a three-argument signature: YM2612Synth uses arity to distinguish its
  // two supported transport protocols. The underlying transport keeps its own.
  function write(port,register,value) {
    if(port&&typeof port==='object')({port,register,value}=port);
    // Some custom batch transports forward through this.write(). The batch
    // wrapper observes that group once, after the original transport accepts it.
    if(forwardingBatch)return forwardWrite(port,register,value);
    // Local frame is write order, not rendered audio time. It separates a
    // future freeze from older manual overlays without adding a hardware tick.
    engine.processFrames(1);
    return engine.writeYm2612(port,register,value);
  }
  function writeBatch(commands,...args) {
    // Keep the original hardware transaction intact. Only its register shadow
    // is replayed here, never a second transport write. Capture command fields
    // first because a custom transport may consume or mutate its input array.
    const observed=commands.map(command=>Array.isArray(command)?{port:command[0],register:command[1],value:command[2]}:
      {port:command.port,register:command.register,value:command.value});
    const nested=forwardingBatch>0;
    let result;
    forwardingBatch++;
    try{result=originalWriteBatch.call(transport,commands,...args);}
    finally{forwardingBatch--;}
    if(!nested){
      observingBatch=true;
      try{for(const {port,register,value}of observed){engine.processFrames(1);engine.writeYm2612(port,register,value);}}
      finally{observingBatch=false;}
    }
    return result;
  }
  function reset(...args) {
    return engine.reset(...args);
  }
  transport.write=write;
  if(typeof originalWriteBatch==='function')transport.writeBatch=writeBatch;
  if(typeof originalReset==='function')transport.reset=reset;
  function apply(channel,changes) {
    if(disposed)throw new Error('FM editor writes are disposed');
    const edit=readSynthSongEdit({channel,changes});
    if(Object.keys(edit.changes).some(path=>path==='keyMask'||path.startsWith('gates.')))throw new TypeError('FM gate selections use the performance interface');
    if(!Object.keys(edit.changes).length)return false;
    const current=interaction.read().channels[channel].preset,own=path=>Object.hasOwn(edit.changes,path);
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
    if(transport.writeBatch===writeBatch)transport.writeBatch=originalWriteBatch;
    if(transport.reset===reset)transport.reset=originalReset;
    interaction.dispose();
  }
  return {apply,read:()=>interaction.read(),
    readWrittenSnapshot:frozen=>interaction.readSnapshot(frozen,interaction.generatedFrames,{frozen:true}),
    editWrittenChannel:(channel,changes)=>interaction.applyEdit({channel,changes}),
    channelKeyboard:createSynthLocalChannelVoice(interaction,{prefix:'local-fm'}),dispose};
}
