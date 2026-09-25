/** AudioWorklet: bank allocation and voice routing for the native PCM mixer. */
export function createSampleProcessor(api,rate){
 const banks=new Map(),voices=new Map();let nextVoice=0;
 const clear=()=>{api.sample_clear();voices.clear();};
 const reset=()=>{api.sample_reset(rate);banks.clear();voices.clear();};reset();
 return {clear,reset,command(d){
  if(d.action==='load'){
   const {channels,sampleRate}=d.pcm;
   let slot=banks.get(d.name);if(slot===undefined){slot=0;while([...banks.values()].includes(slot))slot++;}
   if(slot>=64)throw new Error('Native sample bank limit (64) reached');
   const length=channels[0].length,ptr=api.sample_allocate(slot,length,channels.length,sampleRate);
   if(!ptr)throw new Error('Unable to allocate native sample bank');
   const data=new Float32Array(api.memory.buffer,ptr,length*channels.length);
   channels.forEach((ch,i)=>data.set(ch,i*length));banks.set(d.name,slot);return;
  }
  if(d.action==='play'){
   const bank=banks.get(d.name);if(bank===undefined)throw new Error(`Unknown sample: ${d.name}`);
   let slot=0;while(slot<64&&api.sample_active(slot))slot++;
   if(slot===64)throw new Error('Native sample voice limit (64) reached');
   for(const [id,v] of voices)if(v.slot===slot)voices.delete(id);
   const o=d.options;
   if(!api.sample_play(slot,bank,o.playbackRate,o.gain,o.pan,o.offset,o.duration,o.loop?1:0,o.loopStart,o.loopEnd,o.fadeIn,o.fadeOut))throw new Error('Invalid sample playback');
   const id=++nextVoice;voices.set(id,{slot,name:d.name});return id;
  }
  if(d.action==='stopVoice'){const v=voices.get(d.voice);if(v)api.sample_stop(v.slot);return;}
  if(d.action==='stop'){for(const v of voices.values())if(d.name==null||d.name===v.name)api.sample_stop(v.slot);return;}
  if(d.action==='clear'){clear();return;}
  if(d.action==='unload'){const slot=banks.get(d.name);if(slot!==undefined){api.sample_unload(slot);banks.delete(d.name);for(const [id,v] of voices)if(v.name===d.name)voices.delete(id);}return;}
 }};
}
