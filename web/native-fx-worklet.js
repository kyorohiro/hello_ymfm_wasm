/** Browser AudioWorklet: one WASM graph for all Playground FX. */
import {createSampleProcessor} from './native_sample_processor.js';
import {setChain} from './native_fx_graph.js';
import {FX_TYPES} from './native_fx.js';
export class NativeFXProcessor extends AudioWorkletProcessor {
 constructor(options){
  super();this.api=new WebAssembly.Instance(options.processorOptions.module,{env:{emscripten_notify_memory_growth(){}}}).exports;
  this.api._initialize?.();this.api.graph_reset(sampleRate);this.api.noise_reset(sampleRate);this.noiseTokens=new Map();this.samples=createSampleProcessor(this.api,sampleRate);setChain(this.api,[]);
  this.units=new Map();this.ramps=new Map();this.beatSeconds=.5;this.active=true;
  this.port.onmessage=({data})=>{
   if(data.op==='attach'){
    this.controlPort?.close();this.controlPort=data.port;this.active=false;
    this.samples.reset();this.resetNoise();this.reset();const port=this.controlPort;port.onmessage=({data})=>{if(this.controlPort===port)this.receive(data);};port.start();
   }else if(data.op==='main'){this.controlPort?.close();this.controlPort=null;this.active=true;this.samples.reset();this.resetNoise();this.reset();}
   else if(data.op==='emergency'){this.samples.clear();this.resetNoise();setChain(this.api,[]);this.api.graph_clear();this.ramps.clear();}
   else if(this.active)this.receive(data);
  };
 }
 resetNoise(){this.api.noise_reset(sampleRate);this.noiseTokens.clear();}
 reset(){this.ramps.clear();this.units.clear();this.api.graph_reset(sampleRate);setChain(this.api,[]);}
 receive(data){try{if(data.op==='sample'){const value=this.samples.command(data);if(data.id)(this.controlPort??this.port).postMessage({op:'sample-response',id:data.id,value});return;}this.command(data);}catch(e){if(data.op==='sample'&&data.id)(this.controlPort??this.port).postMessage({op:'sample-response',id:data.id,error:e.message});else this.port.postMessage({error:e.message});}}
 command(d){
  if(d.op==='noise'){
   const a=this.api,s=d.slot;
   if(d.action==='create'){if(!a.noise_create(s,d.type,d.seed))throw new Error('Invalid noise voice');this.noiseTokens.set(s,d.token);return;}
   if(this.noiseTokens.get(s)!==d.token)return;
   if(d.action==='parameter'){if(!a.noise_set(s,d.param,d.value,Math.round(d.seconds*sampleRate)))throw new Error('Invalid noise parameter');}
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
   else if(type!=='gain'){this.api[type+'_select'](slot);this.api[type+'_reset'](sampleRate);}
   this.units.set(d.unit.type+d.unit.slot,d.unit);this.apply(d.unit);return;}
  if(d.op==='parameter'){
   const id=d.unit.type+d.unit.slot;const u=this.units.get(id);if(!u)return;
   const key=id+':'+d.key;this.ramps.delete(key);
   if(d.seconds>0)this.ramps.set(key,{u,key:d.key,start:u.values[d.key],end:d.value,elapsed:0,total:Math.max(1,Math.round(d.seconds*sampleRate))});
   else{u.values[d.key]=d.value;if(u.type==='reverb'&&d.key==='tone')u.values.damping=1-(d.value-200)/19800;this.apply(u);}return;
  }
 }
 apply({type,slot,values:v}){
  const a=this.api;const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
  const hz=(beats,max)=>clamp(1/(beats*this.beatSeconds),.05,max);
  if(type==='gain'){a.gain_select(slot);a.gain_set(v.gain,Math.round(sampleRate*.005));return;}
  if(type==='eq'){a.eq_select(slot);[v.bass,v.mid,v.treble].forEach((db,i)=>a.eq_set(i,db));return;}
  if(type==='gate'){a.gate_select(slot);a.gate_set(20*Math.log10(v.threshold),v.hysteresis,v.attack*1000,v.hold*1000,v.release*1000,0);return;}
  if(type==='compressor'){a.compressor_select(slot);a.compressor_set(v.threshold,v.ratio,v.attack*1000,v.release*1000,v.makeup,0);return;}
  if(type==='reverb'){a.reverb_select(slot);a.reverb_set(v.mix,v.room,v.damping);return;}
  const params={filter:[v.cutoff,v.q,v.mode],delay:[v.time*1000,v.feedback],distortion:[v.drive],bitcrusher:[v.bitDepth,clamp(sampleRate/v.holdFrames,100,sampleRate)],wobble:[v.cutoff,clamp(Math.log2(1+v.depth/v.cutoff),0,4),hz(v.rate,20),v.resonance],flanger:[v.time*1000,v.depth*1000,hz(v.rate,10),v.feedback],slicer:[hz(v.phase,30),v.duty,v.floor],chorus:[v.time*1000,v.depth*1000,hz(v.rate,10)]}[type];
  params.forEach((x,i)=>{if(!a.extra_set(FX_TYPES[type],slot,i,x))throw new Error(`Invalid native ${type} parameter ${i}`);});
  a.extra_set(FX_TYPES[type],slot,6,v.mix??1);a.extra_set(FX_TYPES[type],slot,7,0);
 }
 process(inputs,outputs){
  const a=this.api,target=outputs[0];if(!target?.length)return true;const n=target[0].length;
  for(const [key,r] of this.ramps){r.elapsed=Math.min(r.total,r.elapsed+n);r.u.values[r.key]=r.start+(r.end-r.start)*r.elapsed/r.total;
   if(r.u.type==='reverb'&&r.key==='tone')r.u.values.damping=1-(r.u.values.tone-200)/19800;
   this.apply(r.u);if(r.elapsed===r.total)this.ramps.delete(key);
  }
  const cap=a.gain_capacity();if(!this.input||this.input.buffer!==a.memory.buffer){this.input=new Float32Array(a.memory.buffer,a.gain_input(),cap*2);this.output=new Float32Array(a.memory.buffer,a.gain_output(),cap*2);}
  const source=inputs[0]??[];
  for(let c=0;c<2;c++){const ch=source[c]??source[0];if(ch)this.input.set(ch,c*cap);else this.input.fill(0,c*cap,c*cap+n);}
  a.noise_mix(n);a.sample_mix(n);a.graph_process(n);for(let c=0;c<target.length;c++)target[c].set(this.output.subarray(c*cap,c*cap+n));return true;
 }
}
registerProcessor('tetorica-native-fx',NativeFXProcessor);
