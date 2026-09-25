/** Browser/Worker PCM playback controls. Loading/decoding is injected separately.
 * AudioWorklet acknowledges preparation directly; playback never needs a UI reply.
 */
export function createNativeSampleController(send){
 const banks=new Map(),pending=new Map();let sequence=0;
 const request=(action,data)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});send({op:'sample',action,id,...data});});
 const message=(action,data={})=>send({op:'sample',action,...data});
 const finite=(v,fallback)=>{const n=Number(v??fallback);if(!Number.isFinite(n))throw new Error('Invalid sample parameter');return n;};
 return {
  accept(d){if(d.op!=='sample-response')return;const p=pending.get(d.id);if(!p)return;pending.delete(d.id);if(d.error)p.reject(new Error(d.error));else p.resolve(d.value);},
  async load(name,pcm){
   if(!pcm||!(pcm.sampleRate>0)||!pcm.channels?.length||pcm.channels.length>2)throw new Error('Expected mono or stereo PCM');
   const length=pcm.channels[0].length;
   if(!length||pcm.channels.some(c=>c.length!==length||!c.every(Number.isFinite)))throw new Error('Invalid PCM samples');
   await request('load',{name,pcm});
   const info={name,length,sampleRate:pcm.sampleRate,numberOfChannels:pcm.channels.length,duration:length/pcm.sampleRate};banks.set(name,info);return info;
  },
  async play(name,options={}){
   if(!banks.has(name))throw new Error(`Unknown sample: ${name}`);
   const normalized={};
   for(const [key,value] of Object.entries({playbackRate:1,gain:1,pan:0,offset:0,duration:-1,loopStart:0,loopEnd:0,fadeIn:0,fadeOut:0}))normalized[key]=finite(options[key],value);
   if(normalized.playbackRate<=0)throw new Error('Native sample playbackRate must be positive');
   for(const key of ['offset','loopStart','loopEnd','fadeIn','fadeOut'])normalized[key]=Math.max(0,normalized[key]);
   normalized.duration=options.duration==null?-1:Math.max(0,normalized.duration);normalized.loop=options.loop===true;
   const voice=await request('play',{name,options:normalized});
   return {name,stop:()=>message('stopVoice',{voice})};
  },
  stop(name){message('stop',{name});},stopAll(){for(const p of pending.values())p.reject(new Error('Sample playback stopped'));pending.clear();message('clear');},
  unload(name){message('unload',{name});return banks.delete(name);},
  isLoaded:name=>banks.has(name),get:name=>banks.get(name)??null,list:()=>[...banks.keys()],
  invalidate(){banks.clear();for(const p of pending.values())p.reject(new Error('Sample playback reset'));pending.clear();},
 };
}
/** Convert a decoded AudioBuffer into copyable planar PCM without detaching it. */
export function samplePCM(buffer){
 if(buffer.numberOfChannels>2)throw new Error('Native sample playback supports mono/stereo audio');
 return {sampleRate:buffer.sampleRate,channels:Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i))};
}
