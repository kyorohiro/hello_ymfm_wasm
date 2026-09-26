/**
 * @file Native FX descriptors and controls. Browser main thread or Worker;
 * no DOM or AudioNode dependency. The injected sender owns transport.
 * Slots are private to a controller; activate one controller at a time per rack.
 */
export const FX_TYPES = {gain:2, eq:3, gate:4, compressor:5, reverb:6, filter:7, delay:8, distortion:9, bitcrusher:10, wobble:11, flanger:12, slicer:13, chorus:14};
// [default, minimum, maximum]. Times use seconds; modulation periods use beats.
export const FX_PARAMS = {
 gain:{gain:[1,0,10]}, eq:{bass:[0,-12,12],mid:[0,-12,12],treble:[0,-12,12]},
 gate:{threshold:[0.04,0.0001,1],hysteresis:[6,0,24],attack:[.005,.0001,.2],hold:[.05,0,1],release:[.1,.01,2]},
 compressor:{threshold:[-24,-60,0],ratio:[4,1,20],attack:[.01,.0001,.2],release:[.25,.01,2],makeup:[0,-12,24]},
 reverb:{mix:[.2,0,1],room:[.7,0,.98],damping:[.4,0,1],tone:[7200,200,20000]},
 filter:{cutoff:[1200,20,20000],q:[.707,.2,12]},
 delay:{time:[.25,.001,2],feedback:[.35,0,.9],mix:[.3,0,1]},
 distortion:{drive:[4,1,20],mix:[.5,0,1]},
 bitcrusher:{bitDepth:[8,2,16],holdFrames:[6,1,480],mix:[.5,0,1]},
 wobble:{cutoff:[800,20,10000],depth:[1100,0,12000],rate:[.5,.03125,16],resonance:[.707,.2,8],mix:[1,0,1]},
 flanger:{time:[.003,.001,.015],depth:[.002,0,.01],rate:[1,.03125,16],feedback:[.3,0,.9],mix:[.5,0,1]},
 slicer:{phase:[.25,.03125,16],duty:[.5,.05,.95],floor:[0,0,1],mix:[1,0,1]},
 chorus:{time:[.02,.01,.04],depth:[.005,0,.01],rate:[1,.03125,16],mix:[.5,0,1]},
};
export function createNativeFXController(send, {getBeatSeconds=()=>.5}={}) {
 const units=new Set(); const slots={}; let chain=[];
 const contains=(root,u)=>root===u || (root.children??[]).some(c=>contains(c,u));
 const snapshot=u=>({type:u.type,slot:u.slot,values:{...u.values}});
 const parameter=(u,key,value,seconds=0)=>{
  if(!units.has(u)) throw new Error('FX has been disposed');
  if(!Number.isFinite(value)||!Number.isFinite(seconds)||seconds<0) throw new Error('Invalid FX parameter');
  const [,lo,hi]=FX_PARAMS[u.type][key]; value=Math.max(lo,Math.min(hi,value));
  u.values[key]=value;
  if(u.type==='reverb'&&key==='tone')u.values.damping=1-(value-200)/19800;
  send({op:'parameter',unit:snapshot(u),key,value,seconds,beatSeconds:getBeatSeconds()}); return value;
 };
 function descriptor(u,seen=new Set()) {
  if(!u||u.owner!==api) throw new Error('FX belongs to another rack');
  if(seen.has(u)) throw new Error('FX cannot be reused in a chain'); seen.add(u);
  if(u.children) return {type:u.type,children:u.children.map(c=>descriptor(c,seen))};
  if(!units.has(u)) throw new Error('FX has been disposed');
  return {type:u.type,slot:u.slot};
 }
 const copyContext=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('context must be an object');
  return structuredClone(value);
 };
 const api={
  liveFx(name,{process,context={},resetState=false}={}){
   if(typeof name!=='string'||!name)throw new Error('liveFx requires a name');
   if(typeof process!=='function'||process.constructor.name!=='Function')throw new Error('process must be synchronous');
   send({op:'live-fx',action:'register',name,source:Function.prototype.toString.call(process),context:copyContext(context),resetState});
  },
  updateContext(name,context){send({op:'live-fx',action:'context',name,context:copyContext(context)});},
  removeLiveFx(name){send({op:'live-fx',action:'remove',name});},

  branch:(...children)=>({type:'chain',children,owner:api,dispose(){for(const u of children)u.dispose?.();}}),
  parallel:(...children)=>({type:'parallel',children,owner:api,dispose(){for(const u of children)u.dispose?.();}}),
  setChain(effects=[]){
   if(!Array.isArray(effects)) throw new Error('FX chain must be an array');
   const seen=new Set(); const children=effects.map(u=>descriptor(u,seen));
   if(seen.size+1>32) throw new Error('Native FX maximum is 32 graph nodes');
   for(const u of seen) if(u.type==='parallel'&&!u.children.length) throw new Error('Empty parallel FX');
   send({op:'chain',children,units:[...units].map(snapshot),beatSeconds:getBeatSeconds()}); chain=effects.slice();return effects;
  },
  clear({dispose=false}={}){ const previous=chain; api.setChain([]);send({op:'clear'});if(dispose) api.dispose();return previous; },
  dispose(){send({op:'reset'});units.clear();for(const k of Object.keys(slots)) delete slots[k];chain=[];},
  getChain(){return chain.slice();},
  syncTempo(){send({op:'tempo',beatSeconds:getBeatSeconds()});},
 };
 for(const type of Object.keys(FX_TYPES)) api[type]=(options={})=>{
  for(const key of Object.keys(options)) if(!(key in FX_PARAMS[type]) && !(type==='filter'&&key==='type')) throw new Error(`Unsupported native ${type} option: ${key}`);
  const allocated=slots[type]??=new Set(); let slot=0;while(allocated.has(slot)) slot++;
  if(slot>=8) throw new Error(`Native FX supports at most 8 ${type} instances; dispose unused effects`);
  if(type==='filter'&&!['lowpass','highpass','bandpass'].includes(options.type??'lowpass')) throw new Error('Native filter supports lowpass, highpass and bandpass');
  const u={type,slot,owner:api,values:{},params:{},dispose(){if(chain.some(root=>contains(root,u))) throw new Error('Detach FX before disposing');units.delete(u);allocated.delete(slot);}};
  for(const [key,[def,lo,hi]] of Object.entries(FX_PARAMS[type])) {
   const value=options[key]??def;if(!Number.isFinite(value)) throw new Error(`Invalid ${type}.${key}`);
   u.values[key]=Math.max(lo,Math.min(hi,value));
   u[key]=u.params[key]={get:()=>u.values[key],set:value=>parameter(u,key,value),rampTo:(value,seconds=.02)=>parameter(u,key,value,seconds)};
  }
  if(type==='filter') u.values.mode=['lowpass','highpass','bandpass'].indexOf(options.type??'lowpass');
  if(type==='reverb' && options.tone!=null && options.damping==null) u.values.damping=1-(u.values.tone-200)/19800;
  allocated.add(slot);units.add(u);send({op:'create',unit:snapshot(u),beatSeconds:getBeatSeconds()});return u;
 };
 return api;
}
