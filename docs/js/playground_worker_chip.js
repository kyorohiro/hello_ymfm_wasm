import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
/** Worker/Node: selected-primary performance state and register generation.
 * No DOM, AudioNode or main-thread RPC. Observers are fire-and-forget.
 */
import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
import {createPrimaryGameboyApi} from './playground_gameboy.js?v=native-extra-levels-1';
import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {YM2203Synth} from './ym2203synth.js?v=native-extra-levels-1';
import {OPNFMSynth} from './opn_fm_synth.js?v=audio-stability-2';
import {YM2608Synth} from './ym2608synth.js?v=native-extra-levels-1';
import {YM2610BSynth} from './ym2610bsynth.js?v=native-extra-levels-1';
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
/**
 * Create Worker-side primary controls that send ordered writes to a Worklet port.
 * Stop cancels outstanding DAC requests and mutes hardware; resume permits new work.
 * @param {{port: MessagePort, capabilities: {backend?:string,chip?: 'ym2612' | 'ym2203' | 'ym2608' | 'ym2610' | 'ym2610b' | 'gameboy', fmChannels?: number, psg?: boolean, dac?: boolean}, state?: {clock?:number, channels?:object[], lfo?:object, modeRegister?:number, dac?:object, initialized?:boolean, registers?:number[], voice?:number[]}, observe?: (event: {method: string, args: unknown[]}) => void}} options Port, chip capabilities, optional snapshot and observer.
 * @returns Selected primary controls, raw synth state, write sender and lifecycle methods.
 */
export function createWorkerChip({port,capabilities,state,observe=()=>{}}){
 if(capabilities.chip==='gameboy')return createWorkerGameboy({port,state,observe});
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
  loadAdpcmMemory(...args){
   const [memoryType,bytes,address]=name==='ym2608'?[undefined,...args]:args;
   return request({type:'loadAdpcmMemory',...(memoryType===undefined?{}:{memoryType}),bytes,address},'adpcm-memory-loaded');
  },
  loadRhythmRom(bytes){return request({type:'loadRhythmRom',bytes},'rhythm-rom-loaded');},
  write(port,register,value){
   send({type:'write',port,register,value});
   // Mirror only control registers, never sample payloads or caller objects.
   const sectionWrite=name==='ym2203'?(port===0&&register<16):name==='ym2608'?((port===0&&register<0x20)||(port===1&&register<0x10)):
    ['ym2610','ym2610b'].includes(name)&&((port===0&&register<0x20)||(port===1&&register<0x30));
   if(enabled&&sectionWrite)observe({method:'write',args:[port,register,value]});
  },reset(){send({type:'reset'});}
 };
 const name=capabilities.chip??'ym2612';
 const raw=name==='ym2612'?new YM2612Synth({transport}):name==='ym2203'?new YM2203Synth({transport}):name==='ym2608'?new YM2608Synth({transport}):['ym2610','ym2610b'].includes(name)?new YM2610BSynth({transport}):new OPNFMSynth({transport,chipName:name,channelCount:6,portCount:2,supportsPan:true,supportsLfo:true});
 const sectionNames=raw.adpcmA?['ssg','adpcmA','adpcmB']:['ssg','rhythm','adpcm'];
 function retainedLevels(){return name==='ym2203'&&capabilities.backend==='native-genesis'?raw.ssg._getState().levels:null;}
 function retainLevels(before){if(!before)return;const after=raw.ssg._getState().levels;for(let channel=0;channel<3;channel++)if(before[channel]!==after[channel])send({type:'ssg-retained-level',channel,level:after[channel]});}
 function adoptState(state){if(!state)return;if(state.clock!==undefined)raw._adoptClock(state.clock);raw.channels=structuredClone(state.channels);raw.lfo=structuredClone(state.lfo);raw._modeRegister=state.modeRegister??0;if(state.dac)Object.assign(raw.dac ??= {}, structuredClone(state.dac));
  for(const section of sectionNames){
   if(section==='ssg'&&state.ssg?.registers&&raw.ssg){raw.ssg._adoptState(state.ssg);continue;}
   const values=state[section]?.registers??state[section]?.levels??(section==='adpcmB'?state.adpcm?.registers:null);
   const offset=section==='rhythm'?0x18:section==='adpcmA'?8:0;
   if(values&&raw[section])for(const [register,value] of Array.from(values).entries())raw[section].observeWrite(offset+register,value);
  }
 }
 const onApplied=hz=>{if(raw.ssg)raw.ssg.clock=hz/(name==='ym2203'?2:4);if(raw.adpcmB)raw.adpcmB.clock=hz;else if(raw.adpcm)raw.adpcm.clock=hz;};
 attachChipClock(raw, port, state?.clock ?? CHIP_CLOCKS[name], {primary:true,batch:true,onApplied});
 onApplied(raw.clock);
 adoptState(state);
 enabled=true;
 const channelMethods=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setModulation','setFrequency','setNote','setBlockFnum','noteOnRaw','keyOn','keyOff','noteOn','noteOff']);
 function invoke(method,args){
  if(typeof raw[method]!=='function'||method.startsWith('_')||['setHooks'].includes(method))throw new Error(`Unsupported fm method: ${method}`);
  const physical=args.slice();
  if(name==='ym2610'&&channelMethods.has(method)){physical[0]=[1,2,4,5][args[0]];if(physical[0]===undefined)throw new Error('Neo Geo FM channel must be 0..3');}
  const levels=retainedLevels();batch=[];
  let result;
  try{
   if((method==='noteOn'||method==='noteOnRaw'||method==='keyOn') && mutedChannels.delete(physical[0])) {
    // Stop mutes the device immediately without destroying the saved patch.
    raw.channels[physical[0]].operators.forEach((operator,index)=>raw.setOperator(physical[0],index,{tl:operator.tl}));
   }
   result=raw[method](...physical);
  }finally{retainLevels(levels);const commands=batch;batch=null;if(commands.length)port.postMessage(commands);}
  if (method === 'setClock') return result.then(() => observe({method,args:structuredClone(args)}));
  observe({method,args:structuredClone(args)});
  return result;
 }
 const sections={};
 for(const section of sectionNames)if(raw[section]){
  sections[section]=Object.fromEntries(Object.getOwnPropertyNames(Object.getPrototypeOf(raw[section]))
   .filter(method=>!method.startsWith('_')&&!['constructor','resetState','observeWrite'].includes(method))
   .map(method=>[method,(...args)=>{
    if(section==='rhythm'&&method==='loadRom'&&args[0] instanceof ArrayBuffer)args[0]=new Uint8Array(args[0]);
    if(section==='adpcm'&&method==='loadSample'){
     const options=args[1]??{};
     args[1]={...options,signal:options.signal?AbortSignal.any([options.signal,sampleController.signal]):sampleController.signal};
    }
    const levels=retainedLevels();batch=[];
    try{return raw[section][method](...args);}
    finally{retainLevels(levels);const commands=batch;batch=null;if(commands.length)port.postMessage(commands);if(section==='ssg')observe({method:'ssgState',args:[raw.ssg._getState()]});}
   }]));
 }
 if(sections.adpcmB)sections.adpcm=sections.adpcmB;
 const fm=new Proxy({}, {get:(_t,method)=> method==='clock'?raw.clock:method==='dac'?raw.dac:sections[method]??((...args)=>invoke(String(method),args))});
 const psg=capabilities.psg?createSegaPsgApi({write:value=>send({type:'psg-write',value}),
  ...(capabilities.backend==='native-genesis'?{setStereo:value=>send({type:'psg-stereo',value})}:{}),
  reset:()=>send({type:'psg-reset'}),resetAll:()=>fm.reset()}):null;
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
   raw.adpcmA?.keyOff([0,1,2,3,4,5]);
   raw.adpcm?.keyOff();
  },
 };
}

function createWorkerGameboy({port,state,observe}) {
 let enabled=false, notification=false;
 const send=command=>{if(enabled)port.postMessage([command]);};
 const raw=new GameboySynth({transport:{
  writeRegister(offset,value){send({method:'writeRegister',args:[offset,value]});},
  reset(){send({method:'reset',args:[]});},
 }});
 attachChipClock(raw,port,state?.clock??CHIP_CLOCKS.gameboy,{primary:true,batch:true,
  onApplied:()=>{if(enabled)observe({method:'gameboyState',args:[raw._getState()]});}});
 raw._observe=()=>{
  if(!enabled||notification)return;
  notification=true;
  queueMicrotask(()=>{notification=false;observe({method:'gameboyState',args:[raw._getState()]});});
 };
 if(state)raw._adoptState(state);else raw.initialize();
 enabled=true;
 const gameboy=createPrimaryGameboyApi(raw);
 return {gameboy,raw,send,adoptState:state=>raw._adoptState(state),resume(){},
  stop(){
   raw._cancelClockRequests('Run stopped');
   send({type:'clear-scheduled-writes'});
   if(raw._getState().initialized)for(let channel=0;channel<4;channel++)raw.keyOff(channel);
  },
 };
}
