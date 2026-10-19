import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js';
/** Worker/Node: performance state and FM/PSG register generation.
 * No DOM, AudioNode or main-thread RPC. Observers are fire-and-forget.
 */
import {YM2612Synth} from './ym2612synth.js';
import {OPNFMSynth} from './opn_fm_synth.js?v=opna-primary-1';
import {YM2608Synth} from './ym2608synth.js?v=opna-primary-1';
import {createSegaPsgApi} from './segapsg_api.js';
/**
 * Create Worker-side FM/PSG controls that batch ordered writes to a Worklet port.
 * Stop cancels outstanding DAC requests and mutes hardware; resume permits new work.
 * @param {{port: MessagePort, capabilities: {chip?: 'ym2612' | 'ym2203' | 'ym2608' | 'ym2610', fmChannels?: number, psg?: boolean, dac?: boolean}, state?: {channels: object[], lfo: object, modeRegister?: number, dac?: object}, observe?: (event: {method: string, args: unknown[]}) => void}} options Port, chip capabilities, optional snapshot and observer.
 * @returns FM/PSG controls, raw synth state, write sender and lifecycle methods.
 */
export function createWorkerChip({port,capabilities,state,observe=()=>{}}){
 let enabled=false,batch=null;
 let requestId=0, stopped=false;
 let sampleController=new AbortController();
 const requests=new Map();
 port.onmessage=({data})=>{
  const pending=requests.get(data?.id);
  if(!pending||data.type!==pending.resultType)return;
  requests.delete(data.id);
  if(pending)data.error?pending.reject(new Error(data.error)):pending.resolve();
 };
 port.start?.();
 const mutedChannels=new Set();
 const send=command=>{if(enabled){if(batch)batch.push(command);else port.postMessage([command]);}};
 function request(command,resultType){
  if(stopped)return Promise.reject(new Error('Run stopped'));
  const id=++requestId;
  return new Promise((resolve,reject)=>{
   requests.set(id,{resolve,reject,resultType});
   try{
    if(command.type==='loadRhythmRom'||command.type==='loadAdpcmMemory')port.postMessage([{...command,id}]);
    else send({...command,id});
   }
   catch(error){requests.delete(id);reject(error);}
  });
 }
 const transport={
  dacCommand(command){return request({type:'pcm-dac',command},'pcm-dac-result');},
  loadAdpcmMemory(bytes,address){return request({type:'loadAdpcmMemory',bytes,address},'adpcm-memory-loaded');},
  loadRhythmRom(bytes){return request({type:'loadRhythmRom',bytes},'rhythm-rom-loaded');},
  write(port,register,value){
   send({type:'write',port,register,value});
   // Mirror only control registers, never sample payloads or caller objects.
   if(enabled&&name==='ym2608'&&((port===0&&register<0x20)||(port===1&&register<0x10)))observe({method:'write',args:[port,register,value]});
  },reset(){send({type:'reset'});}
 };
 const name=capabilities.chip??'ym2612';
 const raw=name==='ym2612'?new YM2612Synth({transport}):name==='ym2608'?new YM2608Synth({transport}):new OPNFMSynth({transport,chipName:name,channelCount:name==='ym2203'?3:6,portCount:name==='ym2203'?1:2,supportsPan:name!=='ym2203',supportsLfo:name!=='ym2203'});
 function adoptState(state){if(!state)return;if(state.clock!==undefined)raw._adoptClock(state.clock);raw.channels=structuredClone(state.channels);raw.lfo=structuredClone(state.lfo);raw._modeRegister=state.modeRegister??0;if(state.dac)Object.assign(raw.dac ??= {}, structuredClone(state.dac));
  for(const section of ['ssg','rhythm','adpcm']){
   if(section==='ssg'&&state.ssg?.registers&&raw.ssg){raw.ssg._adoptState(state.ssg);continue;}
   const values=state[section]?.registers??(section==='rhythm'?state.rhythm?.levels:null);
   if(values&&raw[section])for(const [register,value] of Array.from(values).entries())raw[section].observeWrite(section==='rhythm'?0x18+register:register,value);
  }
 }
 const onApplied=hz=>{if(raw.ssg)raw.ssg.clock=hz/4;if(raw.adpcm)raw.adpcm.clock=hz;};
 attachChipClock(raw, port, state?.clock ?? CHIP_CLOCKS[name], {primary:true,batch:true,onApplied});
 onApplied(raw.clock);
 adoptState(state);
 enabled=true;
 const channelMethods=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setModulation','setFrequency','setNote','setBlockFnum','noteOnRaw','keyOn','keyOff','noteOn','noteOff']);
 function invoke(method,args){
  if(typeof raw[method]!=='function'||method.startsWith('_')||['setHooks'].includes(method))throw new Error(`Unsupported fm method: ${method}`);
  const physical=args.slice();
  if(name==='ym2610'&&channelMethods.has(method)){physical[0]=[1,2,4,5][args[0]];if(physical[0]===undefined)throw new Error('Neo Geo FM channel must be 0..3');}
  batch=[];
  let result;
  try{
   if((method==='noteOn'||method==='noteOnRaw'||method==='keyOn') && mutedChannels.delete(physical[0])) {
    // Stop mutes the device immediately without destroying the saved patch.
    raw.channels[physical[0]].operators.forEach((operator,index)=>raw.setOperator(physical[0],index,{tl:operator.tl}));
   }
   result=raw[method](...physical);
  }finally{const commands=batch;batch=null;if(commands.length)port.postMessage(commands);}
  if (method === 'setClock') return result.then(() => observe({method,args:structuredClone(args)}));
  observe({method,args:structuredClone(args)});
  return result;
 }
 const sections={};
 for(const section of ['ssg','rhythm','adpcm'])if(raw[section]){
  sections[section]=Object.fromEntries(Object.getOwnPropertyNames(Object.getPrototypeOf(raw[section]))
   .filter(method=>!method.startsWith('_')&&!['constructor','resetState','observeWrite'].includes(method))
   .map(method=>[method,(...args)=>{
    if(section==='rhythm'&&method==='loadRom'&&args[0] instanceof ArrayBuffer)args[0]=new Uint8Array(args[0]);
    if(section==='adpcm'&&method==='loadSample'){
     const options=args[1]??{};
     args[1]={...options,signal:options.signal?AbortSignal.any([options.signal,sampleController.signal]):sampleController.signal};
    }
    batch=[];
    try{return raw[section][method](...args);}
    finally{const commands=batch;batch=null;if(commands.length)port.postMessage(commands);if(section==='ssg')observe({method:'ssgState',args:[raw.ssg._getState()]});}
   }]));
 }
 const fm=new Proxy({}, {get:(_t,method)=> method==='clock'?raw.clock:method==='dac'?raw.dac:sections[method]??((...args)=>invoke(String(method),args))});
 const psg=capabilities.psg?createSegaPsgApi({write:value=>send({type:'psg-write',value}),reset:()=>send({type:'psg-reset'}),resetAll:()=>fm.reset()}):null;
 return {fm,psg,...sections,raw,send,adoptState,
  resume(){stopped=false;if(sampleController.signal.aborted)sampleController=new AbortController();},
  write(...args){if(args.length===2)return fm.write(0,...args);if(args.length===3)return fm.write(...args);throw new Error('write expects register,value or port,register,value');},
  stop(){
   stopped=true;raw._cancelClockRequests('Run stopped');
   sampleController.abort(new DOMException('Run stopped','AbortError'));
   for(const pending of requests.values())pending.reject(new Error('Run stopped'));
   requests.clear();
   send({type:'clear-scheduled-writes'});send({type:'clear-dac-playback'});
   for(let ch=0;ch<(capabilities.fmChannels??6);ch++){
    fm.noteOff(ch);
    const physical=name==='ym2610'?[1,2,4,5][ch]:ch;
    mutedChannels.add(physical);
    for(let op=0;op<4;op++)send({type:'write',port:Math.floor(physical/3),register:0x40+op*4+physical%3,value:127});
   }
   if(capabilities.dac)fm.setDacEnabled(false);
   psg?.reset();
   if(raw.ssg){for(let channel=0;channel<3;channel++)raw.ssg.keyOff(channel);observe({method:'ssgState',args:[raw.ssg._getState()]});}
   raw.rhythm?.keyOff([0,1,2,3,4,5]);
   raw.adpcm?.keyOff();
  },
 };
}
