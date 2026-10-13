/** Shared native DSP: no AudioContext, AudioWorklet or DOM dependency. */
import {LiveFX} from './custom_fx.js';
import {createSampleProcessor} from './native_sample_processor.js';
import {setChain} from './native_fx_graph.js';
import {FX_TYPES} from './native_fx.js';

const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const throwProcessError=error=>{throw new Error(error);};
function setExtra(api,type,slot,param,value){
 if(!api.extra_set(FX_TYPES[type],slot,param,value))throw new Error(`Invalid native ${type} parameter ${param}`);
}

export class NativeFXEngine {
 constructor(module, sampleRate) {
  if(!Number.isInteger(sampleRate)||sampleRate<=0)throw new RangeError('Invalid native FX sample rate');
  this.sampleRate=sampleRate;
  this.liveFX=new LiveFX(sampleRate);
  this.api=new WebAssembly.Instance(module,{env:{emscripten_notify_memory_growth(){}}}).exports;
  this.api._initialize?.();this.api.graph_reset(sampleRate);this.api.noise_reset(sampleRate);
  this.capacity=this.api.gain_capacity();this.gainRampFrames=Math.round(sampleRate*.005);
  this.noiseTokens=new Map();this.samples=createSampleProcessor(this.api,sampleRate);
  this.units=new Map();this.ramps=new Map();this.beatSeconds=.5;setChain(this.api,[]);
 }
 resetNoise(){this.api.noise_reset(this.sampleRate);this.noiseTokens.clear();}
 reset(){this.liveFX.clear();this.ramps.clear();this.units.clear();this.api.graph_reset(this.sampleRate);setChain(this.api,[]);}
 command(d){
  if(d.op==='live-fx'){this.liveFX.command(d);return;}
  if(d.op==='noise'){
   const a=this.api,s=d.slot;
   if(d.action==='create'){if(!a.noise_create(s,d.type,d.seed))throw new Error('Invalid noise voice');this.noiseTokens.set(s,d.token);return;}
   if(this.noiseTokens.get(s)!==d.token)return;
   if(d.action==='parameter'){if(!a.noise_set(s,d.param,d.value,Math.round(d.seconds*this.sampleRate)))throw new Error('Invalid noise parameter');}
   else if(d.action==='filter')a.noise_filter(s,d.mode);
   else {const action={start:0,stop:1,dispose:2}[d.action];if(action!==undefined)a.noise_action(s,action);if(d.action==='dispose')this.noiseTokens.delete(s);}
   return;
  }
  if(d.beatSeconds>0)this.beatSeconds=d.beatSeconds;
  if(d.op==='reset'){this.reset();return;}
  if(d.op==='clear'){this.api.graph_clear();return;}
  if(d.op==='tempo'){for(const u of this.units.values())this.apply(u);return;}
  if(d.op==='chain'){
   setChain(this.api,d.children);
   for(const u of d.units){const id=u.type+u.slot;if(!this.units.has(id))this.units.set(id,u);this.apply(this.units.get(id));}return;
  }
  if(d.op==='create'){
   const {type,slot}=d.unit; const id=type+slot;
   for(const key of this.ramps.keys())if(key.startsWith(id+':'))this.ramps.delete(key);
   if(FX_TYPES[type]>=7)this.api.extra_reset_slot(FX_TYPES[type],slot);
   else if(type!=='gain'){this.api[type+'_select'](slot);this.api[type+'_reset'](this.sampleRate);}
   this.units.set(d.unit.type+d.unit.slot,d.unit);this.apply(d.unit);return;}
  if(d.op==='parameter'){
   const id=d.unit.type+d.unit.slot;const u=this.units.get(id);if(!u)return;
   const key=id+':'+d.key;this.ramps.delete(key);
   if(d.seconds>0)this.ramps.set(key,{mapKey:key,u,key:d.key,start:u.values[d.key],end:d.value,elapsed:0,total:Math.max(1,Math.round(d.seconds*this.sampleRate))});
   else{u.values[d.key]=d.value;if(u.type==='reverb'&&d.key==='tone')u.values.damping=1-(d.value-200)/19800;this.apply(u);}return;
  }
 }
 apply({type,slot,values:v}){
  const a=this.api;
  if(type==='gain'){a.gain_select(slot);a.gain_set(v.gain,this.gainRampFrames);return;}
  if(type==='eq'){a.eq_select(slot);a.eq_set(0,v.bass);a.eq_set(1,v.mid);a.eq_set(2,v.treble);return;}
  if(type==='gate'){a.gate_select(slot);a.gate_set(20*Math.log10(v.threshold),v.hysteresis,v.attack*1000,v.hold*1000,v.release*1000,0);return;}
  if(type==='compressor'){a.compressor_select(slot);a.compressor_set(v.threshold,v.ratio,v.attack*1000,v.release*1000,v.makeup,0);return;}
  if(type==='reverb'){a.reverb_select(slot);a.reverb_set(v.mix,v.room,v.damping);return;}
  // Ramps call this on every audio quantum. Build only the requested controls:
  // constructing arrays for every FX here caused steady audio-thread garbage.
  switch(type){
   case 'filter':setExtra(a,type,slot,0,v.cutoff);setExtra(a,type,slot,1,v.q);setExtra(a,type,slot,2,v.mode);break;
   case 'delay':setExtra(a,type,slot,0,v.time*1000);setExtra(a,type,slot,1,v.feedback);break;
   case 'distortion':setExtra(a,type,slot,0,v.drive);break;
   case 'bitcrusher':setExtra(a,type,slot,0,v.bitDepth);setExtra(a,type,slot,1,clamp(this.sampleRate/v.holdFrames,100,this.sampleRate));break;
   case 'wobble':setExtra(a,type,slot,0,v.cutoff);setExtra(a,type,slot,1,clamp(Math.log2(1+v.depth/v.cutoff),0,4));setExtra(a,type,slot,2,clamp(1/(v.rate*this.beatSeconds),.05,20));setExtra(a,type,slot,3,v.resonance);break;
   case 'flanger':setExtra(a,type,slot,0,v.time*1000);setExtra(a,type,slot,1,v.depth*1000);setExtra(a,type,slot,2,clamp(1/(v.rate*this.beatSeconds),.05,10));setExtra(a,type,slot,3,v.feedback);break;
   case 'slicer':setExtra(a,type,slot,0,clamp(1/(v.phase*this.beatSeconds),.05,30));setExtra(a,type,slot,1,v.duty);setExtra(a,type,slot,2,v.floor);break;
   case 'chorus':setExtra(a,type,slot,0,v.time*1000);setExtra(a,type,slot,1,v.depth*1000);setExtra(a,type,slot,2,clamp(1/(v.rate*this.beatSeconds),.05,10));break;
   default:throw new Error(`Unknown native FX: ${type}`);
  }
  a.extra_set(FX_TYPES[type],slot,6,v.mix??1);a.extra_set(FX_TYPES[type],slot,7,0);
 }
 process(source,target,onError=throwProcessError,observe) {
  const a=this.api,n=target[0]?.length;
  if(!Number.isInteger(n)||n>this.capacity||target.length!==2||target[1].length!==n)throw new RangeError('Invalid native FX stereo block');
  for(let c=0;c<source.length;c++)if(source[c].length!==n)throw new RangeError('Native FX input/output lengths differ');
  for(const r of this.ramps.values()){r.elapsed=Math.min(r.total,r.elapsed+n);r.u.values[r.key]=r.start+(r.end-r.start)*r.elapsed/r.total;
   if(r.u.type==='reverb'&&r.key==='tone')r.u.values.damping=1-(r.u.values.tone-200)/19800;
   this.apply(r.u);if(r.elapsed===r.total)this.ramps.delete(r.mapKey);
  }
  const cap=this.capacity;
  if(!this.input||this.input.buffer!==a.memory.buffer){
   this.input=new Float32Array(a.memory.buffer,a.gain_input(),cap*2);this.output=new Float32Array(a.memory.buffer,a.gain_output(),cap*2);
   this.outputLeft=null;
  }
  if(!this.outputLeft||this.outputLeft.length!==n){
   this.outputLeft=this.output.subarray(0,n);this.outputRight=this.output.subarray(cap,cap+n);
  }

  for(let c=0;c<2;c++){const ch=source[c]??source[0];if(ch)this.input.set(ch,c*cap);else this.input.fill(0,c*cap,c*cap+n);}
  a.noise_mix(n);a.sample_mix(n);a.graph_process(n);target[0].set(this.outputLeft);target[1].set(this.outputRight);
  this.liveFX.process(target,onError,observe);
 }
}
