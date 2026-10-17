/** AudioWorklet: bank allocation and voice routing for the native PCM mixer. */
/**
 * @param {{memory: WebAssembly.Memory, sample_clear: () => void, sample_reset: (rate: number) => void,
 *   sample_allocate: (slot: number, frames: number, channels: number, rate: number) => number,
 *   sample_active: (slot: number) => number,
 *   sample_play: (slot: number, bank: number, rate: number, gain: number, pan: number, offset: number, duration: number, loop: number, loopStart: number, loopEnd: number, fadeIn: number, fadeOut: number) => number,
 *   sample_stop: (slot: number) => void, sample_unload: (slot: number) => void}} api Native WASM sample exports.
 * @param {number} rate Output sample frames per second.
 * @returns Clear/reset and command dispatch operations; play returns a voice ID.
 */
export function createSampleProcessor(api,rate){
 const banks=new Map(),bankRates=new Map(),voices=new Map();let nextVoice=0;
 const clear=()=>{api.sample_clear();voices.clear();};
 const reset=()=>{api.sample_reset(rate);banks.clear();bankRates.clear();voices.clear();};reset();
 // A scheduled play acknowledges its logical handle now; hardware slots are
 // allocated only at its audio frame. Cancellation can remove an unstarted voice.
 function reserve(d,performance){
  const bank=banks.get(d.name);if(bank===undefined)throw new Error(`Unknown sample: ${d.name}`);
  const o=d.options;
  const step=Math.abs(o?.playbackRate)*(bankRates.get(d.name)/rate);
  if(!o||['playbackRate','gain','pan','offset','duration','loopStart','loopEnd','fadeIn','fadeOut'].some(key=>!Number.isFinite(o[key]))||
   o.playbackRate===0||o.offset<0||o.duration< -1||o.loopStart<0||o.loopEnd<0||o.fadeIn<0||o.fadeOut<0||
   !Number.isFinite(step)||step<=0)throw new Error('Invalid sample playback');
  if(nextVoice>=Number.MAX_SAFE_INTEGER)throw new Error('Native sample voice ID limit reached');
  const id=++nextVoice;voices.set(id,{slot:null,name:d.name,bank,options:o,
   owner:performance?.owner,session:performance?.session});return id;
 }
 function cancelReservation(id){if(voices.get(id)?.slot===null)voices.delete(id);}
 function startReserved(id){
  const voice=voices.get(id);if(!voice||voice.slot!==null)return;
  if(banks.get(voice.name)!==voice.bank){voices.delete(id);return;}
  let slot=0;while(slot<64&&api.sample_active(slot))slot++;
  if(slot===64){voices.delete(id);throw new Error('Native sample voice limit (64) reached');}
  for(const [oldId,v] of voices)if(v.slot===slot)voices.delete(oldId);
  const o=voice.options;
  if(!api.sample_play(slot,voice.bank,o.playbackRate,o.gain,o.pan,o.offset,o.duration,o.loop?1:0,o.loopStart,o.loopEnd,o.fadeIn,o.fadeOut)){
   voices.delete(id);throw new Error('Invalid sample playback');
  }
  voice.slot=slot;voice.options=null;
 }
 function stopOwner(owner,session){
  for(const [id,v] of voices)if(v.owner===owner&&v.session===session){
   if(v.slot===null)voices.delete(id);else api.sample_stop(v.slot);
  }
 }
 return {clear,reset,reserve,startReserved,cancelReservation,stopOwner,command(d){
  if(d.action==='load'){
   const {channels,sampleRate}=d.pcm;
   let slot=banks.get(d.name);if(slot===undefined){slot=0;while([...banks.values()].includes(slot))slot++;}
   if(slot>=64)throw new Error('Native sample bank limit (64) reached');
   const length=channels[0].length,ptr=api.sample_allocate(slot,length,channels.length,sampleRate);
   if(!ptr)throw new Error('Unable to allocate native sample bank');
   const data=new Float32Array(api.memory.buffer,ptr,length*channels.length);
   channels.forEach((ch,i)=>data.set(ch,i*length));
   for(const [id,v] of voices)if(v.name===d.name)voices.delete(id);
   banks.set(d.name,slot);bankRates.set(d.name,sampleRate);return;
  }
  if(d.action==='play'){
   const id=reserve(d);startReserved(id);return id;
  }
  if(d.action==='startReserved'){startReserved(d.voice);return;}
  if(d.action==='stopVoice'){const v=voices.get(d.voice);if(v){if(v.slot===null)voices.delete(d.voice);else api.sample_stop(v.slot);}return;}
  if(d.action==='stop'){for(const [id,v] of voices)if(d.name==null||d.name===v.name){if(v.slot===null)voices.delete(id);else api.sample_stop(v.slot);}return;}
  if(d.action==='clear'){clear();return;}
  if(d.action==='unload'){const slot=banks.get(d.name);if(slot!==undefined){api.sample_unload(slot);banks.delete(d.name);bankRates.delete(d.name);for(const [id,v] of voices)if(v.name===d.name)voices.delete(id);}return;}
 }};
}
