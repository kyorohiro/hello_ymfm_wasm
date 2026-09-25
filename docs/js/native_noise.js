/** Browser / Worker / Node: native noise controls; no AudioNode dependency.
 * get() returns the requested target, including while a native ramp is running.
 */
const types=['white','pink','brown','gray','clip'];
const modes=['lowpass','highpass','bandpass','notch','allpass','peaking','lowshelf','highshelf'];
const params={gain:[0,.3,0,8],pan:[1,0,-1,1],cutoff:[2,1600,10,20000],q:[3,.2,.0001,1000],attack:[4,0,0,60],release:[5,0,0,60]};
export function createNativeNoiseController(send){
 const voices=new Map();let sequence=1;
 const api={
  create(options={}){
   let slot=0;while(voices.has(slot))slot++;
   if(slot>=32)throw new Error('Native noise supports at most 32 voices; dispose unused voices');
   const token=sequence++,type=types.includes(options.type)?options.type:'white';
   let disposed=false;
   const emit=(action,data={})=>{if(disposed)throw new Error('noise voice has already been disposed');send({op:'noise',action,slot,token,...data});};
   emit('create',{type:types.indexOf(type),seed:options.seed??((Math.random()*0xffffffff)>>>0)});
   const controls={};
   for(const [key,[param,fallback,min,max]] of Object.entries(params)){
    let value=fallback;
    const set=(next,seconds=0)=>{next=Number(next);seconds=Number(seconds);if(!Number.isFinite(next)||!Number.isFinite(seconds)||seconds<0)throw new Error(`Invalid noise ${key}`);value=Math.max(min,Math.min(max,next));emit('parameter',{param,value,seconds});return value;};
    controls[key]={get:()=>value,set:next=>set(next),rampTo:set};
   }
   const voice={type,gain:controls.gain,pan:controls.pan,attack:controls.attack,release:controls.release,
    filter:{cutoff:controls.cutoff,q:controls.q,set(mode,frequency,q=controls.q.get()){
     const index=modes.indexOf(mode);if(index<0)throw new Error(`Unsupported noise filter: ${mode}`);
     controls.cutoff.set(frequency);controls.q.set(q);emit('filter',{mode:index});
    }},
    start:()=>emit('start'),stop:()=>emit('stop'),
    dispose(){if(disposed)return;emit('dispose');disposed=true;voices.delete(slot);},
   };
   voices.set(slot,voice);
   try{for(const key of ['gain','pan','attack','release'])if(options[key]!=null)controls[key].set(options[key]);if(options.autoStart!==false)voice.start();}
   catch(e){voice.dispose();throw e;}
   return voice;
  },
  stopAll(){for(const voice of voices.values())voice.stop();},
  disposeAll(){for(const voice of [...voices.values()])voice.dispose();},
 };
 return api;
}
export function controlNativeNoise(voice,options={}){
 const slide=Math.max(0,Number(options.slide)||0);
 for(const [key,param] of [['gain',voice.gain],['pan',voice.pan],['cutoff',voice.filter.cutoff],['q',voice.filter.q]]){
  if(options[key]!=null)param.rampTo(options[key],slide);
 }
}
